/**
 * @fileoverview holds tracer singleton.
 */
const tracerModule = require('./tracer.js');

/**
 * The tracer singleton, used to manage the trace and send it at the end of the function invocation.
 * In a Lambda environment we use this singleton, while in other environment we use the one from
 * the context.
 */
module.exports.tracer = null;


/**
 * The tracer singleton getter function
 * @returns {Object} tracer object
 */
module.exports.get = () => {
    if (!module.exports.tracer) {
        module.exports.tracer = tracerModule.createTracer();
    }
    return module.exports.tracer;
};
