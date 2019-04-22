const trace = require('./proto/trace_pb.js');
const consts = require('./consts.js');

/**
 * The tracer singleton, used to manage the trace and send it at the end of the function invocation.
 * In a Lambda environment we use this singleton, while in other environment we use the one from
 * the context.
 */
module.exports.tracer = null;


/**
 * Creates a new Trace object
 * @returns {Trace} new Trace
 */
module.exports.createTracer = function createTracer() {
    const tracerObj = new trace.Trace([
        '',
        '',
        [],
        [],
        consts.VERSION,
        `node ${process.versions.node}`,
    ]);
    // The requests promises pending to resolve. All must be resolved before sending the trace.
    // A Map containing (event, promise) pairs.
    return {
        trace: tracerObj,
        currRunner: null,
        pendingEvents: new Map(),
    };
};

module.exports.get = () => module.exports.tracer;

module.exports.init = () => module.exports.tracer = module.exports.createTracer();