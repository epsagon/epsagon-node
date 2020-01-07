
const uuid4 = require('uuid4');
const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');
const tracer = require('../tracer.js');

/**
 * Create and initialize a new serverless event in the epsagon format.
 * @param {string} resourceType resourceType name
 * @param {string} name Event name
 * @param {string} operation Operation name
 * @param {string} origin Origin name (optional)
 * @returns {Object} Object with dnsEvent and event start time.
 */
const initialEvent = (resourceType, name, operation, origin) => {
    const startTime = Date.now();
    const resource = new serverlessEvent.Resource([
        name,
        resourceType,
        operation,
    ]);
    const event = new serverlessEvent.Event([
        `${resourceType}-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        origin || resourceType,
        0,
        errorCode.ErrorCode.OK,
    ]);
    event.setResource(resource);
    return { event, startTime };
};

/**
 * Adding callback data/error to event, and finalize event.
 * @param {serverlessEvent.Event} event Serverless event.
 * @param {number} startTime Event start time.
 * @param {Error} error Callback error.
 * @param {string[] | Object[] | Object} metadata Callback metadata.
 */
const finalizeEvent = (event, startTime, error, metadata) => {
    try {
        if (error) {
            eventInterface.setException(event, error);
        } else if (metadata) {
            eventInterface.addToMetadata(event, metadata);
        }
        event.setDuration(utils.createDurationTimestamp(startTime));
    } catch (err) {
        tracer.addException(err);
    }
};

/**
 * Checks if a URL is in the blacklist
 * @param {string} url The URL to check
 * @param {object} urlBlacklist Object of blacklist url objects (KEY=[url], VALUE=[condition]).
 * @param {string} path The Path to check (optional)
 * @returns {boolean} True if it is in the blacklist, False otherwise
 */
const isBlacklistURL = (url, urlBlacklist, path) => Object.keys(urlBlacklist).some((key) => {
    if (typeof urlBlacklist[key] === typeof (() => {})) {
        return urlBlacklist[key](url, key, path);
    }
    return url[urlBlacklist[key]](key);
});

/**
 * Checks if a user agent header is in the blacklist
 * @param {string} headers The Headers to check.
 * @param {Array} userAgentsBlacklist Array of blacklist user agents.
 * @returns {boolean} True if it is in the blacklist, False otherwise
 */
const isBlacklistHeader = (headers, userAgentsBlacklist) => {
    if (headers) {
        return userAgentsBlacklist.includes(headers['user-agent']);
    }
    return false;
};

module.exports = {
    isBlacklistURL, isBlacklistHeader, initialEvent, finalizeEvent,
};
