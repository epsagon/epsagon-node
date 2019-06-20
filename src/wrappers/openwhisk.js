/**
 * @fileoverview Epsagon's Openwhisk wrapper, for tracing actions invocations.
 */
const uuid4 = require('uuid4');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const traceObject = require('../trace_object.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

/**
 * Creates an Event representing the running function (runner)
 * @param {string} functionName The name of the wrapped function
 * @param {Array} originalParams The arguments passed to the function
 * @return {proto.event_pb.Event} The runner representing the function
 */
function createRunner(functionName, originalParams) {
    const runnerResource = new serverlessEvent.Resource([
        functionName,
        'openwhisk',
        'invoke',
        {},
    ]);

    const runner = new serverlessEvent.Event([
        uuid4(),
        0,
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    runner.setResource(runnerResource);
    eventInterface.addToMetadata(runner, {
        activation_id: process.env['__OW_ACTIVATION_ID'], // eslint-disable-line dot-notation
        api_host: process.env['__OW_API_HOST'], // eslint-disable-line dot-notation
        namespace: process.env['__OW_NAMESPACE'], // eslint-disable-line dot-notation
        params: originalParams,
    });
    return runner;
}

/**
 * Epsagon's OpenWhisk wrapper, wrap an action with it to trace it.
 * @param {function} functionToWrap The function to wrap and trace
 * @return {function} The original function, wrapped by our tracer
 */
function openWhiskWrapper(functionToWrap) {
    return (originalParams) => { // eslint-disable-line consistent-return
        tracer.getTrace = traceObject.get;
        tracer.restart();
        let runner;

        try {
            // eslint-disable-next-line dot-notation
            runner = createRunner(process.env['__OW_ACTION_NAME'], originalParams);
        } catch (err) {
            // If we failed, call the user's function anyway
            return functionToWrap(originalParams);
        }

        tracer.addEvent(runner);

        const startTime = Date.now();
        const runnerSendUpdateHandler = (() => {
            runner.setDuration(utils.createDurationTimestamp(startTime));
        });

        try {
            runner.setStartTime(utils.createTimestampFromTime(startTime));
            const result = functionToWrap(originalParams);
            if (result && typeof result.then === 'function') {
                return result.then((res) => {
                    tracer.sendTrace(runnerSendUpdateHandler);
                    return res;
                }).catch((err) => {
                    eventInterface.setException(runner, err);
                    runnerSendUpdateHandler();
                    return tracer.sendTraceSync().then(() => {
                        throw err;
                    });
                });
            }
            tracer.sendTrace(runnerSendUpdateHandler);
            return result;
        } catch (err) {
            eventInterface.setException(runner, err);
            runnerSendUpdateHandler(); // Doing it here since the send is synchronous on error
            tracer.sendTraceSync().then(() => {
                throw err;
            });
        }
    };
}

module.exports.openWhiskWrapper = openWhiskWrapper;
