/**
 * @fileoverview Epsagon's Openwhisk wrapper, for tracing actions invocations.
 */
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

/**
 * The tracer map contains the currently active tracers with the openwhisk activationId as key.
 * @type {Map<string, tracer>}
 */
const tracerMap = new Map();

/**
 * For openwhisk we need to create a tracer for each activationId, because the same action can
 * be invoked concurrently. Also, if the openWhiskWrapper() wasn't invoked, we don't want to
 * trace anything (or at least no record it).
 * @returns {tracer} The tracer or {@code null}.
 */
function getTracer() {
    const id = process.env['__OW_ACTIVATION_ID']; // eslint-disable-line dot-notation
    return id ? tracerMap.get(id) : null;
}

/**
 * Creates a new tracer and registers it in the map.
 */
function registerTracer() {
    const id = process.env['__OW_ACTIVATION_ID']; // eslint-disable-line dot-notation
    if (id) {
        tracerMap.set(id, tracer.createTracer());
    }
}

/**
 * Unregister the tracer from the map.
 */
function unregisterTracer() {
    const id = process.env['__OW_ACTIVATION_ID']; // eslint-disable-line dot-notation
    if (id) {
        tracerMap.delete(id);
    }
}

/**
 * Creates an Event representing the running function (runner)
 * @param {string} functionName The name of the wrapped function
 * @param {Array} originalParams The arguments passed to the function
 * @return {proto.event_pb.Event} The runner representing the function
 */
function createRunner(functionName, originalParams) {
    const runnerResource = new serverlessEvent.Resource([
        functionName,
        'openwhisk_action',
        'invoke',
        {},
    ]);

    const runner = new serverlessEvent.Event([
        process.env['__OW_ACTIVATION_ID'], // eslint-disable-line dot-notation
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
 * @param {object} options options used to initialize the Epsagon handler
 * @param {string} options.token_param name of the parameter passed to the OpenWhisk action
 * that will contain the Epsagon token. The value is only read when `options.token` is falsy
 * @return {function} The original function, wrapped by our tracer
 */
function openWhiskWrapper(functionToWrap, options) {
    // register the openwhisk specific getter as soon as the wrapper is instrumented.
    tracer.getTrace = getTracer;

    return (originalParams) => { // eslint-disable-line consistent-return
        if (options && typeof options === 'object') {
            if (options.token) {
                tracer.initTrace(options);
            } else if (options.token_param && originalParams) {
                tracer.initTrace(Object.assign({
                    token: originalParams[options.token_param],
                }, options));
            }
        }
        registerTracer();
        tracer.restart(); // actually not needed, because we should now have an empty tracer
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
                    tracer.sendTrace(runnerSendUpdateHandler).then(unregisterTracer);
                    return res;
                }).catch((err) => {
                    eventInterface.setException(runner, err);
                    runnerSendUpdateHandler();
                    return tracer.sendTraceSync().then(() => {
                        unregisterTracer();
                        throw err;
                    });
                });
            }
            tracer.sendTrace(runnerSendUpdateHandler).then(unregisterTracer);
            return result;
        } catch (err) {
            eventInterface.setException(runner, err);
            runnerSendUpdateHandler(); // Doing it here since the send is synchronous on error
            tracer.sendTraceSync().then(() => {
                unregisterTracer();
                throw err;
            });
        }
    };
}

module.exports.openWhiskWrapper = openWhiskWrapper;
