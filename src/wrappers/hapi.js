/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Express instrumentation
 */

const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const traceContext = require('../trace_context.js');
const hapiRunner = require('../runners/hapi.js');

const Hapi = tryRequire('hapi');


/**
 * Express requests middleware
 * @param {Request} req The Express's request data
 * @param {Response} res The Express's response data
 * @param {Function} next express function
 */
function hapiMiddleware(request, h, originalHandler) {
    // Initialize tracer
    const tracerObj = tracer.createTracer();
    tracer.traceGetter = traceContext.getTracer;
    tracer.restart(tracerObj);

    let hapiEvent;
    const startTime = Date.now();
    try {
        hapiEvent = hapiRunner.createRunner(request, startTime);
        tracer.addRunner(hapiEvent, undefined, tracerObj);
    } catch (err) {
        utils.debugLog(err);
    }

    // Inject trace functions
    request.epsagon = {
        label: tracer.label,
        setError: tracer.setError,
    };

    // Run the request, activate the context
    const response = traceContext.RunInContextAndReturn(
        tracerObj,
        () => originalHandler(request, h)
    );

    try {
        hapiRunner.finishRunner(hapiEvent, request, response, startTime);
//        tracer.sendTrace(() => {}, tracerObj);
    } catch (err) {
        tracer.addException(err, tracerObj);
    }

    return response
}


/**
 * Wraps the Hapi module request function with tracing
 * @param {Function} wrappedFunction Express init function
 * @return {Function} updated wrapped init
 */
function hapiRouteWrapper(wrappedFunction) {
    return function internalHapiRouteWrapper() {
        const originalHandler = arguments[0].handler
        arguments[0].handler = (request, h) => {
            return hapiMiddleware(request, h, originalHandler)
        }
        return wrappedFunction.apply(this, arguments);
    };
}


/**
 * Wraps the Express module request function with tracing
 * @param {Function} wrappedFunction Express init function
 * @return {Function} updated wrapped init
 */
function hapiServerWrapper(wrappedFunction) {
    return function internalHapiServerWrapper() {
        const server = wrappedFunction.apply(this, arguments);
        if (server.route) {
            shimmer.wrap(server, 'route', hapiRouteWrapper);
        }
        return server;
    };
}


module.exports = {
    /**
     * Initializes the Express tracer
     */
    init() {
        if (Hapi && Hapi.server) {
            shimmer.wrap(Hapi, 'server', hapiServerWrapper);
        }
    },
};
