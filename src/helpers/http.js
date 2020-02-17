const uuid4 = require('uuid4');
const uuidToHex = require('uuid-to-hex');
const config = require('../config.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');


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
 * Return an Epsagon trace ID to put in the request headers.
 * @returns {string} Epsagon trace id.
 */
function generateEpsagonTraceId() {
    const traceId = uuid4();
    const hexTraceId = uuidToHex(traceId);
    const spanId = uuidToHex(uuid4()).slice(16);
    const parentSpanId = uuidToHex(uuid4()).slice(16);

    return `${hexTraceId}:${spanId}:${parentSpanId}:1`;
}


/**
 * Checks if API Gateway details appear in the headers, and update event accordingly
 * @param {object} headers data
 * @param {Resource} resource object
 * @param {Event} httpEvent object
 */
function updateAPIGateway(headers, resource, httpEvent) {
    if (headers && 'x-amzn-requestid' in headers) {
        // This is a request to AWS API Gateway
        resource.setType('api_gateway');
        eventInterface.addToMetadata(httpEvent, {
            request_trace_id: headers['x-amzn-requestid'],
        });
    }
}

module.exports = {
    isURLIgnoredByUser,
    resolveHttpPromise,
    USER_AGENTS_BLACKLIST,
    URL_BLACKLIST,
    generateEpsagonTraceId,
    updateAPIGateway,
};
