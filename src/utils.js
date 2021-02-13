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
 * Check if an object is a Promise.
 * @param {Object} object the time in miliseconds to generate the timestamp from
 * @return {Boolean} true if promise, else - false.
 */
function isPromise(object) {
    return !!object && typeof object.then === 'function';
}

/**
 * Check if a key is in object and return its value if it does.
 * @param {Object} object the object to look for the key
 * @param {Object} key the key to look for
 * @return {Object} key
 */
function getValueIfExist(object, key) {
    return key in object ? object[key] : undefined;
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
        .then((value) => ({ value, status: 'resolved' }))
        .catch((error) => ({ error, status: 'rejected' }));
}

/**
 * Prints a log if debugging is enabled
 * @param {list} args list of arguments as passed to console.log
 */
function debugLog(...args) {
    if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
        console.log('[EPSAGON]', ...args); // eslint-disable-line no-console
    }
}

/**
 * Prints a warning
 * @param {list} args list of arguments as passed to console.warn
 */
function printWarning(...args) {
    console.warn(...args); // eslint-disable-line no-console
}

/**
 * Prints a error
 * @param {list} args list of arguments as passed to console.error
 */
function printError(...args) {
    console.error(...args); // eslint-disable-line no-console
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

/**
 * Flatten given dictionary
 * @param {Object} target the target dictionary
 * @return {Object} flatten dictionary
 */
function flatten(target) {
    const delimiter = '.';
    const output = {};

    /**
     * Recursive function in the flatten process
     * @param {Object} object the current step's value
     * @param {string} prev the key from previous step
     * @param {integer} currentDepth the current depth number
     */
    function step(object, prev, currentDepth) {
        const depthNumber = currentDepth || 1;
        Object.keys(object).forEach((key) => {
            const value = object[key];
            if (value == null) return null;
            const isArray = Array.isArray(value);
            const type = Object.prototype.toString.call(value);
            const isObject = (
                type === '[object Object]' ||
                type === '[object Array]'
            );

            const newKey = prev ? prev + delimiter + key : key;

            if (!isArray && !Buffer.isBuffer(value) && isObject && Object.keys(value).length) {
                return step(value, newKey, depthNumber + 1);
            }

            if (value != null && ['string', 'number', 'boolean'].includes(typeof value)) {
                output[newKey] = value;
            }

            return null;
        });
    }
    step(target);
    return output;
}

/**
 * Function to split string into array, which return the last element of the array.
 * @param {string} string String to be split.
 * @param {string} seperator Character to split the string.
 * @returns {string} Last splitted array item.
 */
const getLastSplittedItem = (string, seperator) => {
    const splittedArray = (string && string.split(seperator)) || [];
    return splittedArray[splittedArray.length - 1];
};

const isLambdaEnv = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/**
 * Function to truncate a long string to a maximum length.
 * @param {string} message to be trancated.
 * @param {integer} maxSize maximum message length.
 * @returns {string} First `maxSize` characters of `message`.
 */
function truncateMessage(message, maxSize) {
    if (message.length <= maxSize) {
        return message;
    }
    return message.slice(0, maxSize);
}

module.exports.createTimestampFromTime = createTimestampFromTime;
module.exports.createTimestamp = createTimestamp;
module.exports.createDurationTimestamp = createDurationTimestamp;
module.exports.reflectPromise = reflectPromise;
module.exports.debugLog = debugLog;
module.exports.printWarning = printWarning;
module.exports.printError = printError;
module.exports.makeQueryablePromise = makeQueryablePromise;
module.exports.flatten = flatten;
module.exports.getLastSplittedItem = getLastSplittedItem;
module.exports.isPromise = isPromise;
module.exports.isLambdaEnv = isLambdaEnv;
module.exports.getValueIfExist = getValueIfExist;
module.exports.truncateMessage = truncateMessage;
