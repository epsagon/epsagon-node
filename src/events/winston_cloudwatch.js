const Hook = require('require-in-the-middle');
const utils = require('../utils');

const additionalTags = {};


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
            additionalTags.CLOUDWATCH_LOG_GROUP_NAME = options.logGroupName;
            additionalTags.CLOUDWATCH_LOG_STREAM_NAME = options.logStreamName;
        } catch (e) {
            utils.debugLog('failed to set cloudwatch-winston log parameters', e);
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
     * @return {Object} additional tags set by winston-cloudwatch
     */
    getAdditionalTags() {
        return {
            ...additionalTags,
        };
    },
};
