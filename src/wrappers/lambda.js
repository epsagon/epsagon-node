/**
 * @fileoverview Epsagon's lambda wrapper, for tracing lambda invocations.
 */
const uuid4 = require('uuid4');
const util = require('util');
const tracer = require('../tracer.js');
const utils = require('../utils.js');
const { getConfig } = require('../config.js');
const awsLambdaTrigger = require('../triggers/aws_lambda.js');
const eventInterface = require('../event.js');
const lambdaRunner = require('../runners/aws_lambda.js');
const { STEP_ID_NAME } = require('../consts.js');

const FAILED_TO_SERIALIZE_MESSAGE = 'Unable to stringify response body as json';
const TIMEOUT_WINDOW = 200;

module.exports.TIMEOUT_WINDOW = TIMEOUT_WINDOW;
module.exports.FAILED_TO_SERIALIZE_MESSAGE = FAILED_TO_SERIALIZE_MESSAGE;

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
function baseLambdaWrapper(
    functionToWrap,
    runnerResourceType = 'lambda',
    shouldPassRunner = false,
    originalFunctionToWrap = null
) {
    // eslint-disable-next-line consistent-return
    return (originalEvent, originalContext, originalCallback) => {
        tracer.restart();
        let runner;
        let timeoutHandler;
        let tracesSent = false;
        let callbackCalled = false;

        try {
            runner = lambdaRunner.createRunner(originalContext, runnerResourceType);
            tracer.addRunner(runner);
        } catch (err) {
            const wrappedFunction = (
                originalFunctionToWrap === null ?
                    functionToWrap : originalFunctionToWrap
            );
            return wrappedFunction(originalEvent, originalContext, originalCallback);
        }

        try {
            const trigger = awsLambdaTrigger.createFromEvent(
                originalEvent,
                originalContext
            );

            tracer.addEvent(trigger);
        } catch (err) {
            tracer.addException(
                err,
                { event: JSON.stringify(originalEvent) }
            );
        }

        const startTime = Date.now();
        const runnerSendUpdateHandler = (() => {
            runner.setDuration(utils.createDurationTimestamp(startTime));
        });

        // Hook when the event loop is empty, in case callback is not called.
        // Based on the way AWS Lambda implements it
        // This is done so we will send a trace even if callback is not called
        // This is relevant only for sync functions (async functions node > 8 will never use this)
        // eslint-disable-next-line no-underscore-dangle
        const originalBeforeExit = process._events.beforeExit;
        // eslint-disable-next-line no-underscore-dangle
        process._events.beforeExit = () => {
            tracer.sendTrace(runnerSendUpdateHandler).then(() => {
                // Restore to original and exit, the event loop will take care of the rest
                // eslint-disable-next-line no-underscore-dangle
                process._events.beforeExit = originalBeforeExit;
            });
        };

        const handleUserExecutionDone = (error, result, sendSync) => {
            clearTimeout(timeoutHandler);

            if (tracesSent || callbackCalled) {
                return Promise.resolve();
            }
            callbackCalled = true;
            if (error) { // not catching false here, but that seems OK
                eventInterface.setException(runner, error);
            }

            if (error === null && !getConfig().metadataOnly) {
                let jsonResult;
                try {
                    // Taken from AWS Lambda runtime
                    jsonResult = JSON.stringify(typeof result === 'undefined' ? null : result);
                } catch (err) {
                    jsonResult = `${FAILED_TO_SERIALIZE_MESSAGE}: ${err.message}`;
                }
                eventInterface.addToMetadata(runner, { return_value: jsonResult });
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

        let waitForOriginalCallbackPromise = Promise.resolve();
        const wrappedCallback = (error, result) => {
            if (callbackCalled) {
                utils.debugLog('not calling callback since it was already called');
                return;
            }
            waitForOriginalCallbackPromise = new Promise((resolve) => {
                handleUserExecutionDone(error, result).then(() => {
                    utils.debugLog('calling User\'s callback');
                    originalCallback(error, result);
                    resolve();
                });
            });
        };

        let waitForContextResultHandlersPromise = Promise.resolve();
        const patchedContext = Object.assign({}, originalContext, {
            succeed: (res) => {
                if (callbackCalled) {
                    utils.debugLog('not calling succeed, callback was already called');
                    return;
                }
                waitForContextResultHandlersPromise = new Promise((resolve) => {
                    handleUserExecutionDone(null, res, true)
                        .then(() => waitForOriginalCallbackPromise)
                        .then(() => originalContext.succeed(res))
                        .then(() => resolve());
                });
            },
            fail: (err) => {
                if (callbackCalled) {
                    utils.debugLog('not calling fail, callback was already called');
                    return;
                }
                waitForContextResultHandlersPromise = new Promise((resolve) => {
                    handleUserExecutionDone(err, null, true)
                        .then(() => waitForOriginalCallbackPromise)
                        .then(() => originalContext.fail(err))
                        .then(() => resolve());
                });
            },
            done: (res, err) => {
                if (callbackCalled) {
                    utils.debugLog('not calling done, callback was already called');
                    return;
                }
                waitForContextResultHandlersPromise = new Promise((resolve) => {
                    handleUserExecutionDone(res, err, true)
                        .then(() => waitForOriginalCallbackPromise)
                        .then(() => originalContext.done(res, err))
                        .then(() => resolve());
                });
            },
        });

        // Adding wrappers to original setter and getter
        Object.defineProperty(patchedContext, 'callbackWaitsForEmptyEventLoop', {
            // eslint-disable-next-line no-param-reassign
            set: (value) => { originalContext.callbackWaitsForEmptyEventLoop = value; },
            get: () => originalContext.callbackWaitsForEmptyEventLoop,
        });

        try {
            timeoutHandler = setTimeout(() => {
                tracesSent = true;
                eventInterface.markAsTimeout(runner);
                tracer.sendTraceSync();
            }, patchedContext.getRemainingTimeInMillis() - TIMEOUT_WINDOW);
            runner.setStartTime(utils.createTimestampFromTime(startTime));
            let result = (
                shouldPassRunner ?
                    functionToWrap(originalEvent, patchedContext, wrappedCallback, runner) :
                    functionToWrap(originalEvent, patchedContext, wrappedCallback)
            );

            // Check if result is an instance of Promise (some Webpack versions
            // don't support instanceof Promise)
            if (result && typeof result.then === 'function') {
                let raisedError;
                let returnValue;
                result = result
                    .then((res) => {
                        returnValue = res;
                        return handleUserExecutionDone(null, res, true);
                    })
                    .catch((err) => {
                        raisedError = err;
                        return handleUserExecutionDone(err, null, true);
                    })
                    .then(() => waitForOriginalCallbackPromise)
                    .then(() => waitForContextResultHandlersPromise)
                    .then(() => {
                        if (raisedError) {
                            throw raisedError;
                        }
                        return returnValue;
                    });
            }
            return result;
        } catch (err) {
            patchedContext.fail(err);
        }
    };
}

/**
 * Epsagon's lambda wrapper, wrap a lambda function with it to trace it
 * @param {function} functionToWrap The function to wrap and trace
 * @return {function} The original function, wrapped by our tracer
 */
module.exports.lambdaWrapper = function lambdaWrapper(functionToWrap) {
    return baseLambdaWrapper(functionToWrap);
};

/**
 * Creates a wrapper that adds a step id to the result of a step machine.
 * @param {function} functionToWrap The function to wrap
 * @returns {function} the wrapped function
 */
function createStepIdAddWrapper(functionToWrap) {
    return (originalEvent, originalContext, originalCallback, runner) => {
        let step = null;

        const updateStepResult = (result) => {
            if (typeof result === 'object') {
                if (!step) {
                    if (originalEvent && STEP_ID_NAME in originalEvent) {
                        step = Object.assign({}, originalEvent[STEP_ID_NAME]);
                        step.step_num += 1;
                    } else {
                        step = { id: uuid4(), step_num: 0 };
                    }
                }
                result[STEP_ID_NAME] = step; // eslint-disable-line no-param-reassign
                eventInterface.addToMetadata(runner, {
                    steps_dict: step,
                });
            }

            if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
                // eslint-disable-next-line no-console
                console.log('Step function result update attempt');
                // eslint-disable-next-line no-console
                console.log(
                    'Updated result: ',
                    util.inspect(result, { showHidden: false, depth: null })
                );
            }
        };

        const callbackWrapper = (error, result) => {
            if (!error) {
                updateStepResult(result, originalEvent, runner);
            }
            return originalCallback(error, result);
        };

        const result = functionToWrap(
            originalEvent,
            originalContext,
            callbackWrapper
        );

        return result;
    };
}

/**
 * Epsagon's step lambda wrapper, wrap a lambda function with it to trace it
 * @param {function} functionToWrap The function to wrap and trace
 * @return {function} The original function, wrapped by our tracer
 */
module.exports.stepLambdaWrapper = function stepLambdaWrapper(functionToWrap) {
    const stepIdAddWrapper = createStepIdAddWrapper(functionToWrap);
    return baseLambdaWrapper(stepIdAddWrapper, 'step_function_lambda', true, functionToWrap);
};
