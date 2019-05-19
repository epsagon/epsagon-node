/**
 * @fileoverview Utility functions
 */

/**
 * Creates a timestamp (according to epsagon-protocol timestamp format) from a given js time
 * @param {number} time the time in miliseconds to generate the timestamp from
 * @return {double} the time in epsagon's format
 */
function createTimestampFromTime(time) {
    return time / 1000;
}

/**
 * Creates a timestamp (according to epsagon-protocol timestamp format) of the current time
 * @return {double} the time in epsagon's format
 */
function createTimestamp() {
    return createTimestampFromTime(Date.now());
}

/**
 * Creates a timestamp (according to epsagon-protocol timestamp format) describing the time elapsed
 * since a given time until now
 * @param {integer} startTime The time to start counting from
 * @return {double} the duration in epsagon's timestamp format
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
    if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
        console.log(...args); // eslint-disable-line no-console
    }
}

/**
 * This function allow you to modify a JS Promise by adding some status properties.
 * Based on: http://stackoverflow.com/questions/21485545/is-there-a-way-to-tell-if-an-es6-promise-is-fulfilled-rejected-resolved
 * But modified according to the specs of promises : https://promisesaplus.com/
 * @param {Promise} promise the promise to make queryable
 * @return {Promise} the queryable promise
 */
function makeQueryablePromise(promise) {
    // Don't modify any promise that has been already modified.
    if (promise.isResolved) return promise;

    // Set initial state
    let isPending = true;
    let isRejected = false;
    let isFulfilled = false;

    // Observe the promise, saving the fulfillment in a closure scope.
    const result = promise.then(
        (v) => {
            isFulfilled = true;
            isPending = false;
            return v;
        },
        (e) => {
            isRejected = true;
            isPending = false;
            throw e;
        }
    );

    result.isFulfilled = () => isFulfilled;
    result.isPending = () => isPending;
    result.isRejected = () => isRejected;
    return result;
}

module.exports.createTimestampFromTime = createTimestampFromTime;
module.exports.createTimestamp = createTimestamp;
module.exports.createDurationTimestamp = createDurationTimestamp;
module.exports.reflectPromise = reflectPromise;
module.exports.debugLog = debugLog;
module.exports.makeQueryablePromise = makeQueryablePromise;
