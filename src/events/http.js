/**
 * @fileoverview Handlers for http & https libraries instrumentation
 */

const uuid4 = require('uuid4');
const shimmer = require('shimmer');
const http = require('http');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const config = require('../config.js');

const URL_BLACKLIST = {
    'tc.epsagon.com': 'endsWith',
    'amazonaws.com': (url, pattern) => url.endsWith(pattern) && (url.indexOf('execute-api') === -1),
    '169.254.169.254': 'startsWith', // EC2 document ip. Have better filtering in the future
};

/**
 * Checks if a URL is in the blacklist
 * @param {string} url The URL to check
 * @returns {boolean} True if it is in the blacklist, False otherwise
 */
function isBlacklistURL(url) {
    return Object.keys(URL_BLACKLIST).some((key) => {
        if (typeof URL_BLACKLIST[key] === typeof (() => {})) {
            return URL_BLACKLIST[key](url, key);
        }
        return url[URL_BLACKLIST[key]](key);
    });
}

/**
 * Set the duration of the event, and resolves the promise using the given function.
 * @param {object} awsEvent The current event
 * @param {Function} resolveFunction Function that will be used to resolve the promise
 * @param {integer} startTime The time the event started at
 */
function resolveHttpPromise(awsEvent, resolveFunction, startTime) {
    awsEvent.setDuration(utils.createDurationTimestamp(startTime));
    resolveFunction();
}

/**
 * Wraps the http's module request function with tracing
 * @param {Function} wrappedFunction The http's request module
 * @returns {Function} The wrapped function
 */
function httpWrapper(wrappedFunction) {
    return function internalHttpWrapper(options, callback) {
        let clientRequest = null;
        try {
            const hostname = (
                options.hostname ||
                options.host ||
                (options.uri && options.uri.hostname) ||
                'localhost'
            );
            if (isBlacklistURL(hostname)) {
                utils.debugLog(`filtered blacklist hostname ${hostname}`);
                return wrappedFunction.apply(this, [options, callback]);
            }

            // eslint-disable-next-line no-underscore-dangle
            const agent = options.agent || options._defaultAgent;
            const port = options.port || options.defaultPort || (agent && agent.defaultPort) || 80;
            let protocol = (
                (port === 443 && 'https:') ||
                options.protocol ||
                (agent && agent.protocol) ||
                'http:'
            );
            const headers = options.headers || {};
            const body = options.body || '';
            const path = options.path || '/';

            protocol = protocol.slice(0, -1);
            const method = options.method || 'GET';

            const resource = new serverlessEvent.Resource([
                hostname,
                'http',
                method,
            ]);

            const startTime = Date.now();
            const awsEvent = new serverlessEvent.Event([
                `http-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'http',
                0,
                errorCode.ErrorCode.OK,
            ]);

            awsEvent.setResource(resource);
            eventInterface.addToMetadata(awsEvent, {
                url: `${protocol}://${hostname}${path}`,
            }, {
                request_headers: headers,
                request_body: body,
            });

            const patchedCallback = (res) => {
                let metadataFields = {};
                if ('x-powered-by' in res.headers) {
                    // This field is used to identify responses from 'Express'
                    metadataFields = { response_headers: { 'x-powered-by': res.headers['x-powered-by'] } };
                }
                // The complete headers will override metadata only when needed
                eventInterface.addToMetadata(awsEvent, metadataFields, {
                    response_headers: res.headers,
                });

                if ('x-amzn-requestid' in res.headers) {
                    // This is a request to AWS API Gateway
                    resource.setType('api_gateway');
                    eventInterface.addToMetadata(awsEvent, {
                        request_trace_id: res.headers['x-amzn-requestid'],
                    });
                }

                let data = '';
                if (!config.getConfig().metadataOnly) {
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                }
                res.on('end', () => {
                    eventInterface.addToMetadata(awsEvent, {}, {
                        response_body: data,
                    });
                });
                if (callback) {
                    callback(res);
                }
            };

            clientRequest = wrappedFunction.apply(this, [options, patchedCallback]);

            const responsePromise = new Promise((resolve) => {
                let isTimeout = false;
                clientRequest.on('timeout', () => {
                    isTimeout = true;
                });

                clientRequest.on('error', (error) => {
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
                    eventInterface.setException(awsEvent, patchedError);
                });

                clientRequest.on('close', () => {
                    resolveHttpPromise(awsEvent, resolve, startTime);
                });

                clientRequest.on('response', () => {
                    resolveHttpPromise(awsEvent, resolve, startTime);
                });
            }).catch((err) => {
                tracer.addException(err);
            });


            tracer.addEvent(awsEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }

        if (!clientRequest) {
            clientRequest = wrappedFunction.apply(this, [options, callback]);
        }

        return clientRequest;
    };
}

module.exports = {
    /**
     * Initializes the http tracer
     */
    init() {
        shimmer.wrap(http, 'request', httpWrapper);
    },
};
