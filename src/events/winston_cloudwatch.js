const Hook = require('require-in-the-middle');
const utils = require('../utils');
const tracer = require('../tracer');
const tryRequire = require('../try_require');

const AWS = tryRequire('aws-sdk');

const logDestinations = [];

/**
 * loads data from aws metadata to additional tags
 * @param {Object} options options cloudwatch winston was initialized with
 * @returns {Promise} resolves when metadata was loaded with the destination
 */
function loadAWSLogDestination(options) {
    if (!AWS) {
        return Promise.resolve();
    }

    const destination = {};
    destination.log_group_name = options.logGroupName;
    destination.log_stream_name = options.logStreamName;
    const sts = new AWS.STS();
    const cwConfig = (options.cloudWatchLogs && options.cloudWatchLogs.config) || {};
    destination.region = (
        options.awsRegion ||
        cwConfig.region ||
        AWS.config.region ||
        process.env.AWS_REGION
    );
    return sts.getCallerIdentity().promise().then((data) => {
        destination.account_id = data.Account;
        return destination;
    });
}

/**
 * Capture winston-cloudwatch require
 * @param {Function} exports returned from requiring the module
 * @returns {Object} overriden exports
 */
function onWinstonCloudwatchRequire(exports) {
    utils.debugLog('winston-cloudwatch required');
    if (typeof exports !== 'function') {
        utils.debugLog('winston-cloudwatch got non-function exports', typeof exports, exports);
        return exports;
    }
    // eslint-disable-next-line no-underscore-dangle
    if (exports.__epsagon_wrapped) {
        utils.debugLog('winston-cloudwatch already hooked');
        return exports;
    }

    // eslint-disable-next-line no-underscore-dangle,require-jsdoc
    function wrapper(...args) {
        const [options] = args;
        try {
            utils.debugLog('winston-cloudwatch instance created');
            loadAWSLogDestination(options)
                .then((dest) => logDestinations.push(dest))
                .catch((err) => tracer.addException(err));
        } catch (e) {
            utils.debugLog('failed to set cloudwatch-winston log parameters', e);
            tracer.addException(e);
        }
        return exports.apply(this, args);
    }

    wrapper.prototype = Object.create(exports.prototype);

    // eslint-disable-next-line no-param-reassign,no-underscore-dangle
    exports.__epsagon_wrapped = true;

    utils.debugLog('winston-cloudwatch require patching done');
    return wrapper;
}

module.exports = {
    /**
     * Initializes the bunyan log tracer
     */
    init() {
        utils.debugLog('hooking winston-cloudwatch');
        Hook(['winston-cloudwatch'], onWinstonCloudwatchRequire);
        utils.debugLog('hooked winston-cloudwatch');
    },

    /**
     * @return {Array} log destinations for winston-cloudwatch
     */
    additionalMetadata() {
        return logDestinations.length ? {
            'aws.cloudwatch.log_destinations': logDestinations,
        } : {};
    },
};
