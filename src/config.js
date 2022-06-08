/**
 * @fileoverview configurations for Epsagon library
 */
const consts = require('./consts.js');
const utils = require('./utils.js');

// User-defined HTTP minimum status code to be treated as an error.
module.exports.HTTP_ERR_CODE = parseInt(process.env.EPSAGON_HTTP_ERR_CODE, 10) || 400;

/**
 * process each ignored key to make `studentId` ignore `student_id` as well
 * @param {string} key the key to process
 * @returns {string} key after process
 */
module.exports.prepareMatchingKey = function prepareMatchingKey(key) {
    return key
        .toLowerCase()
        .replace('-', '')
        .replace('_', '')
        .replace(/\s/g, '');
};

/**
 * process list of ignored keys, supporting String & RegExp. Warns if else
 * @param {Array<string | RegExp>}keys the list of keys to match
 * @return {Array<string | RegExp>} the list of keys to override in config
 */
module.exports.prepareMatchingKeys = function prepareMatchingKeys(keys) {
    const filteredKeys = keys
        .filter(key => key && (typeof key === 'string' || key instanceof RegExp));
    if (filteredKeys.length !== keys.length) {
        utils.printWarning(
            'Epsagon Deprecaion Warning: matched keys supports only strings and RegExp, other values will be ignored. Recieved Keys:',
            keys
        );
    }
    return keys.map(key => (typeof key === 'string' ? module.exports.prepareMatchingKey(key) : key));
};

/**
 * Tests if a value is found in keys
 * @param {Array<String | RegExp>} keys a list of keys to match
 * @param {string} testVal a value to search keys for
 * @returns {boolean} true for non-ignored keys
 */
module.exports.isKeyMatched = function isKeyMatched(keys, testVal) {
    return keys
        .some((key) => {
            // on a string key, convert to a looser fmt first
            // includes() can handle more edge cases than ===
            if (typeof key === 'string' && module.exports.prepareMatchingKey(testVal).includes(key)) {
                return true;
            }
            // on a regex key, test directly for a match
            if (key instanceof RegExp && key.test(testVal)) {
                return true;
            }
            return false;
        });
};

/**
 * The default sendTimeout to send for send operations (both sync and async)
 */
const DEFAULT_TIMEOUT_SEC = 1.0;

/**
 * configuration singleton. preconfigured with default values.
 */
const config = {
    token: process.env.EPSAGON_TOKEN || '',
    appName: process.env.EPSAGON_APP_NAME || 'Application',
    metadataOnly: (process.env.EPSAGON_METADATA || '').toUpperCase() === 'TRUE',
    useSSL: (process.env.EPSAGON_SSL || 'TRUE').toUpperCase() === 'TRUE',
    traceCollectorURL: process.env.EPSAGON_COLLECTOR_URL || consts.TRACE_COLLECTOR_URL,
    isEpsagonDisabled: (process.env.DISABLE_EPSAGON || '').toUpperCase() === 'TRUE',
    isConsolePatched: (process.env.EPSAGON_PATCH_CONSOLE || '').toUpperCase() === 'TRUE',
    urlPatternsToIgnore: [],
    ignoredDBTables: [],
    internalSampleRate: consts.DEFAULT_SAMPLE_RATE,
    labels: {},
    keysToAllow: [],
    sendOnlyErrors: (process.env.EPSAGON_SEND_TRACE_ON_ERROR || '').toUpperCase() === 'TRUE',
    removeIgnoredKeys: (process.env.EPSAGON_REMOVE_IGNORED_KEYS || '').toUpperCase() === 'TRUE',
    sendTimeout: (Number(process.env.EPSAGON_SEND_TIMEOUT_SEC) || DEFAULT_TIMEOUT_SEC) * 1000.0,
    decodeHTTP: (process.env.EPSAGON_DECODE_HTTP || 'TRUE').toUpperCase() === 'TRUE',
    disableHttpResponseBodyCapture: (process.env.EPSAGON_DISABLE_HTTP_RESPONSE || '').toUpperCase() === 'TRUE',
    allowErrMessageStatus: (process.env.EPSAGON_ALLOW_ERR_MESSAGE_STATUS || '').toUpperCase() === 'TRUE',
    loggingTracingEnabled: (process.env.EPSAGON_LOGGING_TRACING_ENABLED || (!utils.isLambdaEnv).toString()).toUpperCase() === 'TRUE',
    sendBatch: (process.env.EPSAGON_SEND_BATCH || (!utils.isLambdaEnv).toString()).toUpperCase() === 'TRUE',
    batchSize: (Number(process.env.EPSAGON_BATCH_SIZE) || consts.DEFAULT_BATCH_SIZE),
    maxTraceWait: (Number(process.env.EPSAGON_MAX_TRACE_WAIT) ||
     consts.MAX_TRACE_WAIT), // miliseconds
    maxBatchSizeBytes: consts.BATCH_SIZE_BYTES_HARD_LIMIT,
    maxQueueSizeBytes: consts.QUEUE_SIZE_BYTES_HARD_LIMIT,
    logTransportEnabled: (process.env.EPSAGON_LOG_TRANSPORT || 'FALSE').toUpperCase() === 'TRUE',

    /**
     * get isEpsagonPatchDisabled
     * @return {boolean} True if DISABLE_EPSAGON or DISABLE_EPSAGON_PATCH are set to TRUE, false
     *     otherwise
     */
    get isEpsagonPatchDisabled() {
        return this.isEpsagonDisabled || (process.env.DISABLE_EPSAGON_PATCH || '').toUpperCase() === 'TRUE';
    },

    /**
     * @return {Number} the current sample rate
     */
    get sampleRate() {
        return this.internalSampleRate;
    },

    /**
     * updates the sampling rate, if input is valid
     * @param {String | Number} newRate The new rate to use
     */
    set sampleRate(newRate) {
        const newParsedRate = parseFloat(newRate);
        if (!Number.isNaN(newParsedRate)) {
            this.internalSampleRate = newParsedRate;
        }
    },
};

if (process.env.EPSAGON_SAMPLE_RATE) {
    config.sampleRate = process.env.EPSAGON_SAMPLE_RATE;
}
if (process.env.EPSAGON_URLS_TO_IGNORE) {
    config.urlPatternsToIgnore = process.env.EPSAGON_URLS_TO_IGNORE.split(',');
}

if (process.env.EPSAGON_IGNORED_DB_TABLES) {
    config.ignoredDBTables = process.env.EPSAGON_IGNORED_DB_TABLES.split(',');
}

if (process.env.EPSAGON_IGNORED_KEYS) {
    config.ignoredKeys = module.exports.prepareMatchingKeys(process.env.EPSAGON_IGNORED_KEYS.split(','));
}

if (process.env.EPSAGON_ALLOWED_KEYS) {
    config.keysToAllow = module.exports.prepareMatchingKeys(process.env.EPSAGON_ALLOWED_KEYS.split(','));
}

if ((process.env.EPSAGON_SSL || 'TRUE').toUpperCase() === 'FALSE') {
    config.traceCollectorURL = config.traceCollectorURL.replace('https:', 'http:');
}

if ((process.env.EPSAGON_SSL || 'TRUE').toUpperCase() === 'TRUE') {
    config.traceCollectorURL = config.traceCollectorURL.replace('http:', 'https:');
}

const skipReturnValue = (process.env.EPSAGON_SKIP_RETURN_VALUE || '').toUpperCase() === 'TRUE';
config.addReturnValue = !skipReturnValue;

if (process.env.EPSAGON_PATCH_WHITELIST) {
    config.patchWhitelist = process.env.EPSAGON_PATCH_WHITELIST.split(',');
}

if (process.env.EPSAGON_PAYLOADS_TO_IGNORE) {
    config.ignoredPayloads = JSON.parse(process.env.EPSAGON_PAYLOADS_TO_IGNORE);
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

    if (configData.isEpsagonDisabled) {
        config.isEpsagonDisabled = configData.isEpsagonDisabled;
    }

    // Set addReturnValue for lambda
    if (configData.addReturnValue || configData.addReturnValue === false) {
        config.addReturnValue = configData.addReturnValue;
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
    if (configData.useSSL === false) {
        config.traceCollectorURL = config.traceCollectorURL.replace('https:', 'http:');
        config.useSSL = configData.useSSL;
    }
    if (configData.useSSL) {
        config.traceCollectorURL = config.traceCollectorURL.replace('http:', 'https:');
        config.useSSL = configData.useSSL;
    }
    // Check if traceCollector run locally
    if (configData.useLocalCollector) {
        config.traceCollectorURL = consts.LOCAL_URL;
    }

    // User-defined URL blacklist.
    if (configData.urlPatternsToIgnore) {
        config.urlPatternsToIgnore = configData.urlPatternsToIgnore;
    }

    // Send traces only on errors.
    if (configData.sendOnlyErrors) {
        config.sendOnlyErrors = configData.sendOnlyErrors;
    }

    // User-defined HTTP minimum status code to be treated as an error.
    if (configData.httpErrorStatusCode) {
        module.exports.HTTP_ERR_CODE = configData.httpErrorStatusCode;
    }

    // Whether to decode HTTP responses (with gzip, brotli, etc.).
    if (configData.decodeHTTP === false) {
        config.decodeHTTP = configData.decodeHTTP;
    }

    // Whether to ignore HTTP responses capture
    if (configData.disableHttpResponseBodyCapture) {
        config.disableHttpResponseBodyCapture = configData.disableHttpResponseBodyCapture;
    }

    // Keys to automatically capture and label
    if (configData.keysToAllow) {
        config.keysToAllow = module.exports.prepareMatchingKeys(configData.keysToAllow);
    }

    // User-defined DB Table response blacklist
    if (configData.ignoredDBTables && Array.isArray(configData.ignoredDBTables)) {
        config.ignoredDBTables = module.exports.prepareMatchingKeys(configData.ignoredDBTables);
    }

    if (configData.ignoredKeys && Array.isArray(configData.ignoredKeys)) {
        config.ignoredKeys = module.exports.prepareMatchingKeys(configData.ignoredKeys);
    }

    if (configData.removeIgnoredKeys) {
        config.removeIgnoredKeys = configData.removeIgnoredKeys;
    }

    if (configData.sampleRate !== null && config.sampleRate !== undefined) {
        config.sampleRate = configData.sampleRate;
    }

    if (Number(configData.sendTimeout)) { // we do not allow 0 as a timeout
        config.sendTimeout = Number(configData.sendTimeout);
    }

    if (typeof configData.sendBatch === 'boolean') {
        config.sendBatch = configData.sendBatch;
    }

    if (config.sendBatch) {
        utils.debugLog(`Trace batching activated. Traces might be ignored till ${config.batchSize} traces queue size reached.`);
    }

    if (Number(configData.batchSize)) {
        config.batchSize = Number(configData.batchSize);
    }
    if (Number(configData.maxTraceWait)) {
        config.maxTraceWait = Number(configData.maxTraceWait);
    }
    if (Number(configData.maxBatchSizeBytes)) {
        if (Number(configData.maxBatchSizeBytes) > consts.QUEUE_SIZE_BYTES_HARD_LIMIT) {
            utils.debugLog(`User configured maxBatchSizeBytes exceeded batch size hard limit of ${consts.BATCH_SIZE_BYTES_HARD_LIMIT} Bytes`);
        } else {
            config.maxBatchSizeBytes = Number(configData.maxBatchSizeBytes);
        }
    }

    if (Number(configData.maxQueueSizeBytes)) {
        if (Number(configData.maxQueueSizeBytes) > consts.QUEUE_SIZE_BYTES_HARD_LIMIT) {
            utils.debugLog(`User configured maxQueueSizeBytes exceeded queue size hard limit of ${consts.QUEUE_SIZE_BYTES_HARD_LIMIT} Bytes`);
        } else {
            config.maxQueueSizeBytes = Number(configData.maxQueueSizeBytes);
        }
    }


    if (configData.labels) {
        config.labels = utils.flatten([...configData.labels].reduce((labels, label) => {
            const [key, value] = label;
            return {
                ...labels,
                [key]: value,
            };
        }, {}));
    }
};
