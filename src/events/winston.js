const tracer = require('../tracer.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wrap bunyan logs
 * @param {Function} wrappedFunction The function to wrap from bunyan
 * @returns {function} emit wrapper function
 */
function writeWrapper(wrappedFunction) {
    return function internalWriteWrapper(chunk, encoding, callback) {
        if (!tracer.isLoggingTracingEnabled()) {
            return wrappedFunction.apply(this, [chunk, encoding, callback]);
        }
        const traceId = tracer.getTraceId();
        if (!traceId) {
            return wrappedFunction.apply(this, [chunk, encoding, callback]);
        }

        if (!chunk || typeof chunk !== 'object') {
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
