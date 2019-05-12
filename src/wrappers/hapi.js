/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Hapi instrumentation
 */

const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const traceContext = require('../trace_context.js');
const eventInterface = require('../event.js');
const hapiRunner = require('../runners/hapi.js');

const Hapi = tryRequire('hapi');


/**
 * Handles Hapi's response
 * @param {Object} hapiEvent Runner event object
 * @param {Object} request The Hapi's request data
 * @param {Object} response The Hapi's response data
 * @param {Date} startTime Event start time
 * @param {Error} hapiErr Optional error in case happened in route
 */
function handleResponse(hapiEvent, request, response, startTime, hapiErr) {
    try {
        hapiRunner.finishRunner(hapiEvent, request, response, startTime);
        if (hapiErr) {
            eventInterface.setException(hapiEvent, hapiErr);
        }
    } catch (err) {
        tracer.addException(err);
    }
    tracer.sendTrace(() => {});
}


/**
 * Hapi requests middleware
 * @param {Object} request The Hapi's request data
 * @param {Object} h The Hapi's response data
 * @param {Function} originalHandler function for the Hapi's route
 * @return {Object} response
 */
function hapiMiddleware(request, h, originalHandler) {
    // Initialize tracer
    tracer.restart();

    let hapiEvent;
    const startTime = Date.now();
    try {
        hapiEvent = hapiRunner.createRunner(request, startTime);
        tracer.addRunner(hapiEvent);
    } catch (err) {
        utils.debugLog(err);
        return originalHandler(request, h);
    }

    // Inject trace functions
    const { label, setError } = tracer;
    request.epsagon = {
        label,
        setError,
    };

    // Run the request, activate the context
    const response = originalHandler(request, h);

    // Handle response
    response.then(() => {
        handleResponse(hapiEvent, request, response, startTime);
    }).catch((err) => {
        handleResponse(hapiEvent, request, response, startTime, err);
    });

    return response;
}


/**
 * Wraps the Hapi route function with tracing
 * @param {Function} wrappedFunction Hapi's route init function
 * @return {Function} updated wrapped init
 */
function hapiRouteWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalHapiRouteWrapper() {
        const originalHandler = arguments[0].handler;
        // Changing the original handler to the middleware
        arguments[0].handler = (request, h) => traceContext.RunInContext(
            tracer.createTracer,
            () => hapiMiddleware(request, h, originalHandler)
        );
        return wrappedFunction.apply(this, arguments);
    };
}


/**
 * Wraps the Hapi module request function with tracing
 * @param {Function} wrappedFunction Hapi init function
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
     * Initializes the Hapi tracer
     */
    init() {
        if (Hapi && Hapi.server) {
            shimmer.wrap(Hapi, 'server', hapiServerWrapper);
        }
    },
};
