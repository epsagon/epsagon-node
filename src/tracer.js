/**
 * @fileoverview The tracer, managing all the trace collecting and sending
 */
const uuid4 = require('uuid4');
const axios = require('axios');
const http = require('http');
const https = require('https');
const trace = require('./proto/trace_pb.js');
const exception = require('./proto/exception_pb.js');
const utils = require('./utils.js');
const config = require('./config.js');
const eventInterface = require('./event.js');
const consts = require('./consts.js');


/**
 * Returns a function to get the relevant tracer.
 */
module.exports.traceGetter = () => {};

/**
 * Returns the relevant tracer. If got one as a param, or from active context, or singleton.
 * @param {Object} tracer Optional tracer
 * @returns {Object} active tracer
 */
const getTracer = tracer => tracer || module.exports.traceGetter();

/**
 * Creates a new Trace object
 * @returns {Object} new Trace
 */
module.exports.createTracer = function createTracer() {
    const tracerObj = new trace.Trace([
        '',
        '',
        [],
        [],
        consts.VERSION,
        `node ${process.versions.node}`,
    ]);
    // The requests promises pending to resolve. All must be resolved before sending the trace.
    // A Map containing (event, promise) pairs.
    return {
        trace: tracerObj,
        currRunner: null,
        pendingEvents: new Map(),
    };
};

/**
 * The timeout to send for send operations (both sync and async)
 */
const sendTimeoutMilliseconds = 1000;

/**
 * Session for the post requests to the collector
 */
const session = axios.create({
    timeout: sendTimeoutMilliseconds,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
});

/**
 * Adds an event to the tracer
 * @param {proto.event_pb.Event} event The event to add
 * @param {Promise} [promise] A promise that resolves when the event handling is Done, if required.
 * @param {Object} tracer Optional tracer
 */
module.exports.addEvent = function addEvent(event, promise, tracer) {
    const tracerObj = getTracer(tracer);
    if (!tracerObj) return;
    if (promise !== undefined) {
        tracerObj.pendingEvents.set(event, utils.reflectPromise(promise));
    }

    tracerObj.trace.addEvent(event);
};

/**
 * Adds an exception to the tracer
 * @param {Error} error The error object describing the exception
 * @param {Object} additionalData Additional data to send with the error. A map of <string: string>
 * @param {Object} tracer Optional tracer
 */
module.exports.addException = function addException(error, additionalData, tracer) {
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

    const tracerObj = getTracer(tracer);
    if (!tracerObj) return;
    tracerObj.trace.addException(raisedException);
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
 * @param {Object} tracer Optional tracer
 */
module.exports.addRunner = function addRunner(runner, runnerPromise, tracer) {
    const tracerObj = getTracer(tracer);
    tracerObj.trace.addEvent(runner, runnerPromise);
    tracerObj.currRunner = runner;
};

/**
 * Restarts the tracer. Has to be called after a trace has been sent to reset the tracer
 * and start collecting a new trace
 * @param {Object} tracer Optional tracer
 */
module.exports.restart = function restart(tracer) {
    const tracerObj = getTracer(tracer);
    tracerObj.trace.clearExceptionList();
    tracerObj.trace.clearEventList();
    tracerObj.trace.setAppName(config.getConfig().appName);
    tracerObj.trace.setToken(config.getConfig().token);
};

/**
 * Builds and sends current collected trace
 * Sends the trace to the epsagon infrastructure now, assuming all required event's promises was
 * handled
 * @param {function} traceSender: The function to use to send the trace. Gets the trace object
 *     as a parameter and sends a JSON version of it to epsagon's infrastructure
 * @param {Object} tracer  Optional tracer
 * @return {*} traceSender's result
 */
function sendCurrentTrace(traceSender, tracer) {
    const tracerObj = getTracer(tracer);
    const traceJson = {
        app_name: tracerObj.trace.getAppName(),
        token: tracerObj.trace.getToken(),
        events: tracerObj.trace.getEventList().map(entry => ({
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
        exceptions: tracerObj.trace.getExceptionList().map(entry => ({
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
        version: tracerObj.trace.getVersion(),
        platform: tracerObj.trace.getPlatform(),
    };

    const sendResult = traceSender(traceJson);
    tracerObj.pendingEvents.clear();
    return sendResult;
}

/**
 * Post given trace to epsagon's infrastructure.
 * @param {*} traceObject The trace data to send.
 * @returns {Promise} a promise that is resolved after the trace is posted.
 *  */
module.exports.postTrace = function postTrace(traceObject) {
    utils.debugLog(`Posting trace to ${config.getConfig().traceCollectorURL}`);
    utils.debugLog(`trace: ${JSON.stringify(traceObject, null, 2)}`);
    return session.post(
        config.getConfig().traceCollectorURL,
        traceObject
    ).then((res) => {
        utils.debugLog('Trace posted!');
        return res;
    }).catch((err) => {
        utils.debugLog(`Error sending trace. Trace size: ${err.config.data.length}`);
        utils.debugLog(err.stack);
        return err;
    }); // Always resolve.
};

/**
 * Sends the trace to epsagon's infrastructure when all pending events are finished.
 * @param {function} runnerUpdateFunc function that sets the duration of the runner.
 * @param {Object} tracer Optional tracer
 * @returns {Promise} a promise that is resolved when the trace transmission ends.
 */
module.exports.sendTrace = function sendTrace(runnerUpdateFunc, tracer) {
    utils.debugLog('Sending trace async');
    const tracerObj = getTracer(tracer);
    return Promise.all(tracerObj.pendingEvents.values()).then(() => {
        // Setting runner's duration.
        runnerUpdateFunc();
        return sendCurrentTrace(traceObject => module.exports.postTrace(traceObject), tracer);
    });
};

/**
 * Sends the trace to epsagon's infrastructure, marking all the pending promises as
 * failures.
 * @param {Object} tracer  Optional tracer
 * @returns {Promise} a promise that is resolved when the trace transmission ends.
 */
module.exports.sendTraceSync = function sendTraceSync(tracer) {
    utils.debugLog('Sending trace sync');
    const tracerObj = getTracer(tracer);

    tracerObj.pendingEvents.forEach((promise, event) => {
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

    return sendCurrentTrace(traceObject => module.exports.postTrace(traceObject), tracer);
};

/**
 * Add a custom label to the runner of the current trace.
 * @param {string} key key for the added label
 * @param {string} value value for the added label
 * @param {Object} tracer Optional tracer
 */
module.exports.label = function addLabel(key, value, tracer) {
    // convert numbers to string
    const updatedValue = (typeof value === 'number') ? value.toString() : value;

    if (typeof key !== 'string' || typeof updatedValue !== 'string') {
        return;
    }

    const tracerObj = getTracer(tracer);
    eventInterface.addLabelToMetadata(tracerObj.currRunner, key, updatedValue);
};

/**
 * Set runner as an error.
 * @param {Error} err error data
 * @param {Object} tracer Optional tracer
 */
module.exports.setError = function setRunnerError(err, tracer) {
    const tracerObj = getTracer(tracer);
    eventInterface.setException(tracerObj.currRunner, err);
};
