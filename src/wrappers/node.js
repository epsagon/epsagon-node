/**
 * @fileoverview Epsagon's node wrapper, for tracing node functions.
 */
const uuid4 = require('uuid4');
const tracer = require('../tracer.js');
const traceObject = require('../trace_object.js');
const utils = require('../utils.js');
const consts = require('../consts');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const { getConfig } = require('../config.js');

const FAILED_TO_SERIALIZE_MESSAGE = 'Unable to stringify response body as json';

/**
 * Creates an Event representing the running function (runner)
 * @param {object} functionToWrap The function that is wrapped
 * @param {Array} args The arguments passed to the function
 * @return {proto.event_pb.Event} The runner representing the lambda
 */
function createRunner(functionToWrap, args) {
    const runnerResource = new serverlessEvent.Resource([
        functionToWrap.name,
        'node_function',
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
        args_length: args.length,
    });

    consts.COLD_START = false;
    return runner;
}

/**
 * Epsagon's node function wrapper, wrap a lambda function with it to trace it
 * @param {function} functionToWrap The function to wrap and trace
 * @return {function} The original function, wrapped by our tracer
 */
module.exports.nodeWrapper = function nodeWrapper(functionToWrap) {
    tracer.getTrace = traceObject.get;
    return (...args) => { // eslint-disable-line consistent-return
        tracer.restart();
        let runner;

        try {
            runner = createRunner(functionToWrap, args);
        } catch (err) {
            // If we failed, call the user's function anyway
            return functionToWrap(...args);
        }

        tracer.addEvent(runner);

        const startTime = Date.now();
        const runnerSendUpdateHandler = (() => {
            runner.setDuration(utils.createDurationTimestamp(startTime));
        });

        try {
            runner.setStartTime(utils.createTimestampFromTime(startTime));
            const result = functionToWrap(...args);
            if (!getConfig().metadataOnly) {
                let jsonResult;
                try {
                    jsonResult = JSON.stringify(
                        typeof result === 'undefined' ? null : result
                    );
                } catch (err) {
                    jsonResult = `${FAILED_TO_SERIALIZE_MESSAGE}: ${err.message}`;
                }
                eventInterface.addToMetadata(
                    runner,
                    {
                        return_value: jsonResult.substring(0, consts.MAX_VALUE_CHARS),
                    }
                );
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
};
