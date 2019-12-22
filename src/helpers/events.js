
/**
 * Checks if a URL is in the blacklist
 * @param {string} url The URL to check
 * @param {object} URL_BLACKLIST Object of blacklist url objects (KEY=[url], VALUE=[condition]).
 * @param {string} path The Path to check (optional)
 * @returns {boolean} True if it is in the blacklist, False otherwise
 */
const isBlacklistURL = (url, URL_BLACKLIST, path) => Object.keys(URL_BLACKLIST).some((key) => {
    if (typeof URL_BLACKLIST[key] === typeof (() => {})) {
        return URL_BLACKLIST[key](url, key, path);
    }
    return url[URL_BLACKLIST[key]](key);
});

/**
 * Checks if a user agent header is in the blacklist
 * @param {string} headers The Headers to check.
 * @param {Array} USER_AGENTS_BLACKLIST Array of blacklist user agents.
 * @returns {boolean} True if it is in the blacklist, False otherwise
 */
const isBlacklistHeader = (headers, USER_AGENTS_BLACKLIST) => {
    if (headers) {
        return USER_AGENTS_BLACKLIST.includes(headers['user-agent']);
    }
    return false;
};

module.exports = { isBlacklistURL, isBlacklistHeader };
