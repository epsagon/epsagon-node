/**
 * @fileoverview Handlers for http & https libraries instrumentation
 */

const uuid4 = require('uuid4');
const uuidToHex = require('uuid-to-hex');
const http = require('http');
const https = require('https');
const urlLib = require('url');
const shimmer = require('shimmer');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const config = require('../config.js');
const moduleUtils = require('./module_utils.js');
const { isBlacklistURL, isBlacklistHeader } = require('.././helpers/events');

const URL_BLACKLIST = {
    'tc.epsagon.com': 'endsWith',
    'googleapis.com': 'endsWith',
    'amazonaws.com':
        (url, pattern) => url.endsWith(pattern) &&
            (url.indexOf('.execute-api.') === -1) &&
            (url.indexOf('.es.') === -1) &&
            (url.indexOf('.elb.') === -1) &&
            (url.indexOf('.appsync-api.') === -1),
    '127.0.0.1': (url, pattern, path) => (url === pattern) && path.startsWith('/2018-06-01/runtime/invocation/'),
    '169.254.169.254': 'startsWith', // EC2 document ip. Have better filtering in the future
};

const USER_AGENTS_BLACKLIST = ['openwhisk-client-js'];

/**
 * Checks if a URL is in the user-defined blacklist.
 * @param {string} url The URL to check
 * @returns {boolean} True if it is in the user-defined blacklist, False otherwise.
 */
function isURLIgnoredByUser(url) {
    return config.getConfig().urlPatternsToIgnore.some(pattern => url.includes(pattern));
}


/**
 * Set the duration of the event, and resolves the promise using the given function.
 * @param {object} httpEvent The current event
 * @param {Function} resolveFunction Function that will be used to resolve the promise
 * @param {integer} startTime The time the event started at
 */
function resolveHttpPromise(httpEvent, resolveFunction, startTime) {
    httpEvent.setDuration(utils.createDurationTimestamp(startTime));
    resolveFunction();
}

/**
 * Builds the HTTP Params array
 * @param {string} url The URL, if exists
 * @param {object} options The Options object, if exists
 * @param {callback} callback The callback function, if exists
 * @returns {object} The params array
 */
function buildParams(url, options, callback) {
    if (url && options) {
        // in case of both input and options returning all three
        return [url, options, callback];
    }
    if (url && !options) {
        // in case of missing options returning only url and callback
        return [url, callback];
    }
    // url is missing - returning options and callback
    return [options, callback];
}

/**
 * Wraps the http's module request function with tracing
 * @param {Function} wrappedFunction The http's request module
 * @returns {Function} The wrapped function
 */
function httpWrapper(wrappedFunction) {
    return function internalHttpWrapper(a, b, c) {
        let url = a;
        let options = b;
        let callback = c;
        // handling case of request(options, callback)
        if (!(['string', 'URL'].includes(typeof url)) && !callback) {
            callback = b;
            options = a;
            url = undefined;
        }

        // handling case of request(url, callback)
        if ((typeof options === 'function') && (!callback)) {
            callback = options;
            options = null;
        }

        if (callback && callback.__epsagonCallback) { // eslint-disable-line no-underscore-dangle
            // we are already tracing this request. can happen in
            // https->http cases
            return wrappedFunction.apply(this, [a, b, c]);
        }
        let clientRequest = null;
        try {
            let parsedUrl = url;

            if (typeof parsedUrl === 'string') {
                parsedUrl = urlLib.parse(parsedUrl);
            }

            const hostname = (
                (parsedUrl && parsedUrl.hostname) ||
                (parsedUrl && parsedUrl.host) ||
                (options && options.hostname) ||
                (options && options.host) ||
                (options && options.uri && options.uri.hostname) ||
                'localhost'
            );

            const path = (
                (parsedUrl && parsedUrl.path) ||
                (options && options.path) ||
                ('/')
            );

            const pathname = (
                (parsedUrl && parsedUrl.pathname) ||
                (options && options.pathname) ||
                ('/')
            );

            const headers = (
                (options && options.headers) || {}
            );

            if (isBlacklistURL(hostname, URL_BLACKLIST, path) || isURLIgnoredByUser(hostname)) {
                utils.debugLog(`filtered blacklist hostname ${hostname}`);
                return wrappedFunction.apply(this, [a, b, c]);
            }
            if (isBlacklistHeader(headers, USER_AGENTS_BLACKLIST)) {
                utils.debugLog(`filtered blacklist headers ${JSON.stringify(headers)}`);
                return wrappedFunction.apply(this, [a, b, c]);
            }

            // Inject header to support tracing over HTTP requests to opentracing monitored code
            const traceId = uuid4();
            const hexTraceId = uuidToHex(traceId);
            const spanId = uuidToHex(uuid4()).slice(16);
            const parentSpanId = uuidToHex(uuid4()).slice(16);

            const epsagonTraceId = `${hexTraceId}:${spanId}:${parentSpanId}:1`;
            headers['epsagon-trace-id'] = epsagonTraceId;

            const agent = (
                // eslint-disable-next-line no-underscore-dangle
                (options && options.agent) || (options && options._defaultAgent) ||
                undefined
            );
            const port = (
                (parsedUrl && parsedUrl.port) || (options && options.port) ||
                (options && options.defaultPort) || (agent && agent.defaultPort) || 80
            );
            let protocol = (
                (parsedUrl && parsedUrl.protocol) ||
                (port === 443 && 'https:') ||
                (options && options.protocol) ||
                (agent && agent.protocol) ||
                'http:'
            );
            protocol = protocol.slice(0, -1);

            const body = (options && options.body) || '';
            const method = (options && options.method) || 'GET';

            const resource = new serverlessEvent.Resource([
                hostname,
                'http',
                method,
            ]);

            const startTime = Date.now();
            const httpEvent = new serverlessEvent.Event([
                `http-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'http',
                0,
                errorCode.ErrorCode.OK,
            ]);

            const requestUrl = `${protocol}://${hostname}${pathname}`;
            httpEvent.setResource(resource);

            eventInterface.addToMetadata(httpEvent,
                {
                    url: requestUrl,
                    http_trace_id: epsagonTraceId,
                }, {
                    path,
                    request_headers: headers,
                    request_body: body,
                });

            eventInterface.addToMetadata(httpEvent, {
                http_trace_id: traceId,
            });

            const patchedCallback = (res) => {
                let metadataFields = {};
                if ('x-powered-by' in res.headers) {
                    // This field is used to identify responses from 'Express'
                    metadataFields = { response_headers: { 'x-powered-by': res.headers['x-powered-by'] } };
                }
                eventInterface.addToMetadata(httpEvent, { status: res.statusCode });
                if (res.statusCode >= config.HTTP_ERR_CODE) {
                    eventInterface.setException(httpEvent, new Error(`Response code: ${res.statusCode}`));
                }
                // The complete headers will override metadata only when needed
                eventInterface.addToMetadata(httpEvent, metadataFields, {
                    response_headers: res.headers,
                });

                // Override request headers if they are present here. In some libs they are not
                // available on `options.headers`
                // eslint-disable-next-line no-underscore-dangle
                if (res.req && res.req._headers) {
                    eventInterface.addToMetadata(httpEvent, metadataFields, {
                        // eslint-disable-next-line no-underscore-dangle
                        request_headers: res.req._headers,
                    });
                }

                if ('x-amzn-requestid' in res.headers) {
                    // This is a request to AWS API Gateway
                    resource.setType('api_gateway');
                    eventInterface.addToMetadata(httpEvent, {
                        request_trace_id: res.headers['x-amzn-requestid'],
                    });
                }

                if (callback) {
                    callback(res);
                }
            };
            patchedCallback.__epsagonCallback = true; // eslint-disable-line no-underscore-dangle
            clientRequest = wrappedFunction.apply(
                this, buildParams(url, options, patchedCallback)
            );

            /**
             * Wraps 'write' method in a request to pick up request body
             * @param {Function} wrappedWriteFunc The wrapped write function
             * @returns {Function} The wrapped function
             */
            function WriteWrapper(wrappedWriteFunc) { // eslint-disable-line no-inner-declarations
                return function internalWriteWrapper(...args) {
                    if (
                        (!body || body === '') && args[0] && (
                            (args[0] instanceof String) || (args[0] instanceof Buffer)
                        )
                    ) {
                        eventInterface.addToMetadata(
                            httpEvent, {},
                            { request_body: args[0].toString() }
                        );
                    }
                    return wrappedWriteFunc.apply(this, args);
                };
            }

            if (
                Object.getPrototypeOf(clientRequest) &&
                Object.getPrototypeOf(Object.getPrototypeOf(clientRequest) &&
                !clientRequest.__epsagonPatched) // eslint-disable-line no-underscore-dangle
            ) {
                try {
                    const reqPrototype = Object.getPrototypeOf(
                        Object.getPrototypeOf(clientRequest)
                    );
                    // eslint-disable-next-line no-underscore-dangle
                    if (reqPrototype && !reqPrototype.__epsagonPatched) {
                        // eslint-disable-next-line no-underscore-dangle
                        reqPrototype.__epsagonPatched = true;
                        shimmer.wrap(reqPrototype, 'write', WriteWrapper);
                    }
                } catch (err) {
                    // In some libs it might not be possible to hook on write
                }
            }

            const responsePromise = new Promise((resolve) => {
                let isTimeout = false;
                clientRequest.on('timeout', () => {
                    isTimeout = true;
                });

                clientRequest.once('error', (error) => {
                    const patchedError = new Error();
                    patchedError.message = error.message;
                    patchedError.stack = error.stack;
                    patchedError.name = error.name;
                    if (isTimeout) {
                        patchedError.message += '\nTimeout exceeded';
                    }
                    if (clientRequest.aborted) {
                        patchedError.message += '\nRequest aborted';
                    }
                    eventInterface.setException(httpEvent, patchedError);
                    resolveHttpPromise(httpEvent, resolve, startTime);

                    // if there are no listeners on eventEmitter.error, the process
                    // should explode. let's simulate that.
                    if (clientRequest.listenerCount('error') === 0) {
                        throw error; // no error listener, we should explode
                    }
                });

                clientRequest.on('close', () => {
                    resolveHttpPromise(httpEvent, resolve, startTime);
                });

                clientRequest.on('response', () => {
                    resolveHttpPromise(httpEvent, resolve, startTime);
                });
            }).catch((err) => {
                tracer.addException(err);
            });

            tracer.addEvent(httpEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }

        if (!clientRequest) {
            clientRequest = wrappedFunction.apply(this, [a, b, c]);
        }

        return clientRequest;
    };
}

/**
 * Wraps Wreck's request to add "isWreck" flag.
 * This flag is used to mark to not extract the data from the response since we override it.
 * @param {Function} wrappedFunction The Wreck's request module
 * @returns {Function} The wrapped function
 */
function WreckWrapper(wrappedFunction) {
    return function internalWreckWrapper() {
        // Marking all possible agents
        if (this.agents.https && !this.agents.https.isWreck) {
            this.agents.https.isWreck = true;
            utils.debugLog('Setting Wreck flag on https');
        }
        if (this.agents.http && !this.agents.http.isWreck) {
            this.agents.http.isWreck = true;
            utils.debugLog('Setting Wreck flag on http');
        }
        if (this.agents.httpsAllowUnauthorized && !this.agents.httpsAllowUnauthorized.isWreck) {
            this.agents.httpsAllowUnauthorized.isWreck = true;
            utils.debugLog('Setting Wreck flag on httpsAllowUnauthorized');
        }
        return wrappedFunction.apply(this, arguments); // eslint-disable-line prefer-rest-params
    };
}

/**
 * We have to replace http.get since it uses a closure to reference
 * the requeset
 * @param {Module} module The module to use (http or https)
 * @return {Function} the wrapped function
 */
function httpGetWrapper(module) {
    return function internalHttpGetWrapper(url, options, callback) {
        const req = module.request(url, options, callback);
        req.end();
        return req;
    };
}

module.exports = {
    /**
     * Initializes the http tracer
     */
    init() {
        // using shimmer directly cause can only be bundled in node
        shimmer.wrap(http, 'get', () => httpGetWrapper(http));
        shimmer.wrap(http, 'request', httpWrapper);
        shimmer.wrap(https, 'get', () => httpGetWrapper(https));
        shimmer.wrap(https, 'request', httpWrapper);

        moduleUtils.patchModule(
            'wreck',
            'request',
            WreckWrapper
        );
    },
};
