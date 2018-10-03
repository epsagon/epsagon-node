/**
 * @fileoverview Epsagon's lambda wrapper, for tracing lambda invocations.
 */
const uuid4 = require('uuid4');
const util = require('util');
const tracer = require('../tracer.js');
const utils = require('../utils.js');
const awsLambdaTrigger = require('../triggers/aws_lambda.js');
const eventInterface = require('../event.js');
const lambdaRunner = require('../runners/aws_lambda.js');
const { STEP_ID_NAME } = require('../consts.js');

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
    return (originalEvent, originalContext, originalCallback) => {
        tracer.restart();
        let runner;
        let callbackCalled = false;

        try {
            runner = lambdaRunner.createRunner(originalContext, runnerResourceType);
        } catch (err) {
            const wrappedFunction = (
                originalFunctionToWrap === null ?
                    functionToWrap : originalFunctionToWrap
            );
            return wrappedFunction(originalEvent, originalContext, originalCallback);
        }

        tracer.addEvent(runner);

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

        const handleUserExecutionDone = (error) => {
            if (error) { // not catching false here, but that seems OK
                eventInterface.setException(runner, error);
            }

            // Restoring empty event loop handling.
            // eslint-disable-next-line no-underscore-dangle
            process._events.beforeExit = originalBeforeExit;

            // If the user is waiting for the rest of the events, we can send async. Otherwise
            // don't wait ourselves and send sync.
            if (originalContext.callbackWaitsForEmptyEventLoop) {
                tracer.sendTrace(runnerSendUpdateHandler);
            } else {
                runnerSendUpdateHandler();
                tracer.sendTraceSync();
            }
        };

        const wrappedCallback = (error, result) => {
            handleUserExecutionDone(error);
            utils.debugLog('calling User\'s callback');
            callbackCalled = true;
            return originalCallback(error, result);
        };


        try {
            runner.setStartTime(utils.createTimestampFromTime(startTime));
            const result = (
                shouldPassRunner ?
                    functionToWrap(originalEvent, originalContext, wrappedCallback, runner) :
                    functionToWrap(originalEvent, originalContext, wrappedCallback)
            );
            if (!callbackCalled) {
                if (result instanceof Promise) {
                    result
                        .then(() => { handleUserExecutionDone(null); })
                        .catch((err) => { handleUserExecutionDone(err); });
                }
            }
            return result;
        } catch (err) {
            eventInterface.setException(runner, err);
            runnerSendUpdateHandler(); // Doing it here since the send is synchronous on error
            // Restoring empty event loop handling.
            // eslint-disable-next-line no-underscore-dangle
            process._events.beforeExit = originalBeforeExit;
            tracer.sendTraceSync();
            throw err;
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
                    if (STEP_ID_NAME in originalEvent) {
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

            if (process.env.EPSAGON_DEBUG === 'TRUE') {
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
