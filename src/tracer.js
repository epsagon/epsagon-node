/**
 * @fileoverview The tracer, managing all the trace collecting and sending
 */
const uuid4 = require('uuid4');
const axios = require('axios');
const util = require('util');
const trace = require('./proto/trace_pb.js');
const exception = require('./proto/exception_pb.js');
const utils = require('./utils.js');
const config = require('./config.js');
const eventInterface = require('./event.js');
const consts = require('./consts.js');

/**
 * The tracer singleton, used to manage the trace and send it at the end of the function invocation
 */
module.exports.tracer = new trace.Trace([
    '',
    '',
    [],
    [],
    consts.VERSION,
    `node ${process.versions.node}`,
]);

let currRunner = null;

/**
 * The requests promises pending to resolve. All must be resolved before sending the trace.
 * A Map containing (event, promise) pairs.
 */
const pendingEvents = new Map();

/**
 * The timeout to send for send operations (both sync and asyc)
 */
const sendTimeoutMiliseconds = 1000;


/**
 * Adds an event to the tracer
 * @param {proto.event_pb.Event} event The event to add
 * @param {Promise} [promise] A promise that resolves when the event handling is Done, if required.
 */
module.exports.addEvent = function addEvent(event, promise) {
    if (promise !== undefined) {
        pendingEvents.set(event, utils.reflectPromise(promise));
    }

    module.exports.tracer.addEvent(event);
};

/**
 * Adds an exception to the tracer
 * @param {Error} error The error object describing the exception
 * @param {Object} additionalData Additional data to send with the error. A map of <string: string>
 */
module.exports.addException = function addException(error, additionalData) {
    const raisedException = new exception.Exception([
        error.name,
        error.message,
        error.stack,
        utils.createTimestamp(),
    ]);

    if (typeof additionalData === 'object') {
        Object.keys(additionalData).forEach((key) => {
            if (additionalData[key] === undefined) {
                raisedException.getAdditionalDataMap().set(key, 'undefined');
            } else {
                raisedException.getAdditionalDataMap().set(key, additionalData[key]);
            }
        });
    }

    module.exports.tracer.addException(raisedException);
};

/**
 * Initializes the tracer
 * @param {object} configData user's configuration
 */
module.exports.initTrace = function initTrace(
    configData
) {
    config.setConfig(configData);
};


/**
 * Adds a runner to the current trace.
 * @param {object} runner The runner of the current trace
 * @param {Promise} runnerPromise A promise that resolves when the event handling is Done,
 *      if required.
 */
module.exports.addRunner = function addRunner(runner, runnerPromise) {
    const { tracer } = module.exports;
    tracer.addEvent(runner, runnerPromise);
    currRunner = runner;
};

/**
 * Restarts the tracer. Has to be called after a trace has been sent to reset the tracer
 * and start collecting a new trace
 * @param {object} runner The runner of the current trace
 * @param {Promise} runnerPromise A promise that resolves when the event handling is Done,
 *      if required.
 */
module.exports.restart = function restart() {
    const { tracer } = module.exports;
    tracer.clearExceptionList();
    tracer.clearEventList();
    tracer.setAppName(config.getConfig().appName);
    tracer.setToken(config.getConfig().token);
};

/**
 * Builds and sends current collected trace
 * Sends the trace to the epsagon infrastructure now, assuming all required event's promises was
 * handled
 * @param {function} traceSender: The function to use to send the trace. Gets the trace object
 *     as a parameter and sends a JSON version of it to epsagon's infrastructure
 * @return {*} traceSender's result
 */
function sendCurrentTrace(traceSender) {
    const { tracer } = module.exports;
    const traceJson = {
        app_name: tracer.getAppName(),
        token: tracer.getToken(),
        events: tracer.getEventList().map(entry => ({
            id: entry.getId(),
            start_time: entry.getStartTime(),
            resource: entry.hasResource() ? {
                name: entry.getResource().getName(),
                type: entry.getResource().getType(),
                operation: entry.getResource().getOperation(),
                metadata: entry.getResource().getMetadataMap().toArray().reduce((map, obj) => {
                    // not linting this line because this is a hack until protobuf
                    map[obj[0]] = obj[1]; // eslint-disable-line
                    return map;
                }, {}),
            } : {},
            origin: entry.getOrigin(),
            duration: entry.getDuration(),
            error_code: entry.getErrorCode(),
            exception: entry.hasException() ? {
                type: entry.getException().getType(),
                message: entry.getException().getMessage(),
                traceback: entry.getException().getTraceback(),
                time: entry.getException().getTime(),
            } : {},
        })),
        exceptions: tracer.getExceptionList().map(entry => ({
            type: entry.getType(),
            message: entry.getMessage(),
            traceback: entry.getTraceback(),
            time: entry.getTime(),
            additional_data: entry.getAdditionalDataMap().toArray().reduce((map, obj) => {
                // not linting this line because this is a hack until protobuf
                map[obj[0]] = obj[1]; // eslint-disable-line
                return map;
            }, {}),
        })),
        version: tracer.getVersion(),
        platform: tracer.getPlatform(),
    };

    const sendResult = traceSender(traceJson);
    pendingEvents.clear();
    return sendResult;
}

/**
 * Post given trace to epsagon's infrastructure.
 * @param {*} traceObject The trace data to send.
 * @returns {Promise} a promise that is resolved after the trace is posted.
 *  */
function postTrace(traceObject) {
    utils.debugLog(`Posting trace to ${config.getConfig().traceCollectorURL}`);
    utils.debugLog(`trace: ${util.inspect(traceObject)}`);
    return axios.post(
        config.getConfig().traceCollectorURL,
        traceObject,
        { timeout: sendTimeoutMiliseconds }
    ).then((res) => {
        utils.debugLog('Trace posted!');
        return res;
    }).catch((err) => {
        utils.debugLog(`Error sending trace. Trace size: ${err.config.data.length}`);
        utils.debugLog(err.stack);
        utils.debugLog(err.config.data);
        return err;
    }); // Always resolve.
}

/**
 * Sends the trace to epsagon's infrastructure when all pending events are finished.
 * @param {function} runnerUpdateFunc function that sets the duration of the runner.
 * @returns {Promise} a promise that is resolved when the trace transmission ends.
 */
module.exports.sendTrace = function sendTrace(runnerUpdateFunc) {
    utils.debugLog('Sending trace async');
    return Promise.all(pendingEvents.values()).then(() => {
        // Setting runner's duration.
        runnerUpdateFunc();
        return sendCurrentTrace(traceObject => postTrace(traceObject));
    });
};

/**
 * Sends the trace to epsagon's infrastructure, marking all the pending promises as
 * failures.
 * @returns {Promise} a promise that is resolved when the trace transmission ends.
 */
module.exports.sendTraceSync = function sendTraceSync() {
    utils.debugLog('Sending trace sync');

    pendingEvents.forEach((promise, event) => {
        if (event.getId() === '') {
            // Consider changing to report a different type of error. Maybe a new error code
            // describing an unknown operation state
            event.setId(uuid4());
            eventInterface.setException(
                event,
                Error('Operation not completed because of premature Lambda exit')
            );
        }
    });

    return sendCurrentTrace(traceObject => postTrace(traceObject));
};

/**
 * Add a custom label to the runner of the current trace.
 * @param {string} key key for the added label
 * @param {string} value value for the added label
 */
module.exports.label = function addLabel(key, value) {
    if (typeof key !== 'string' || typeof value !== 'string') {
        return;
    }

    eventInterface.addLabelToMetadata(currRunner, key, value);
};
