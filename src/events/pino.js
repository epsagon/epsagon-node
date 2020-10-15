const tracer = require('../tracer.js');
const moduleUtils = require('./module_utils.js');


/**
 * Wrap pino logs
 * @param {Function} wrappedFunction The function to wrap from winston
 * @returns {function} asJson wrapper function
 */
function logWrapper(wrappedFunction) {
    return function internalLogWrapper(obj, msg, num, time) {
        if (!tracer.isLoggingTracingEnabled()) {
            return wrappedFunction.apply(this, [obj, msg, num, time]);
        }
        const traceId = tracer.getTraceId();
        if (!traceId) {
            return wrappedFunction.apply(this, [obj, msg, num, time]);
        }

        /* eslint-disable no-param-reassign */
        obj.epsagon = {
            trace_id: traceId,
        };

        tracer.addLoggingTracingEnabledMetadata();

        return wrappedFunction.apply(this, [obj, msg, num, time]);
    };
}

module.exports = {
    /**
     * Initializes the pino log tracer
     */
    init() {
        moduleUtils.patchModule(
            'pino/lib/tools',
            'asJson',
            logWrapper
        );
    },
};
