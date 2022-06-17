/**
 * @fileoverview Epsagon's lambda wrapper, for tracing lambda invocations.
 */
/* eslint-disable no-underscore-dangle */
const uuid4 = require('uuid4');
const util = require('util');
const tracer = require('../tracer.js');
const traceObject = require('../trace_object.js');
const utils = require('../utils.js');
const { getConfig } = require('../config.js');
const awsLambdaTrigger = require('../triggers/aws_lambda.js');
const eventInterface = require('../event.js');
const lambdaRunner = require('../runners/aws_lambda.js');
const { STEP_ID_NAME, MAX_VALUE_CHARS, EPSAGON_EVENT_ID_KEY } = require('../consts.js');

const FAILED_TO_SERIALIZE_MESSAGE = 'Unable to stringify response body as json';
const TIMEOUT_WINDOW = parseInt(process.env.EPSAGON_LAMBDA_TIMEOUT_THRESHOLD_MS || 200, 10);
const epsagonWrapped = Symbol('epsagonWrapped');

module.exports.epsagonWrapped = epsagonWrapped;
module.exports.TIMEOUT_WINDOW = TIMEOUT_WINDOW;
module.exports.FAILED_TO_SERIALIZE_MESSAGE = FAILED_TO_SERIALIZE_MESSAGE;


/**
 * Appends the Epsagon ID (runner request ID) for distributed tracing connection
 * @param {Event} runner event
 * @param {object} returnValue Current function's return value
 * @returns {object} returnValue Updated return value
 */
function propagateEpsagonId(runner, returnValue) {
    if (
        process.env.EPSAGON_PROPAGATE_LAMBDA_ID &&
        returnValue &&
        !Array.isArray(returnValue) &&
        typeof returnValue === 'object'
    ) {
        // eslint-disable-next-line no-param-reassign
        returnValue[EPSAGON_EVENT_ID_KEY] = runner.getId();
        eventInterface.addToMetadata(runner, {
            propagation_enabled: true,
        });
    }
    return returnValue;
}


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
function baseLambdaWrapper(
    functionToWrap,
    runnerResourceType = 'lambda',
    shouldPassRunner = false,
    originalFunctionToWrap = null
) {
    // eslint-disable-next-line consistent-return
    return (originalEvent, originalContext, originalCallback) => {
        if (getConfig().ignoredPayloads || process.env.EPSAGON_PAYLOADS_TO_IGNORE) {
            const ignoredPayloads = (getConfig().ignoredPayloads) ?
                getConfig().ignoredPayloads :
                JSON.parse(process.env.EPSAGON_PAYLOADS_TO_IGNORE);

            const matches = ignoredPayloads.filter(
                payload => JSON.stringify(payload) ===
                    JSON.stringify(originalEvent)
            );
            if (matches.length > 0) {
                return functionToWrap(originalEvent, originalContext,
                    originalCallback);
            }
        }

        tracer.getTrace = traceObject.get;

        tracer.restart();
        let runner;
        let timeoutHandler;
        let tracesSent = false;
        let callbackCalled = false;

        try {
            runner = lambdaRunner.createRunner(originalContext, runnerResourceType);
            tracer.addRunner(runner);
        } catch (err) {
            const wrappedFunction =
        originalFunctionToWrap === null ?
            functionToWrap :
            originalFunctionToWrap;
            return wrappedFunction(originalEvent, originalContext, originalCallback);
        }

        try {
            const trigger = awsLambdaTrigger.createFromEvent(
                originalEvent,
                originalContext
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
            const config = getConfig();
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
                        name: 'LambdaExecutionError',
                        message: errorMessage,
                    };
                }
                // Override status code with Error message
                if (config.allowErrMessageStatus) {
                    const errStatusCode = utils.extractStatusCode(reportedError.message);
                    if (errStatusCode) {
                        eventInterface.addToMetadata(runner, {
                            status_code: errStatusCode,
                        });
                    }
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
            if (error === null && !config.metadataOnly && config.addReturnValue) {
                try {
                    // Taken from AWS Lambda runtime
                    const jsonResult = JSON.stringify(
                        typeof result === 'undefined' ? null : result
                    );
                    eventInterface.addToMetadata(
                        runner,
                        {
                            return_value: jsonResult.substring(0, MAX_VALUE_CHARS),
                        }
                    );
                } catch (err) {
                    eventInterface.addToMetadata(
                        runner,
                        {
                            return_value: `${FAILED_TO_SERIALIZE_MESSAGE}: ${err.message}`,
                        }
                    );
                }
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
            // eslint-disable-next-line no-param-reassign
            result = propagateEpsagonId(runner, result);
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

        let waitForContextResultHandlersPromise = Promise.resolve();
        const patchedContext = Object.assign({}, originalContext, {
            succeed: (res) => {
                utils.debugLog('wrapped succeed called');
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
                utils.debugLog('wrapped fail called');
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
                utils.debugLog('wrapped done called');
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
            set: (value) => {
                // eslint-disable-next-line no-param-reassign
                originalContext.callbackWaitsForEmptyEventLoop = value;
            },
            get: () => originalContext.callbackWaitsForEmptyEventLoop,
        });

        try {
            timeoutHandler = setTimeout(() => {
                utils.debugLog('In timeout handler');
                tracesSent = true;
                eventInterface.markAsTimeout(runner);
                runnerSendUpdateHandler();
                tracer.sendTraceSync();
            }, patchedContext.getRemainingTimeInMillis() - TIMEOUT_WINDOW);
            runner.setStartTime(utils.createTimestampFromTime(startTime));
            let result = shouldPassRunner ?
                functionToWrap(originalEvent, patchedContext, wrappedCallback, runner) :
                functionToWrap(originalEvent, patchedContext, wrappedCallback);

            // Check if result is an instance of Promise (some Webpack versions
            // don't support instanceof Promise)
            if (result && typeof result.then === 'function') {
                let raisedError;
                let returnValue;
                result = result
                    .then((res) => {
                        utils.debugLog('user promise resolved (in then)');
                        // eslint-disable-next-line no-param-reassign
                        res = propagateEpsagonId(runner, res);
                        returnValue = res;
                        return handleUserExecutionDone(null, res, true);
                    })
                    .catch((err) => {
                        utils.debugLog('user promise rejected (in catch)');
                        raisedError = err;
                        return handleUserExecutionDone(err, null, true);
                    })
                    .then(() => waitForOriginalCallbackPromise)
                    .then(() => waitForContextResultHandlersPromise)
                    .then(() => {
                        if (raisedError && config.allowErrMessageStatus) {
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
    if (functionToWrap[epsagonWrapped]) {
        return functionToWrap;
    }

    const wrapped = baseLambdaWrapper(functionToWrap);
    Object.defineProperty(wrapped, epsagonWrapped, {
        value: true,
        writable: false,
    });

    return wrapped;
};


/**
 * Extract the step data from the event, and updates the runner and the response.
 * @param {object} originalEvent Lambda function event data
 * @param {Event} runner event
 * @param {object} response Lambda function response data
 * @returns {object} response the update response with steps
 */
function extractAndAppendStepData(originalEvent, runner, response) {
    let step = null;
    if (typeof response === 'object') {
        if (!step) {
            if (originalEvent && originalEvent[STEP_ID_NAME]) {
                step = Object.assign({}, originalEvent[STEP_ID_NAME]);
                step.step_num += 1;
            } else {
                step = { id: uuid4(), step_num: 0 };
            }
        }
        response[STEP_ID_NAME] = step; // eslint-disable-line no-param-reassign
        eventInterface.addToMetadata(runner, {
            steps_dict: step,
        });
    }

    utils.debugLog('Step function response update attempt');
    utils.debugLog(`Updated response: ${util.inspect(response, { showHidden: false, depth: null })}`);
    return response;
}


/**
 * Creates a wrapper that adds a step id to the result of a step machine.
 * @param {function} functionToWrap The function to wrap
 * @returns {function} the wrapped function
 */
function createStepIdAddWrapper(functionToWrap) {
    return (originalEvent, originalContext, originalCallback, runner) => {
        const updateStepResult = response => extractAndAppendStepData(
            originalEvent,
            runner,
            response
        );

        const callbackWrapper = (error, result) => {
            if (!error) {
                updateStepResult(result, originalEvent, runner);
            }
            return originalCallback(error, result);
        };

        let result = functionToWrap(
            originalEvent,
            originalContext,
            callbackWrapper
        );

        if (result && typeof result.then === 'function') {
            utils.debugLog('Step function response is async');
            result = result.then(response => extractAndAppendStepData(
                originalEvent,
                runner,
                response
            ));
        }

        return result;
    };
}

/**
 * Epsagon's step lambda wrapper, wrap a lambda function with it to trace it
 * @param {function} functionToWrap The function to wrap and trace
 * @return {function} The original function, wrapped by our tracer
 */
module.exports.stepLambdaWrapper = function stepLambdaWrapper(functionToWrap) {
    if (functionToWrap[epsagonWrapped]) {
        return functionToWrap;
    }

    const stepIdAddWrapper = createStepIdAddWrapper(functionToWrap);
    const wrapped = baseLambdaWrapper(
        stepIdAddWrapper,
        'step_function_lambda',
        true,
        functionToWrap
    );

    Object.defineProperty(wrapped, epsagonWrapped, {
        value: true,
        writable: false,
    });

    return wrapped;
};
