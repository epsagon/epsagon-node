/**
 * @fileoverview Handlers for http & https libraries instrumentation
 */

const uuid4 = require('uuid4');
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
const { MAX_HTTP_VALUE_SIZE } = require('../consts.js');
const { isBlacklistURL, isBlacklistHeader } = require('../helpers/events');
const {
    isURLIgnoredByUser,
    resolveHttpPromise,
    USER_AGENTS_BLACKLIST,
    URL_BLACKLIST,
    generateEpsagonTraceId,
    updateAPIGateway,
    setJsonPayload,
} = require('../helpers/http');


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
        const chunks = [];
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
                utils.debugLog('filtered blacklist headers headers');
                return wrappedFunction.apply(this, [a, b, c]);
            }

            // Inject header to support tracing over HTTP requests to opentracing monitored code
            const epsagonTraceId = generateEpsagonTraceId();
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

            const body = (
                options &&
                options.body &&
                (options.body instanceof String || options.body instanceof Buffer)
            ) ? options.body : '';
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
                });
            if (body) {
                eventInterface.addToMetadata(httpEvent, {}, {
                    request_body: body,
                });
            }

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

                updateAPIGateway(res.headers, httpEvent);

                if (callback) {
                    callback(res);
                }
            };
            patchedCallback.__epsagonCallback = true; // eslint-disable-line no-underscore-dangle
            clientRequest = wrappedFunction.apply(
                this, buildParams(url, options, patchedCallback)
            );

            /**
             * Wraps 'on' method in a response to capture data event.
             * @param {Function} wrappedResFunction The wrapped end function
             * @returns {Function} The wrapped function
             */
            function responseOnWrapper(wrappedResFunction) { // eslint-disable-line no-inner-declarations,max-len
                return function internalResponseOnWrapper(resEvent, resCallback) {
                    if (resEvent !== 'data' || typeof resCallback !== 'function') {
                        return wrappedResFunction.apply(this, [resEvent, resCallback]);
                    }
                    const resPatchedCallback = (chunk) => {
                        if (chunk) {
                            const totalSize = chunks.reduce(
                                (total, item) => item.length + total,
                                0
                            );
                            if (totalSize + chunk.length <= MAX_HTTP_VALUE_SIZE) {
                                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
                            }
                        }
                        return resCallback(chunk);
                    };
                    return wrappedResFunction.apply(
                        this,
                        [resEvent, resPatchedCallback.bind(this)]
                    );
                };
            }

            /**
             * Wraps 'on' method in a request to capture response event.
             * @param {Function} wrappedReqFunction The wrapped end function
             * @returns {Function} The wrapped function
             */
            function requestOnWrapper(wrappedReqFunction) { // eslint-disable-line no-inner-declarations,max-len
                // epsagonMarker is sent only on our call in this module
                return function internalRequestOnWrapper(reqEvent, reqCallback, epsagonMarker) {
                    if (
                        reqEvent !== 'response' ||
                        epsagonMarker ||
                        typeof reqCallback !== 'function'
                    ) {
                        return wrappedReqFunction.apply(this, [reqEvent, reqCallback]);
                    }
                    const reqPatchedCallback = (res) => {
                        if (res.EPSAGON_PATCH) {
                            return reqCallback(res);
                        }
                        res.EPSAGON_PATCH = true;
                        shimmer.wrap(res, 'on', responseOnWrapper);
                        return reqCallback(res);
                    };
                    return wrappedReqFunction.apply(
                        this,
                        [reqEvent, reqPatchedCallback.bind(this)]
                    );
                };
            }

            shimmer.wrap(clientRequest, 'on', requestOnWrapper);

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
                        setJsonPayload(httpEvent, 'request_body', args[0]);
                    }
                    return wrappedWriteFunc.apply(this, args);
                };
            }

            /**
             * Wraps 'end' method in a request to terminate the request writing
             * @param {Function} wrappedEndFunc The wrapped end function
             * @returns {Function} The wrapped function
             */
            function endWrapper(wrappedEndFunc) { // eslint-disable-line no-inner-declarations
                return function internalEndWrapper(...args) {
                    try {
                        if (
                            (!body || body === '') && args[0] && (
                                (args[0] instanceof String) || (args[0] instanceof Buffer)
                            )
                        ) {
                            setJsonPayload(httpEvent, 'request_body', args[0]);
                        }
                    } catch (err) {
                        utils.debugLog('Could not parse request body in end wrapper');
                    }
                    return wrappedEndFunc.apply(this, args);
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
                        shimmer.wrap(reqPrototype, 'end', endWrapper);
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

                clientRequest.on('response', (res) => {
                    if (options && !options.epsagonSkipResponseData) {
                        res.on('data', (chunk) => {
                            if (chunk) {
                                const totalSize = chunks.reduce(
                                    (total, item) => item.length + total,
                                    0
                                );
                                if (totalSize + chunk.length <= MAX_HTTP_VALUE_SIZE) {
                                    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
                                }
                            }
                        });
                    }
                    res.on('end', () => {
                        setJsonPayload(httpEvent, 'response_body', Buffer.concat(chunks), res.headers['content-encoding']);
                        resolveHttpPromise(httpEvent, resolve, startTime);
                    });
                }, true); // true is for epsagonMarker
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


/**
 * Flagging fetch-h2 http1 requests with a flag to omit our response.on('data') because of collision
 * @param {Function} wrappedFunc connect function
 * @return {Function} the wrapped function
 */
function fetchH2Wrapper(wrappedFunc) {
    return function internalFetchH2Wrapper(options) {
        return wrappedFunc.apply(this, [{ ...options, epsagonSkipResponseData: true }]);
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
            'fetch-h2/dist/lib/context-http1',
            'connect',
            fetchH2Wrapper,
            fetch => fetch.OriginPool.prototype
        );
    },
};
