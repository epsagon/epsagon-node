/**
 * @fileoverview The tracer, managing all the trace collecting and sending
 */
const uuid4 = require('uuid4');
const axios = require('axios');
const http = require('http');
const https = require('https');
const trace = require('./proto/trace_pb.js');
const exception = require('./proto/exception_pb.js');
const errorCode = require('./proto/error_code_pb.js');
const utils = require('./utils.js');
const config = require('./config.js');
const eventInterface = require('./event.js');
const consts = require('./consts.js');
const ecs = require('./containers/ecs.js');
const k8s = require('./containers/k8s.js');

const MAX_STEPS = 3;

/**
 * Returns a function to get the relevant tracer.
 */
module.exports.getTrace = () => {};

/**
 * Creates a new Trace object
 * @returns {Object} new Trace
 */
module.exports.createTracer = function createTracer() {
    if (config.getConfig().sampleRate <= Math.random()) {
        // sampling decision. Not initializing tracer for this to be backwards compatible
        // and for efficiency (initializing a tracer is currently not that cheap, and we
        // may initialize one for each request.
        return null;
    }

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
 * Session for the post requests to the collector
 */
const session = axios.create({
    timeout: config.getConfig().sendTimeout,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
});

/**
 * Adds an event to the tracer
 * @param {proto.event_pb.Event} event The event to add
 * @param {Promise} [promise] A promise that resolves when the event handling is Done, if required.
 */
module.exports.addEvent = function addEvent(event, promise) {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj) {
        return;
    }
    if (utils.isPromise(promise)) {
        tracerObj.pendingEvents.set(
            event,
            utils.makeQueryablePromise(promise.catch((err) => {
                module.exports.addException(err);
            }))
        );
    }

    tracerObj.trace.addEvent(event);
};

/**
 * Adds an exception to the tracer
 * @param {Error} userError The error object describing the exception
 * @param {Object} additionalData Additional data to send with the error. A map of <string: string>
 */
module.exports.addException = function addException(userError, additionalData) {
    const error = userError || new Error();
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

    const tracerObj = module.exports.getTrace();
    if (!tracerObj) {
        return;
    }
    tracerObj.trace.addException(raisedException);
};

/**
 * Initializes the tracer
 * @param {object} configData user's configuration
 */
module.exports.initTrace = function initTrace(
    configData
) {
    try {
        const ecsMetaUri = ecs.hasECSMetadata();
        if (ecsMetaUri) {
            ecs.loadECSMetadata(ecsMetaUri).catch(err => utils.debugLog(err));
        }
        if (k8s.hasK8sMetadata()) {
            k8s.loadK8sMetadata();
        }
    } catch (err) {
        utils.debugLog('Could not extract container env data');
    }

    config.setConfig(configData);
};


/**
 * Adds a runner to the current trace.
 * @param {object} runner The runner of the current trace
 * @param {Promise} runnerPromise A promise that resolves when the event handling is Done,
 *      if required.
 */
module.exports.addRunner = function addRunner(runner, runnerPromise) {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj) {
        return;
    }
    tracerObj.trace.addEvent(runner, runnerPromise);
    tracerObj.currRunner = runner;
    ecs.addECSMetadata(tracerObj.currRunner);
    k8s.addK8sMetadata(tracerObj.currRunner);
};

/**
 * Restarts the tracer. Has to be called after a trace has been sent to reset the tracer
 * and start collecting a new trace
 */
module.exports.restart = function restart() {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj) {
        return;
    }
    tracerObj.disabled = false;
    tracerObj.trace.clearExceptionList();
    tracerObj.trace.clearEventList();
    tracerObj.trace.setAppName(config.getConfig().appName);
    tracerObj.trace.setToken(config.getConfig().token);
};

const stripfuncs = [
    (entry) => {
        // drop the response_body for HTTP requests
        if (entry && entry.resource && entry.resource.type === 'http') {
            delete entry.resource.metadata.response_body; // eslint-disable-line no-param-reassign
        }
        return entry;
    },
    (entry) => {
        // drop the request_body for HTTP requests
        if (entry && entry.resource && entry.resource.type === 'http') {
            delete entry.resource.metadata.request_body; // eslint-disable-line no-param-reassign
        }
        return entry;
    },
    (entry) => {
        // drop the exception for HTTP requests
        if (entry && entry.resource && entry.resource.type === 'http' && entry.exception) {
            delete entry.exception.traceback; // eslint-disable-line no-param-reassign
        }
        return entry;
    },
    () => {
        // last resort: drop the entire entry
        utils.debugLog('Too big operation filtered out');
    },
];

/**
 * Deleting request_body from api_gateway event.
 * @param {Json} entry Tracer event.
 * @returns {Json} event without request_body.
 */
const stripApiGateway = (entry) => {
    // drop the metadata for API Gateway requests
    if (entry && entry.resource && entry.resource.metadata) {
        delete entry.resource.metadata.request_body; // eslint-disable-line no-param-reassign
    }
    return entry;
};

/**
 * Removes all operations from a given trace. Only runner and trigger are kept.
 * @param {Json} traceJson: Trace JSON to remove operations from.
 * @param {int} attempt: the filtering iteration number, filters get progressively more aggressive
 * @return {*} List of filtered operations
 */
function stripOperations(traceJson, attempt) {
    const filteredEvents = [];
    traceJson.events.forEach((entry) => {
        if (entry.resource.type === 'api_gateway') {
            const filteredEntry = stripApiGateway(entry);
            if (filteredEntry) {
                filteredEvents.push(filteredEntry);
            }
        } else if ((entry.origin === 'runner' || entry.origin === 'trigger')) {
            filteredEvents.push(entry);
        } else {
            const filteredEntry = stripfuncs[attempt](entry);
            if (filteredEntry) {
                filteredEvents.push(filteredEntry);
            }
        }
    });

    return filteredEvents;
}

/**
 * Builds and sends current collected trace
 * Sends the trace to the epsagon infrastructure now, assuming all required event's promises was
 * handled
 * @param {function} traceSender: The function to use to send the trace. Gets the trace object
 *     as a parameter and sends a JSON version of it to epsagon's infrastructure
 * @return {*} traceSender's result
 */
function sendCurrentTrace(traceSender) {
    const tracerObj = module.exports.getTrace();
    const { sendOnlyErrors } = config.getConfig();
    if (!tracerObj) {
        return Promise.resolve();
    }

    // Check if got error events
    if (sendOnlyErrors) {
        const errorEvents = tracerObj.trace.getEventList().filter(event => event.getErrorCode());
        if (errorEvents.length === 0) {
            utils.debugLog('Skip send traces. No error events found.');
            tracerObj.pendingEvents.clear();
            return Promise.resolve();
        }
    }
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
                additional_data: entry.getException().getAdditionalDataMap()
                    .toArray().reduce((map, obj) => {
                        // not linting this line because this is a hack until protobuf
                        map[obj[0]] = obj[1]; // eslint-disable-line
                        return map;
                    }, {}),
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


    if (JSON.stringify(traceJson).length >= consts.MAX_TRACE_SIZE_BYTES) {
        for (let attempt = 0; attempt <= MAX_STEPS; attempt += 1) {
            traceJson.events = stripOperations(traceJson, attempt);
            if (JSON.stringify(traceJson).length < consts.MAX_TRACE_SIZE_BYTES) {
                break;
            }
        }
    }


    const sendResult = traceSender(traceJson);
    tracerObj.pendingEvents.clear();
    return sendResult;
}

/**
 * Filter a trace to exclude all unwanted keys
 * @param {Object} traceObject  the trace to filter
 * @param {Array<String>} ignoredKeys   keys to ignore
 * @returns {Object}  filtered trace
 */
module.exports.filterTrace = function filterTrace(traceObject, ignoredKeys) {
    /**
     * Check if a given param is an object
     * @param {*} x   param to check
     * @returns {boolean}   if `x` is an object
     */
    function isObject(x) {
        return (typeof x === 'object') && x !== null;
    }

    const isString = x => typeof x === 'string';

    /**
     * Tests if a key is to be ignored or not.
     * @param {string} key a key in an object or hash map
     * @returns {boolean} true for non-ignored keys
     */
    function isNotIgnored(key) {
        for (let i = 0; i < ignoredKeys.length; i += 1) {
            const predicate = ignoredKeys[i];
            if (typeof predicate === 'string' &&
            config.processIgnoredKey(predicate) === config.processIgnoredKey(key)) {
                return false;
            }
            if (predicate instanceof RegExp && predicate.test(key)) {
                return false;
            }
            if (typeof predicate === 'function' && predicate(key)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Recursivly filter object properties
     * @param {Object} obj  object to filter
     * @returns {Object} filtered object
     */
    function filterObject(obj) {
        if (!isObject(obj)) {
            return obj;
        }

        const keys = Object
            .keys(obj)
            .filter(isNotIgnored);

        const primitive = keys.filter(k => !isObject(obj[k]) && !isString(obj[k]));
        const objects = keys
            .filter(k => isObject(obj[k]))
            .map(k => ({ [k]: filterObject(obj[k]) }));

        // trying to JSON load strings to filter sensitive data
        keys.filter(k => isString(obj[k])).forEach((k) => {
            try {
                const subObj = JSON.parse(obj[k]);
                if (subObj && isObject(subObj)) {
                    objects.push({ [k]: filterObject(subObj) });
                } else {
                    primitive.push(k);
                }
            } catch (e) {
                primitive.push(k);
            }
        });

        return Object.assign({},
            primitive.reduce((sum, key) => Object.assign({}, sum, { [key]: obj[key] }), {}),
            objects.reduce((sum, value) => Object.assign({}, sum, value), {}));
    }

    utils.debugLog('Trace was filtered with ignored keys');
    const events = traceObject.events.map((event) => {
        if (!(event && event.resource && event.resource.metadata)) {
            return event;
        }

        const filteredEvent = Object.assign({}, event);
        filteredEvent.resource.metadata = filterObject(event.resource.metadata);
        return filteredEvent;
    });

    return Object.assign({}, traceObject, { events });
};

/**
 * Post given trace to epsagon's infrastructure.
 * @param {*} traceObject The trace data to send.
 * @returns {Promise} a promise that is resolved after the trace is posted.
 *  */
module.exports.postTrace = function postTrace(traceObject) {
    utils.debugLog(`Posting trace to ${config.getConfig().traceCollectorURL}`);

    const { ignoredKeys } = config.getConfig();
    const filteredTrace = ignoredKeys &&
        Array.isArray(ignoredKeys) &&
        ignoredKeys.length > 0 ?
        module.exports.filterTrace(traceObject, ignoredKeys) : traceObject;

    utils.debugLog(`trace: ${JSON.stringify(traceObject, null, 2)}`);
    return session.post(
        config.getConfig().traceCollectorURL,
        filteredTrace,
        {
            headers: { Authorization: `Bearer ${config.getConfig().token}` },
            timeout: config.getConfig().sendTimeout,
        }
    ).then((res) => {
        utils.debugLog('Trace posted!');
        return res;
    }).catch((err) => {
        if (err.config && err.config.data) {
            utils.debugLog(`Error sending trace. Trace size: ${err.config.data.length}`);
        } else {
            utils.debugLog(`Error sending trace. Error: ${err}`);
        }
        utils.debugLog(`${err ? err.stack : err}`);
        return err;
    }); // Always resolve.
};

/**
 * Sends the trace to epsagon's infrastructure when all pending events are finished.
 * @param {function} runnerUpdateFunc function that sets the duration of the runner.
 * @returns {Promise} a promise that is resolved when the trace transmission ends.
 */
module.exports.sendTrace = function sendTrace(runnerUpdateFunc) {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj || (tracerObj && tracerObj.disabled)) {
        return Promise.resolve();
    }

    utils.debugLog('Sending trace async');
    return Promise.all(tracerObj.pendingEvents.values()).then(() => {
        // Setting runner's duration.
        runnerUpdateFunc();
        return sendCurrentTrace(traceObject => module.exports.postTrace(traceObject));
    });
};

/**
 * Sends the trace to epsagon's infrastructure, marking all the pending promises as
 * failures.
 * @param {Object} tracer  Optional tracer
 * @returns {Promise} a promise that is resolved when the trace transmission ends.
 */
module.exports.sendTraceSync = function sendTraceSync() {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj || (tracerObj && tracerObj.disabled)) {
        return Promise.resolve();
    }

    utils.debugLog('Sending trace sync');
    tracerObj.pendingEvents.forEach((promise, event) => {
        if (promise.isPending()) {
            // Consider changing to report a different type of error. Maybe a new error code
            // describing an unknown operation state
            if (!event.getId()) {
                event.setId(uuid4());
            }
            if (event.getErrorCode() === errorCode.ErrorCode.OK) {
                eventInterface.addToMetadata(event, {
                    premature_exit: true,
                });
            }
            if (event.getDuration() === 0) {
                event.setDuration(utils.createDurationTimestamp(event.getStartTime() * 1000));
            }
        }
    });

    return sendCurrentTrace(traceObject => module.exports.postTrace(traceObject));
};

/**
 * Add a custom label to the runner of the current trace.
 * @param {string} key key for the added label
 * @param {string} value value for the added label
 */
module.exports.label = function addLabel(key, value) {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj) {
        utils.debugLog('Failed to label without an active tracer');
        return;
    }
    let labels = {};
    labels[key] = value;
    labels = utils.flatten(labels);
    Object.keys(labels).forEach((k) => {
        eventInterface.addLabelToMetadata(tracerObj.currRunner, k, labels[k]);
    });
};

/**
 * Set runner as an error.
 * @param {Error} err error data
 */
module.exports.setError = function setRunnerError(err) {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj) {
        utils.debugLog('Failed to setError without an active tracer');
        return;
    }
    eventInterface.setException(tracerObj.currRunner, err);
};

/**
 * Disable tracer
 */
module.exports.disable = function disable() {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj) {
        utils.debugLog('Failed to disabled without an active tracer');
        return;
    }
    tracerObj.disabled = true;
};


/**
 * Enable tracer
 */
module.exports.enable = function enable() {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj) {
        utils.debugLog('Failed to enable without an active tracer');
        return;
    }
    tracerObj.disabled = false;
};

module.exports.stripOperations = stripOperations;

/**
 * @returns {string} the current runner's log uuid
 */
module.exports.isLoggingTracingEnabled = function isLoggingTracingEnabled() {
    return config.getConfig().loggingTracingEnabled;
};

/**
 * @returns {string} the current runner's log uuid
 */
module.exports.getTraceId = function getTraceId() {
    const tracer = module.exports.getTrace();
    if (tracer && tracer.currRunner && tracer.currRunner.hasResource()) {
        return tracer.currRunner.getResource().getMetadataMap().get('trace_id');
    }
    return null;
};


/**
 * Adds `logging_tracing_enabled: true` to the current runner's Metadata iff it is enabled
 * in the config
 */
module.exports.addLoggingTracingEnabledMetadata = function addLoggingTracingEnabledMetadata() {
    if (config.getConfig().loggingTracingEnabled) {
        const tracer = module.exports.getTrace();
        if (tracer && tracer.currRunner) {
            eventInterface.addToMetadata(tracer.currRunner, {
                logging_tracing_enabled: true,
            });
        }
    }
};
