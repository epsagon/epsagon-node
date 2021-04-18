/**
 * @fileoverview Epsagon's lambda wrapper, for tracing lambda invocations.
 */
/* eslint-disable no-underscore-dangle */
const tracer = require('../tracer.js');
const traceObject = require('../trace_object.js');
const utils = require('../utils.js');
const { getConfig } = require('../config.js');
const tencentFunctionTrigger = require('../triggers/tencent_function.js');
const eventInterface = require('../event.js');
const tencentFunctionRunner = require('../runners/tencent_function.js');
const { MAX_VALUE_CHARS } = require('../consts.js');

const FAILED_TO_SERIALIZE_MESSAGE = 'Unable to stringify response body as json';
const TIMEOUT_WINDOW = 500;
const epsagonWrapped = Symbol('epsagonWrapped');

module.exports.epsagonWrapped = epsagonWrapped;
module.exports.TIMEOUT_WINDOW = TIMEOUT_WINDOW;
module.exports.FAILED_TO_SERIALIZE_MESSAGE = FAILED_TO_SERIALIZE_MESSAGE;


/**
 * Patch node's UncaughtException and UnhandledRejection handlers
 * @param {function} handleUserExecutionDone handler for user execution done
 * @param {object} runner the runner object
 */
function patchErrorHandlers(handleUserExecutionDone, runner) {
    const originalUncaughtException = process._events.uncaughtException;
    process._events.uncaughtException = (err, original) => {
        process._events.uncaughtException = originalUncaughtException;
        eventInterface.setException(runner, err, false);
        handleUserExecutionDone(err, null, true).then(() => {
            if (originalUncaughtException && typeof originalUncaughtException === 'function') {
                originalUncaughtException(err, original);
            }
        });
    };
    const originalUnhandledRejection = process._events.unhandledRejection;
    process._events.unhandledRejection = (reason, promise) => {
        process._events.unhandledRejection = originalUnhandledRejection;
        const err = Error(reason);
        eventInterface.setException(runner, err, false);
        handleUserExecutionDone(err, null, true).then(() => {
            if (originalUnhandledRejection && typeof originalUnhandledRejection === 'function') {
                originalUnhandledRejection(reason, promise);
            }
        });
    };
}

/**
 * The epsagon's base lambda wrapper, wrap a lambda function with it to trace it
 * @param {function} functionToWrap The function to wrap and trace
 * @param {string} [runnerResourceType='lambda'] The resource type to set for the runner
 * @param {boolean} [shouldPassRunner=false] True if the runner should be passed to the wrapped
 *     function false otherwise. used when additional action in required on the runner on complex
 *     wrappers
 * @param {function} [originalFunctionToWrap=null] The original Function to wrap. Used when the
 *     function to wrap is already wrapped with another proxy, and a critical error occurs.
 * @return {function} The original function, wrapped by our tracer
 */
function baseTencentFunctionWrapper(functionToWrap) {
    tracer.getTrace = traceObject.get;
    // eslint-disable-next-line consistent-return
    return (originalEvent, originalContext, originalCallback) => {
        tracer.restart();
        let runner;
        let timeoutHandler;
        let tracesSent = false;
        let callbackCalled = false;

        try {
            runner = tencentFunctionRunner.createRunner(originalContext);
            tracer.addRunner(runner);
        } catch (err) {
            return functionToWrap(originalEvent, originalContext, originalCallback);
        }

        try {
            const trigger = tencentFunctionTrigger.createFromEvent(
                originalEvent,
                originalContext,
                runner
            );
            tracer.addEvent(trigger);
        } catch (err) {
            utils.debugLog(`Error parsing trigger: ${err.stack}, Event: ${JSON.stringify(originalEvent)}`);
        }

        const startTime = Date.now();
        const runnerSendUpdateHandler = () => {
            runner.setDuration(utils.createDurationTimestamp(startTime));
        };

        // Hook when the event loop is empty, in case callback is not called.
        // Based on the way AWS Lambda implements it
        // This is done so we will send a trace even if callback is not called
        // This is relevant only for sync functions (async functions node > 8 will never use this)
        const originalBeforeExit = process._events.beforeExit;
        process._events.beforeExit = () => {
            tracer.sendTrace(runnerSendUpdateHandler).then(() => {
                // Restore to original and exit, the event loop will take care of the rest
                process._events.beforeExit = originalBeforeExit;
            });
        };

        const handleUserExecutionDone = (error, result, sendSync) => {
            clearTimeout(timeoutHandler);

            if (tracesSent || callbackCalled) {
                return Promise.resolve();
            }
            callbackCalled = true;
            if (error) {
                // not catching false here, but that seems OK
                let reportedError = error;
                if (!error.name) {
                    let errorMessage;
                    try {
                        errorMessage = typeof error === 'string' ? error : JSON.stringify(error);
                    } catch (stringifyErr) {
                        errorMessage = '';
                    }

                    reportedError = {
                        name: 'SCFExecutionError',
                        message: errorMessage,
                    };
                }

                // Setting this error only if there is no existing error already
                if (!runner.getException()) {
                    utils.debugLog('Setting exception from handleUserExecutionDone');
                    eventInterface.setException(runner, reportedError, false);
                }
            }

            const { statusCode } = result || {};
            if (statusCode) {
                eventInterface.addToMetadata(runner, { status_code: statusCode });
            }

            if (error === null && !getConfig().metadataOnly) {
                let jsonResult;
                try {
                    // Taken from AWS Lambda runtime
                    jsonResult = JSON.stringify(
                        typeof result === 'undefined' ? null : result
                    );
                } catch (err) {
                    jsonResult = `${FAILED_TO_SERIALIZE_MESSAGE}: ${err.message}`;
                }
                eventInterface.addToMetadata(
                    runner,
                    {
                        'tencent.scf.return_data': jsonResult.substring(0, MAX_VALUE_CHARS),
                    }
                );
            }

            // Restoring empty event loop handling.
            // eslint-disable-next-line no-underscore-dangle
            process._events.beforeExit = originalBeforeExit;

            // Mark trace as sent.
            tracesSent = true;

            // If the user is waiting for the rest of the events, we can send async. Otherwise
            // don't wait ourselves and send sync.
            if (!sendSync && originalContext.callbackWaitsForEmptyEventLoop) {
                return tracer.sendTrace(runnerSendUpdateHandler);
            }

            // The callback does not wait, don't wait for events.
            runnerSendUpdateHandler();
            return tracer.sendTraceSync();
        };
        patchErrorHandlers(handleUserExecutionDone, runner);

        let waitForOriginalCallbackPromise = Promise.resolve();
        const wrappedCallback = (error, result) => {
            utils.debugLog('wrapped callback called', error, result);
            if (callbackCalled) {
                utils.debugLog('not calling callback since it was already called');
                return;
            }
            waitForOriginalCallbackPromise = new Promise((resolve) => {
                utils.debugLog('handling execution done before calling callback');
                handleUserExecutionDone(error, result).then(() => {
                    utils.debugLog("calling User's callback");
                    originalCallback(error, result);
                    resolve();
                });
            });
        };

        try {
            timeoutHandler = setTimeout(() => {
                utils.debugLog('In timeout handler');
                tracesSent = true;
                eventInterface.markAsTimeout(runner);
                runnerSendUpdateHandler();
                tracer.sendTraceSync();
            }, originalContext.getRemainingTimeInMillis() - TIMEOUT_WINDOW);
            runner.setStartTime(utils.createTimestampFromTime(startTime));
            let result = functionToWrap(originalEvent, originalContext, wrappedCallback);

            // Check if result is an instance of Promise (some Webpack versions
            // don't support instanceof Promise)
            if (result && typeof result.then === 'function') {
                let raisedError;
                let returnValue;
                result = result
                    .then((res) => {
                        utils.debugLog('user promise resolved (in then)');
                        returnValue = res;
                        return handleUserExecutionDone(null, res, true);
                    })
                    .catch((err) => {
                        utils.debugLog('user promise rejected (in catch)');
                        raisedError = err;
                        return handleUserExecutionDone(err, null, true);
                    })
                    .then(() => waitForOriginalCallbackPromise)
                    .then(() => {
                        if (raisedError) {
                            throw raisedError;
                        }
                        return returnValue;
                    });
            }
            return result;
        } catch (err) {
            throw err;
        }
    };
}

/**
 * Epsagon's lambda wrapper, wrap a lambda function with it to trace it
 * @param {function} functionToWrap The function to wrap and trace
 * @return {function} The original function, wrapped by our tracer
 */
module.exports.tencentFunctionWrapper = function tencentFunctionWrapper(functionToWrap) {
    if (functionToWrap[epsagonWrapped]) {
        return functionToWrap;
    }

    const wrapped = baseTencentFunctionWrapper(functionToWrap);
    Object.defineProperty(wrapped, epsagonWrapped, {
        value: true,
        writable: false,
    });

    return wrapped;
};
