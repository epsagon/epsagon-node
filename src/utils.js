/**
 * @fileoverview Utility functions
 */

/**
 * Creates a timestamp (according to epsagon-protocol timestamp format) from a given js time
 * @param {number} time the time in miliseconds to generate the timestamp from
 * @return {double} the time in epsagon's fomat
 */
function createTimestampFromTime(time) {
    return time / 1000;
}

/**
 * Creates a timestamp (according to epsagon-protocol timestamp format) of the current time
 * @return {double} the time in epsagon's fomat
 */
function createTimestamp() {
    return createTimestampFromTime(Date.now());
}

/**
 * Creates a timestamp (according to epsagon-protocol timestamp format) describing the time elapsed
 * since a given time until now
 * @param {integer} startTime The time to start counting from
 * @return {double} the duration in epsagon's timestamp fomat
 */
function createDurationTimestamp(startTime) {
    return createTimestampFromTime(Date.now() - startTime);
}

/**
 * Reflects a promise to always resolve, and indicate the original resolve/rejection status via the
 * resolved value
 * @param {Promise} promise The promise to reflect
 * @return {Promise} The reflected promise
 */
function reflectPromise(promise) {
    return promise
        .then(value => ({ value, status: 'resolved' }))
        .catch(error => ({ error, status: 'rejected' }));
}

/**
 * Prints a log if debugging is enabled
 * @param {list} args list of arguments as passed to console.log
 */
function debugLog(...args) {
    if (process.env.EPSAGON_DEBUG === 'TRUE') {
        console.log(...args); // eslint-disable-line no-console
    }
}

module.exports.createTimestampFromTime = createTimestampFromTime;
module.exports.createTimestamp = createTimestamp;
module.exports.createDurationTimestamp = createDurationTimestamp;
module.exports.reflectPromise = reflectPromise;
module.exports.debugLog = debugLog;
