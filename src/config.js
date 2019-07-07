/**
 * @fileoverview configurations for Epsagon library
 */
const consts = require('./consts.js');

// User-defined HTTP minimum status code to be treated as an error.
module.exports.HTTP_ERR_CODE = parseInt(process.env.EPSAGON_HTTP_ERR_CODE, 10) || 400;

/**
 * process each ignored key to make `studentId` ignore `student_id` as well
 * @param {string} key the key to process
 * @returns {string} key after process
 */
module.exports.processIgnoredKey = function processIgnoredKey(key) {
    return key
        .toLowerCase()
        .replace('-', '')
        .replace('_', '')
        .replace(/\s/g, '');
};

/**
 * configuration singleton. preconfigured with default values.
 */
const config = {
    token: process.env.EPSAGON_TOKEN || '',
    appName: process.env.EPSAGON_APP_NAME || 'Application',
    metadataOnly: (process.env.EPSAGON_METADATA || '').toUpperCase() === 'TRUE',
    useSSL: (process.env.EPSAGON_SSL || 'TRUE').toUpperCase() === 'TRUE',
    traceCollectorURL: consts.TRACE_COLLECTOR_URL,
    isEpsagonDisabled: (process.env.DISABLE_EPSAGON || '').toUpperCase() === 'TRUE',
    urlPatternsToIgnore: [],
    ignoredKeys: (process.env.EPSAGON_IGNORED_KEYS || '').split(',').map(module.exports.processIgnoredKey),
    /**
     * get isEpsagonPatchDisabled
     * @return {boolean} True if DISABLE_EPSAGON or DISABLE_EPSAGON_PATCH are set to TRUE, false
     *     otherwise
     */
    get isEpsagonPatchDisabled() {
        return this.isEpsagonDisabled || (process.env.DISABLE_EPSAGON_PATCH || '').toUpperCase() === 'TRUE';
    },
};

if (process.env.EPSAGON_URLS_TO_IGNORE) {
    config.urlPatternsToIgnore = process.env.EPSAGON_URLS_TO_IGNORE.split(',');
}

/**
 * @returns {object} The config object
 */
module.exports.getConfig = function getConfig() {
    return config;
};


/**
 * Initializes the configuration
 * @param {object} configData user's configuration
 */
module.exports.setConfig = function setConfig(configData) {
    if (configData === undefined) return;

    if (configData.token) {
        config.token = configData.token;
    }

    if (configData.appName) {
        config.appName = configData.appName;
    }

    if (configData.metadataOnly !== undefined && configData.metadataOnly != null) {
        config.metadataOnly = configData.metadataOnly;
    }

    // Set custom URL if defined
    if (configData.traceCollectorURL) {
        config.traceCollectorURL = configData.traceCollectorURL;
    }

    // Use SSL
    if (configData.useSSL) {
        config.traceCollectorURL = config.traceCollectorURL.replace('http:', 'https:');
        config.useSSL = configData.useSSL;
    }

    // User-defined URL blacklist.
    if (configData.urlPatternsToIgnore) {
        config.urlPatternsToIgnore = configData.urlPatternsToIgnore;
    }

    // User-defined HTTP minimum status code to be treated as an error.
    if (configData.httpErrorStatusCode) {
        module.exports.HTTP_ERR_CODE = configData.httpErrorStatusCode;
    }

    if (configData.ignoredKeys) {
        config.ignoredKeys = configData.ignoredKeys.map(module.exports.processIgnoredKey);
    }
};
