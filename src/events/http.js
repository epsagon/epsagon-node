/**
 * @fileoverview Handlers for http & https libraries instrumentation
 */

const uuid4 = require('uuid4');
const shimmer = require('shimmer');
const http = require('http');
const https = require('https');
const urlLib = require('url');
const tryRequire = require('../try_require.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const config = require('../config.js');

const Wreck = tryRequire('wreck');

const URL_BLACKLIST = {
    'tc.epsagon.com': 'endsWith',
    'amazonaws.com': (url, pattern) => url.endsWith(pattern) && (url.indexOf('execute-api') === -1),
    '127.0.0.1': (url, pattern, path) => (url === pattern) && path.startsWith('/2018-06-01/runtime/invocation/'),
    '169.254.169.254': 'startsWith', // EC2 document ip. Have better filtering in the future
};

const USER_AGENTS_BLACKLIST = ['openwhisk-client-js'];
/**
 * Checks if a URL is in the blacklist
 * @param {string} url The URL to check
 * @param {string} path The Path to check (optional)
 * @returns {boolean} True if it is in the blacklist, False otherwise
 */
function isBlacklistURL(url, path) {
    return Object.keys(URL_BLACKLIST).some((key) => {
        if (typeof URL_BLACKLIST[key] === typeof (() => {})) {
            return URL_BLACKLIST[key](url, key, path);
        }
        return url[URL_BLACKLIST[key]](key);
    });
}

/**
 * Checks if a URL is in the blacklist
 * @param {string} headers The Headers to check.
 * @returns {boolean} True if it is in the blacklist, False otherwise
 */
function isBlacklistHeader(headers) {
    if (headers) {
        return USER_AGENTS_BLACKLIST.includes(headers['user-agent']);
    }

    return false;
}

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
 * @param {string} input The URL, if exists
 * @param {object} options The Options object, if exists
 * @param {callback} callback The callback function, if exists
 * @returns {object} The params array
 */
    function buildParams(input, options, callback) {
    if (input && options) {
        // In case of both input and options returning all three
        return [input, options, callback];
    }
    if (input && !options) {
        // In case of missing options returning only input and callback
        return [input, callback];
    }
    // Input is missing - returning options and callback
    return [options, callback];
}

/**
 * Wraps the http's module request function with tracing
 * @param {Function} wrappedFunction The http's request module
 * @returns {Function} The wrapped function
 */
function httpWrapper(wrappedFunction) {
    return function internalHttpWrapper(a, b, c) {
        let input = a;
        let options = b
        let callback = c
        if (!(['string', 'URL'].includes(typeof input)) && !callback) {
            callback = b;
            options = a;
            input = undefined;
        }

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
            let parsedUrl = input;

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

            if (isBlacklistURL(hostname, path)) {
                utils.debugLog(`filtered blacklist hostname ${hostname}`);
                return wrappedFunction.apply(this, [a, b, c]);
            }
            if (isBlacklistHeader(headers)) {
                utils.debugLog(`filtered blacklist headers ${JSON.stringify(headers)}`);
                return wrappedFunction.apply(this, [a, b, c]);
            }

            // eslint-disable-next-line no-underscore-dangle
            const agent = (
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
            const fullURL = `${requestUrl}${path}`;
            httpEvent.setResource(resource);

            eventInterface.addToMetadata(httpEvent,
                { url: requestUrl }, {
                    path,
                    request_headers: headers,
                    request_body: body,
                });

            const patchedCallback = (res) => {
                const { isWreck } = ((options || {}).agent || {});
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

                let data = '';
                if (!config.getConfig().metadataOnly &&
                    !isWreck &&
                    !isURLIgnoredByUser(fullURL)) {
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                }
                res.on('end', () => {
                    eventInterface.addToMetadata(httpEvent, {}, {
                        response_body: data,
                    });
                });
                if (callback) {
                    callback(res);
                }
            };
            patchedCallback.__epsagonCallback = true; // eslint-disable-line no-underscore-dangle
            clientRequest = wrappedFunction.apply(
                this, buildParams(input, options, patchedCallback)
            );

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
    return function internalHttpGetWrapper(input, options, callback) {
        const req = module.request(input, options, callback);
        req.end();
        return req;
    };
}

module.exports = {
    /**
     * Initializes the http tracer
     */
    init() {
        shimmer.wrap(http, 'get', () => httpGetWrapper(http));
        shimmer.wrap(http, 'request', httpWrapper);
        shimmer.wrap(https, 'get', () => httpGetWrapper(https));
        shimmer.wrap(https, 'request', httpWrapper);
        if (Wreck) {
            shimmer.wrap(Wreck, 'request', WreckWrapper);
        }
    },
};
