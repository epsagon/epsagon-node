const tracer = require('../tracer.js');
const moduleUtils = require('./module_utils.js');


/**
 * Wrap bunyan logs
 * @param {Function} wrappedFunction The function to wrap from bunyan
 * @returns {function} emit wrapper function
 */
function emitWrapper(wrappedFunction) {
    return function internalEmitWrapper(rec, ...args) {
        if (tracer.getLogId() === null) {
            return wrappedFunction.apply(this, [rec].concat(args));
        }

        const newRec = {
            epsagon: {
                log_id: tracer.getLogId(),
            },
        };

        if (!rec) {
            return wrappedFunction.apply(this, [rec].concat(args));
        }
        /* eslint-disable guard-for-in, no-restricted-syntax */
        for (const key in rec) {
            newRec[key] = rec[key];
        }

        /* eslint-disable no-restricted-syntax */
        for (const symbol of Object.getOwnPropertySymbols(rec)) {
            newRec[symbol] = rec[symbol];
        }

        return wrappedFunction.apply(this, [newRec].concat(args));
    };
}

module.exports = {
    /**
     * Initializes the bunyan log tracer
     */
    init() {
        moduleUtils.patchModule(
            'bunyan',
            '_emit',
            emitWrapper,
            bunyan => bunyan.prototype
        );
    },
};
