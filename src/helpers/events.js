const consts = require('../consts.js');

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

/**
 * Checks if a key is in the STRONG_ID_KEYS array.
 * @param {string} key Event key.
 * @returns {boolean} True if is in the STRONG_ID_KEYS array, False otherwise.
 */
const isStrongId = (key) => consts.STRONG_ID_KEYS.includes(key.toLowerCase().replace(' ', '_'));

module.exports = {
    isBlacklistURL, isBlacklistHeader, isStrongId,
};
