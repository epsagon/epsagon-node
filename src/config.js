/**
 * @fileoverview configurations for Epsagon library
 */
const consts = require('./consts.js');

/**
 * configuration singleton. preconfigured with default values.
 */
module.exports.config = {
    token: '',
    appName: 'Application',
    metadataOnly: true,
    useSSL: false,
    traceCollectorURL: consts.TRACE_COLLECTOR_URL,
    isEpsagonDisabled: process.env.DISABLE_EPSAGON === 'TRUE',
    /**
     * get isEpsagonPatchDisabled
     * @return {boolean} True if DISABLE_EPSAGON or DISABLE_EPSAGON_PATCH are set to TRUE, false
     *     otherwise
     */
    get isEpsagonPatchDisabled() {
        return this.isEpsagonDisabled || process.env.DISABLE_EPSAGON_PATCH === 'TRUE';
    },
};

/**
 * @returns {object} The config object
 */
module.exports.getConfig = function getConfig() {
    return module.exports.config;
};


/**
 * Initializes the configuration
 * @param {object} configData user's configuration
 */
module.exports.setConfig = function setConfig(configData) {
    if (configData === undefined) return;

    if (configData.token) {
        module.exports.config.token = configData.token;
    }

    if (configData.appName) {
        module.exports.config.appName = configData.appName;
    }

    if (configData.metadataOnly !== undefined && configData.metadataOnly != null) {
        module.exports.config.metadataOnly = configData.metadataOnly;
    }

    // Set custom URL if defined
    if (configData.traceCollectorURL) {
        module.exports.config.traceCollectorURL = configData.traceCollectorURL;
    }

    // Use SSL
    if (configData.useSSL) {
        module.exports.config.traceCollectorURL = module.exports.config.traceCollectorURL.replace('http:', 'https:');
        module.exports.config.useSSL = configData.useSSL;
    }
};
