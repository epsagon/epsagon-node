const tracer = require('../tracer.js');
const moduleUtils = require('./module_utils.js');

/**
 * returns the trace id if message should be traced, or null if not.
 * @param {Object} chunk the chunk to add id to
 * @return {string|null} The trace id, or null if the message shouldn't
 * be traced
 */
function getTraceIdIfShouldTrace(chunk) {
    if (!chunk || typeof chunk !== 'object' || !tracer.isLoggingTracingEnabled()) {
        return null;
    }

    return tracer.getTraceId();
}
/**
 * Wrap bunyan logs
 * @param {Function} wrappedFunction The function to wrap from bunyan
 * @returns {function} emit wrapper function
 */
function writeWrapper(wrappedFunction) {
    return function internalWriteWrapper(chunk, encoding, callback) {
        const traceId = getTraceIdIfShouldTrace(chunk);
        if (!traceId) {
            return wrappedFunction.apply(this, [chunk, encoding, callback]);
        }

        const newChunk = {
            epsagon: {
                trace_id: traceId,
            },
        };
        /* eslint-disable guard-for-in, no-restricted-syntax */
        for (const key in chunk) {
            newChunk[key] = chunk[key];
        }

        /* eslint-disable no-restricted-syntax */
        for (const symbol of Object.getOwnPropertySymbols(chunk)) {
            newChunk[symbol] = chunk[symbol];
        }

        tracer.addLoggingTracingEnabledMetadata();

        return wrappedFunction.apply(this, [newChunk, encoding, callback]);
    };
}

module.exports = {
    /**
     * Initializes the bunyan log tracer
     */
    init() {
        moduleUtils.patchModule(
            'winston/lib/winston/logger',
            'write',
            writeWrapper,
            Logger => Logger.prototype
        );
    },
};
