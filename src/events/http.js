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
const { isBlacklistURL, isBlacklistHeader } = require('../helpers/events');
const {
    isURLIgnoredByUser,
    resolveHttpPromise,
    USER_AGENTS_BLACKLIST,
    URL_BLACKLIST,
    generateEpsagonTraceId,
    updateAPIGateway,
    setJsonPayload,
    addChunk,
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
 * Parses arguments for http wrapper
 * @param {object} a First http wrapper param
 * @param {object} b Second http wrapper param
 * @param {object} c Third http wrapper param
 * @returns {object} The params object { url, options, callback }
 */
function parseArgs(a, b, c) {
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

    // handling case of got.post(url, options)
    if (a.constructor && a.constructor.name === 'URL' && typeof b === 'object' && !c) {
        url = a;
        url.path = url.pathname;
        options = b;
        callback = undefined;
    }

    return { url, options, callback };
}


/**
 * Wraps 'on' method in a response to capture data event.
 * @param {Function} wrappedResFunction The wrapped end function
 * @param {Array} chunks array of chunks
 * @returns {Function} The wrapped function
 */
function responseOnWrapper(wrappedResFunction, chunks) {
    return function internalResponseOnWrapper(resEvent, resCallback) {
        if (resEvent !== 'data' || typeof resCallback !== 'function') {
            return wrappedResFunction.apply(this, [resEvent, resCallback]);
        }
        const resPatchedCallback = (chunk) => {
            addChunk(chunk, chunks);
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
 * @param {Array} chunks array of chunks
 * @returns {Function} The wrapped function
 */
function requestOnWrapper(wrappedReqFunction, chunks) {
    // epsagonMarker is sent only on our call in this module and it equals to 'skip'
    return function internalRequestOnWrapper(reqEvent, reqCallback, epsagonMarker) {
        if (
            reqEvent !== 'response' ||
            epsagonMarker === 'skip' ||
            typeof reqCallback !== 'function'
        ) {
            return wrappedReqFunction.apply(this, [reqEvent, reqCallback]);
        }
        const reqPatchedCallback = (res) => {
            if (res && res.EPSAGON_PATCH) {
                return reqCallback(res);
            }
            res.EPSAGON_PATCH = true;
            shimmer.wrap(res, 'on', wrapped => responseOnWrapper(wrapped, chunks));
            return reqCallback(res);
        };
        return wrappedReqFunction.apply(
            this,
            [reqEvent, reqPatchedCallback.bind(this)]
        );
    };
}

/**
 * Wraps the http's module request function with tracing
 * @param {Function} wrappedFunction The http's request module
 * @returns {Function} The wrapped function
 */
function httpWrapper(wrappedFunction) {
    return function internalHttpWrapper(a, b, c) {
        const { url, options, callback } = parseArgs(a, b, c);
        const chunks = [];

        let clientRequest = null;
        try {
            let parsedUrl = url;

            if (typeof parsedUrl === 'string') {
                parsedUrl = urlLib.parse(parsedUrl);
            }

            let hostname = (
                (parsedUrl && parsedUrl.hostname) ||
                (parsedUrl && parsedUrl.host) ||
                (options && options.hostname) ||
                (options && options.host) ||
                (options && options.uri && options.uri.hostname) ||
                'localhost'
            );
            utils.debugLog(`[http] captured call ${hostname}`);

            // eslint-disable-next-line no-underscore-dangle
            if (callback && callback.__epsagonCallback) {
                // we are already tracing this request. can happen in
                // https->http cases
                utils.debugLog(`[http] filtered patched callback ${hostname}`);
                return wrappedFunction.apply(this, [a, b, c]);
            }

            // Skipping new stripe calls since it interfere with async events
            if (options.headers['User-Agent']) {
                if (options.headers['User-Agent'].includes('Stripe/v1 NodeBindings/')) {
                    let stripeVersion = 0;
                    try {
                        stripeVersion = parseInt(options.headers['User-Agent'].split('/')[2].split('.')[1], 10);
                    } catch (err) {
                        utils.debugLog('Could not parse stripe version');
                    }
                    if (stripeVersion > 169 || !stripeVersion) {
                        return wrappedFunction.apply(this, [a, b, c]);
                    }
                }
            }

            // Capture the port if provided and is different than standard 80 and 443
            if (options.port && !['80', '443', 80, 443].includes(options.port)) {
                hostname = `${hostname}:${options.port}`;
            }

            const path = (
                (parsedUrl && parsedUrl.href) ||
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
                utils.debugLog(`[http] filtered ignored hostname ${hostname}`);
                return wrappedFunction.apply(this, [a, b, c]);
            }
            if (isBlacklistHeader(headers, USER_AGENTS_BLACKLIST)) {
                utils.debugLog('[http] filtered ignored headers');
                return wrappedFunction.apply(this, [a, b, c]);
            }

            const epsagonTraceId = generateEpsagonTraceId();
            // Inject header to support tracing over HTTP requests to opentracing monitored code
            if ((process.env.EPSAGON_DISABLE_HTTP_TRACE_ID || '').toUpperCase() !== 'TRUE') {
                headers['epsagon-trace-id'] = epsagonTraceId;
                // In case no headers defined in the options, we add them.
                if (!options.headers) {
                    options.headers = headers;
                }
            }

            if (options &&
                options.headers &&
                options.headers.epsagonSkipResponseData &&
                options.agent) {
                options.agent.epsagonSkipResponseData = true;
                delete options.headers.epsagonSkipResponseData;
            }

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
                utils.debugLog(`Set request body=${body}`);
                setJsonPayload(httpEvent, 'request_body', body);
            }

            const patchedCallback = (res) => {
                utils.debugLog(`[http] patched callback called for ${hostname}`);
                const metadataFields = {};
                if ('x-openwhisk-activation-id' in res.headers) {
                    // This field is used to identify activation ID from 'OpenWhisk'
                    metadataFields.openwhisk_act_id = res.headers['x-openwhisk-activation-id'];
                }
                if ('x-last-activation-id' in res.headers) {
                    // Used to identify the last activation ID from 'OpenWhisk' sequences
                    metadataFields.openwhisk_last_act_id = res.headers['x-last-activation-id'];
                }
                if ('x-request-id' in res.headers) {
                    // This field is used to identify transaction ID from 'OpenWhisk'
                    metadataFields.request_id = res.headers['x-request-id'];
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
                if (res.req && res.req.getHeaders()) {
                    eventInterface.addToMetadata(httpEvent, {}, {
                        request_headers: res.req.getHeaders(),
                    });
                }

                updateAPIGateway(res.headers, httpEvent);
                if (callback && typeof callback === 'function') {
                    callback(res);
                }
            };
            patchedCallback.__epsagonCallback = true; // eslint-disable-line no-underscore-dangle
            clientRequest = wrappedFunction.apply(
                this, buildParams(url, options, patchedCallback)
            );
            utils.debugLog(`[http] request sent ${hostname}`);

            if (
                options &&
                options.epsagonSkipResponseData &&
                !config.getConfig().disableHttpResponseBodyCapture
            ) {
                shimmer.wrap(
                    clientRequest,
                    'on',
                    wrapped => requestOnWrapper(wrapped, chunks)
                );
            }

            /**
             * Wraps 'write' method in a request to pick up request body
             * @param {Function} wrappedWriteFunc The wrapped write function
             * @returns {Function} The wrapped function
             */
            function WriteWrapper(wrappedWriteFunc) { // eslint-disable-line no-inner-declarations
                return function internalWriteWrapper(...args) {
                    try {
                        if (
                            (!body || body === '') && args[0] && (
                                (typeof args[0] === 'string') || (args[0] instanceof Buffer)
                            )
                        ) {
                            setJsonPayload(httpEvent, 'request_body', args[0]);
                        }
                    } catch (err) {
                        utils.debugLog('Could not parse request body in write wrapper');
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
                                (typeof args[0] === 'string') || (args[0] instanceof Buffer)
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

            try {
                shimmer.wrap(clientRequest, 'write', WriteWrapper);
                shimmer.wrap(clientRequest, 'end', endWrapper);
            } catch (err) {
                // In some libs it might not be possible to hook on write
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

                const checkIfOmitData = () => {
                    if (options) {
                        if (options.epsagonSkipResponseData) {
                            return true;
                        }
                        if (options.agent && options.agent.epsagonSkipResponseData) {
                            return true;
                        }
                    }
                    if (config.getConfig().disableHttpResponseBodyCapture) {
                        return true;
                    }

                    return false;
                };

                clientRequest.on('response', (res) => {
                    utils.debugLog(`[http] response arrived for ${hostname}`);
                    // Listening to data only if options.epsagonSkipResponseData!=true or no options
                    if (!checkIfOmitData()) {
                        res.on('data', chunk => addChunk(chunk, chunks));
                    }
                    res.on('end', () => {
                        const contentEncoding = res.headers && res.headers['content-encoding'];
                        setJsonPayload(httpEvent, 'response_body', Buffer.concat(chunks), contentEncoding);
                        resolveHttpPromise(httpEvent, resolve, startTime);
                    });
                }, 'skip'); // skip is for epsagonMarker
            }).catch((err) => {
                tracer.addException(err);
            });

            tracer.addEvent(httpEvent, responsePromise);
            utils.debugLog(`[http] event added ${hostname}`);
        } catch (error) {
            tracer.addException(error);
        }

        if (!clientRequest) {
            utils.debugLog('[http] not client request set');
            clientRequest = wrappedFunction.apply(this, [a, b, c]);
        }

        utils.debugLog('[http] done handling call');
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

/**
 * Flagging simple-oauth2 http requests with
 * a flag to omit our response.on('data') because of collision
 * @param {Function} wrappedFunc connect function
 * @return {Function} the wrapped function
 */
function clientRequestWrapper(wrappedFunc) {
    return function internalClientRequestWrapper(url, params, opts) {
        const newOpts = opts || {};
        if (newOpts.headers) {
            newOpts.headers = {
                ...opts.headers,
                epsagonSkipResponseData: true,
            };
        } else {
            newOpts.headers = {
                epsagonSkipResponseData: true,
            };
        }
        return wrappedFunc.apply(this, [url, params, newOpts]);
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
        // simple-oauth2 < 4.0
        moduleUtils.patchModule(
            'simple-oauth2/lib/client.js',
            'request',
            clientRequestWrapper,
            client => client.prototype
        );
        // simple-oauth2 >= 4.0
        moduleUtils.patchModule(
            'simple-oauth2/lib/client/client.js',
            'request',
            clientRequestWrapper,
            client => client.prototype
        );
    },
};
