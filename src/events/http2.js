/**
 * @fileoverview Handlers for http & https libraries instrumentation
 */

const uuid4 = require('uuid4');
const shimmer = require('shimmer');
const urlLib = require('url');
const http2 = require('http2');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const { isBlacklistURL, isBlacklistHeader } = require('.././helpers/events');
const {
    resolveHttpPromise,
    isURLIgnoredByUser,
    USER_AGENTS_BLACKLIST,
    URL_BLACKLIST,
    generateEpsagonTraceId,
    updateAPIGateway,
} = require('./http');


/**
 * Removing ':' from http2 headers.
 * @param {object} headers data
 * @returns {object} only real headers without ':'
 */
function extractHeaders(headers) {
    return Object.entries(headers)
        .filter(header => !header[0].startsWith(':'))
        .reduce((obj, header) => {
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
                utils.debugLog(`filtered blacklist headers ${JSON.stringify(reqHeaders)}`);
                return wrappedFunction.apply(this, [headers, options]);
            }

            // Inject header to support tracing over HTTP requests to opentracing monitored code
            const epsagonTraceId = generateEpsagonTraceId();
            headers['epsagon-trace-id'] = epsagonTraceId; // eslint-disable-line no-param-reassign

            const resource = new serverlessEvent.Resource([
                hostname,
                'http',
                headers[':method'],
            ]);

            const startTime = Date.now();
            const httpEvent = new serverlessEvent.Event([
                `http2-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'http',
                0,
                errorCode.ErrorCode.OK,
            ]);

            httpEvent.setResource(resource);

            eventInterface.addToMetadata(httpEvent,
                {
                    http_trace_id: epsagonTraceId,
                }, {
                    path: headers[':path'],
                    request_headers: reqHeaders,
                });

            clientRequest = wrappedFunction.apply(this, [headers, options]);
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
                        tracer.addException(err);
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
        shimmer.wrap(clientSession, 'request', wrappedFunction => httpWrapper(wrappedFunction, authority));
        return clientSession;
    };
}


module.exports = {
    /**
     * Initializes the http2 tracer
     */
    init() {
        shimmer.wrap(http2, 'connect', wrapHttp2Connect);
    },
};
