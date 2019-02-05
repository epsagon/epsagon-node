/**
 * @fileoverview configurations for Epsagon library
 */
const consts = require('./consts.js');

/**
 * configuration singleton. preconfigured with default values.
 */
const config = {
    token: process.env.EPSAGON_TOKEN || '',
    appName: process.env.EPSAGON_APP_NAME || 'Application',
    metadataOnly: false,
    useSSL: true,
    traceCollectorURL: consts.TRACE_COLLECTOR_URL,
    isEpsagonDisabled: (process.env.DISABLE_EPSAGON || '').toUpperCase() === 'TRUE',
    /**
     * get isEpsagonPatchDisabled
     * @return {boolean} True if DISABLE_EPSAGON or DISABLE_EPSAGON_PATCH are set to TRUE, false
     *     otherwise
     */
    get isEpsagonPatchDisabled() {
        return this.isEpsagonDisabled || (process.env.DISABLE_EPSAGON_PATCH || '').toUpperCase() === 'TRUE';
    },
};

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
};
