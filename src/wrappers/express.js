/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Express instrumentation
 */

const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const expressRunner = require('../runners/express.js');

const express = tryRequire('express');


/**
 * Wraps the Express module request function with tracing
 * @param {Function} wrappedFunction The Express's request module
 * @returns {Function} The wrapped function
 */
function expressWrapper(wrappedFunction) {
    return function internalExpressWrapper() {
        const req = arguments[0];
        if (!req.next) {
            return wrappedFunction.apply(this, arguments);
        }
        tracer.restart();
        const res = arguments[1];
        let expressEvent;
        const startTime = Date.now();
        const result = wrappedFunction.apply(this, arguments);

        if (!req.route) {
            return result;
        }

        try {
            expressEvent = expressRunner.createRunner(req, startTime);
        } catch (err) {
            utils.debugLog(err);
        }

        res.on('finish', () => {
            try {
                expressRunner.finishRunner(expressEvent, this, startTime);
            } catch (err) {
                tracer.addException(err);
            }
            tracer.sendTrace(() => {});
        });

        return result;
    };
}

module.exports = {
    /**
     * Initializes the Express tracer
     */
    init() {
        if (express && express.Router) {
            shimmer.wrap(express.Router, 'handle', expressWrapper);
        }
    },
};
