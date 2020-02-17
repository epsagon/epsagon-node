/**
 * @fileoverview Handlers for http2 libraries instrumentation
 */

const shimmer = require('shimmer');
const urlLib = require('url');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const { isBlacklistURL, isBlacklistHeader } = require('../helpers/events');
const {
    isURLIgnoredByUser,
    resolveHttpPromise,
    USER_AGENTS_BLACKLIST,
    URL_BLACKLIST,
    generateEpsagonTraceId,
    updateAPIGateway,
} = require('../helpers/http');
const tryRequire = require('../try_require');

const http2 = tryRequire('http2');


/**
 * http2 module adds in the request and response headers also extra fields with a ':' prefix.
 * For example :path, :method, etc. When we want to record just the headers, we want to clear
 * out these fields - using this function.
 * @param {object} headers data
 * @returns {object} only real headers without ':'
 */
function extractHeaders(headers) {
    return Object.entries(headers) // Iterate over key-value pairs
        .filter(header => !header[0].startsWith(':')) // Filter out keys that start with ':'
        .reduce((obj, header) => { // Rebuild key-value into object using reduce
            const [key, value] = header;
            obj[key] = value; // eslint-disable-line no-param-reassign
            return obj;
        }, {});
}

/**
 * Wraps the http2's module request function with tracing
 * @param {Function} wrappedFunction The http2's request module
 * @param {string} authority hostname
 * @returns {Function} The wrapped function
 */
function httpWrapper(wrappedFunction, authority) {
    return function internalHttpWrapper(headers, options) {
        let clientRequest = null;
        try {
            const { hostname } = urlLib.parse(authority);

            const reqHeaders = extractHeaders(headers);

            if (isBlacklistURL(hostname, URL_BLACKLIST, headers[':path']) || isURLIgnoredByUser(hostname)) {
                utils.debugLog(`filtered blacklist hostname ${hostname}`);
                return wrappedFunction.apply(this, [headers, options]);
            }
            if (isBlacklistHeader(reqHeaders, USER_AGENTS_BLACKLIST)) {
                utils.debugLog('filtered blacklist headers');
                return wrappedFunction.apply(this, [headers, options]);
            }

            // Inject header to support tracing over HTTP requests to opentracing monitored code
            const epsagonTraceId = generateEpsagonTraceId();
            headers['epsagon-trace-id'] = epsagonTraceId; // eslint-disable-line no-param-reassign

            const { slsEvent: httpEvent, startTime, resource } = eventInterface.initializeEvent(
                'http',
                hostname,
                headers[':method'],
                'http'
            );

            eventInterface.addToMetadata(httpEvent,
                {
                    http_trace_id: epsagonTraceId,
                }, {
                    path: headers[':path'],
                    request_headers: reqHeaders,
                });

            try {
                clientRequest = wrappedFunction.apply(this, [headers, options]);
            } catch (err) {
                eventInterface.setException(httpEvent, err);
                tracer.addEvent(httpEvent);
                throw err;
            }
            const responsePromise = new Promise((resolve) => {
                let data = '';
                clientRequest.on('data', (chunk) => { data += chunk; });

                clientRequest.once('error', (error) => {
                    eventInterface.setException(httpEvent, error);
                    resolveHttpPromise(httpEvent, resolve, startTime);
                    // if there are no listeners on eventEmitter.error, the process
                    // should explode. let's simulate that.
                    if (clientRequest.listenerCount('error') === 0) {
                        throw error; // no error listener, we should explode
                    }
                });

                clientRequest.once('close', () => {
                    try {
                        const responseBody = JSON.parse(data);
                        eventInterface.addToMetadata(httpEvent, {}, {
                            response_body: responseBody,
                        });
                    } catch (err) {
                        utils.debugLog('Could not parse JSON in http2');
                    }
                    resolveHttpPromise(httpEvent, resolve, startTime);
                });

                clientRequest.once('response', (res) => {
                    updateAPIGateway(res, resource, httpEvent);
                    eventInterface.addToMetadata(httpEvent, {
                        status: res[':status'],
                    }, {
                        response_headers: extractHeaders(res),
                    });
                });
            }).catch((err) => {
                tracer.addException(err);
            });

            tracer.addEvent(httpEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }

        if (!clientRequest) {
            clientRequest = wrappedFunction.apply(this, [headers, options]);
        }

        return clientRequest;
    };
}

/**
 * Wraps the request method of HTTP2 connect
 * @param {Function} connectFunction connect function
 * @return {Function} the wrapped function
 */
function wrapHttp2Connect(connectFunction) {
    return function innerWrapHttp2Connect(authority, options, listener) {
        const clientSession = connectFunction.apply(this, [authority, options, listener]);
        try {
            shimmer.wrap(clientSession, 'request', wrappedFunction => httpWrapper(wrappedFunction, authority));
        } catch (err) {
            utils.debugLog(`Could not instrument http2 session request ${err}`);
        }
        return clientSession;
    };
}


module.exports = {
    /**
     * Initializes the http2 tracer
     */
    init() {
        if (http2) {
            utils.debugLog('Patching http2 module');
            shimmer.wrap(http2, 'connect', wrapHttp2Connect);
        }
    },
};
