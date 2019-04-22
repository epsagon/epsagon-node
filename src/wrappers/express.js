/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Express instrumentation
 */

const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const traceContext = require('../trace_context.js');
const expressRunner = require('../runners/express.js');

const express = tryRequire('express');


/**
 * Express requests middleware
 * @param {Request} req The Express's request data
 * @param {Response} res The Express's response data
 * @param {Function} next express function
 */
function expressMiddleware(req, res, next) {
    // Initialize tracer
    const tracerObj = tracer.createTracer();
    tracer.traceGetter = traceContext.getTracer;
    tracer.restart(tracerObj);
    let expressEvent;
    const startTime = Date.now();
    try {
        expressEvent = expressRunner.createRunner(req, startTime);
        tracer.addRunner(expressEvent, undefined, tracerObj);
    } catch (err) {
        utils.debugLog(err);
    }

    // Inject trace functions
    req.epsagon = {
        label: tracer.label,
        setError: tracer.setError,
    };


    // Run the request, activate the context, and ignore request if no route found
    traceContext.RunInContext(tracerObj, next);
    if (!req.route) {
        return;
    }

    // Handle response
    res.on('finish', function handleResponse() {
        try {
            expressRunner.finishRunner(expressEvent, this, req, startTime);
        } catch (err) {
            tracer.addException(err, tracerObj);
        }
        tracer.sendTrace(() => {}, tracerObj);
    });
}


/**
 * Wraps the Express module request function with tracing
 * @param {Function} wrappedFunction Express init function
 * @return {Function} updated wrapped init
 */
function expressWrapper(wrappedFunction) {
    return function internalExpressWrapper() {
        const result = wrappedFunction.apply(this, arguments);
        this.use(expressMiddleware);
        return result;
    };
}


module.exports = {
    /**
     * Initializes the Express tracer
     */
    init() {
        if (express && express.application) {
            shimmer.wrap(express.application, 'init', expressWrapper);
        }
    },
};
