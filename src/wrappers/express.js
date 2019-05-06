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
 * Express requests middleware that runs in context
 * @param {Request} req The Express's request data
 * @param {Response} res The Express's response data
 * @param {Function} next express function
 */
function expressMiddleware(req, res, next) {
    tracer.restart();
    let expressEvent;
    const startTime = Date.now();
    try {
        expressEvent = expressRunner.createRunner(req, startTime);
        tracer.addRunner(expressEvent);
    } catch (err) {
        utils.debugLog(err);
        next();
        return;
    }

    // Inject trace functions
    const { label, setError } = tracer;
    req.epsagon = {
        label,
        setError,
    };

    next();
    if (!req.route) {
        return;
    }

    // Handle response
    res.on('finish', function handleResponse() {
        try {
            expressRunner.finishRunner(expressEvent, this, req, startTime);
        } catch (err) {
            tracer.addException(err);
        }
        tracer.sendTrace(() => {});
    });
}


/**
 * Wraps the Express module request function with tracing
 * @param {Function} wrappedFunction Express init function
 * @return {Function} updated wrapped init
 */
function expressWrapper(wrappedFunction) {
    traceContext.init();
    const tracerObj = tracer.createTracer();
    tracer.getTrace = traceContext.get;
    return function internalExpressWrapper() {
        const result = wrappedFunction.apply(this, arguments);
        this.use(
            (req, res, next) => traceContext.RunInContext(
                tracerObj,
                () => expressMiddleware(req, res, next)
            )
        );
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
