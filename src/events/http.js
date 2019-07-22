/**
 * @fileoverview Handlers for http & https libraries instrumentation
 */

const uuid4 = require('uuid4');
const shimmer = require('shimmer');
const http = require('http');
const https = require('https');
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
    '169.254.169.254': 'startsWith', // EC2 document ip. Have better filtering in the future
};

const USER_AGENTS_BLACKLIST = ['openwhisk-client-js'];
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
 * Wraps the http's module request function with tracing
 * @param {Function} wrappedFunction The http's request module
 * @returns {Function} The wrapped function
 */
function httpWrapper(wrappedFunction) {
    return function internalHttpWrapper(options, callback) {
        if (callback && callback.__epsagonCallback) { // eslint-disable-line no-underscore-dangle
            // we are already tracing this request. can happen in
            // https->http cases
            return wrappedFunction.apply(this, [options, callback]);
        }
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
            if (isBlacklistHeader(options.headers)) {
                utils.debugLog(`filtered blacklist headers ${JSON.stringify(options.headers)}`);
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
            const pathname = options.pathname || '/';

            protocol = protocol.slice(0, -1);
            const method = options.method || 'GET';

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

            const url = `${protocol}://${hostname}${pathname}`;
            const fullURL = `${url}${path}`;
            httpEvent.setResource(resource);
            eventInterface.addToMetadata(httpEvent,
                { url }, {
                    path,
                    request_headers: headers,
                    request_body: body,
                });

            const patchedCallback = (res) => {
                const { isWreck } = (options.agent || {});
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

            clientRequest = wrappedFunction.apply(this, [options, patchedCallback]);

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
            clientRequest = wrappedFunction.apply(this, [options, callback]);
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
