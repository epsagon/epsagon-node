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
const azure = require('./containers/azure.js');
const winstonCloudwatch = require('./events/winston_cloudwatch');
const { isStrongId } = require('./helpers/events');

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
        if (!utils.isLambdaEnv) {
            const ecsMetaUri = ecs.hasECSMetadata();
            if (ecsMetaUri) {
                ecs.loadECSMetadata(ecsMetaUri).catch(err => utils.debugLog(err));
            }
            if (k8s.hasK8sMetadata()) {
                k8s.loadK8sMetadata();
            }
            azure.loadAzureMetadata((azureAdditionalConfig) => {
                config.setConfig(Object.assign(azureAdditionalConfig, configData));
            });
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


/**
 * Keeps only strong IDs in event metadata.
 * @param {array} eventMetadata Event metadata.
 * @param {boolean} isRunner is evnet origin is runner.
 * @returns {array} Trimmed event metadata.
 */
function getTrimmedMetadata(eventMetadata, isRunner) {
    let trimmedEventMetadata;
    Object.keys(eventMetadata).forEach((eventKey) => {
        if (!isStrongId(eventKey) && (isRunner && eventKey !== 'labels')) {
            if (!trimmedEventMetadata) {
                trimmedEventMetadata = eventMetadata;
                trimmedEventMetadata.is_trimmed = true;
            }
            delete trimmedEventMetadata[eventKey];
        }
    });
    return trimmedEventMetadata;
}


/**
 * Trimming trace exceptions.
 * @param {Object} traceExceptions Trace exceptions
 * @returns {array} array of the first exception,
 *  total exceptions have been trimmed and the reduce size.
 */
function trimTraceExceptions(traceExceptions) {
    const firstException = traceExceptions[0];
    const totalTrimmed = traceExceptions.length - 1;
    const reduceSize =
    JSON.stringify(traceExceptions).length - JSON.stringify(firstException).length;
    return [firstException, totalTrimmed, reduceSize];
}

/**
 * Trimming trace to a size less than MAX_TRACE_SIZE_BYTES.
 * @param {number} traceSize Trace size.
 * @param {JSON} jsTrace Trace.
 * @returns {JSON} Trace with trimmed events metadata.
 */
function getTrimmedTrace(traceSize, jsTrace) {
    let currentTraceSize = traceSize;
    const trimmedTrace = Object.assign({}, jsTrace);
    let totalTrimmedExceptions = 0;
    let totalTrimmedEvents = 0;
    // Trimming trace exceptions.
    if (trimmedTrace.exceptions.length > 1) {
        const [firstException, totalTrimmed, reduceSize] = trimTraceExceptions(
            trimmedTrace.exceptions
        );
        currentTraceSize -= reduceSize;
        totalTrimmedExceptions = totalTrimmed;
        trimmedTrace.exceptions = [firstException];
    }
    // Trimming trace events metadata.
    if (currentTraceSize >= consts.MAX_TRACE_SIZE_BYTES) {
        trimmedTrace.events = jsTrace.events.sort(event => (['runner', 'trigger'].includes(event.origin) ? -1 : 1));
        for (let i = jsTrace.events.length - 1; i >= 0; i -= 1) {
            const currentEvent = trimmedTrace.events[i];
            let eventMetadata = currentEvent.resource.metadata;
            if (eventMetadata) {
                const isRunner = currentEvent.origin === 'runner';
                const originalEventMetadataSize = JSON.stringify(eventMetadata).length;
                const trimmedMetadata = getTrimmedMetadata(eventMetadata, isRunner);
                if (trimmedMetadata) {
                    eventMetadata = trimmedMetadata;
                    const trimmedSize =
                    originalEventMetadataSize - JSON.stringify(trimmedMetadata).length;
                    currentTraceSize -= trimmedSize;
                    if (currentTraceSize < consts.MAX_TRACE_SIZE_BYTES) {
                        break;
                    }
                }
            }
        }
    }
    // Trimming trace events.
    if (currentTraceSize >= consts.MAX_TRACE_SIZE_BYTES) {
        for (let i = jsTrace.events.length - 1; i >= 0; i -= 1) {
            const event = trimmedTrace.events[i];
            if (!['runner', 'trigger'].includes(event.origin)) {
                totalTrimmedEvents += 1;
                trimmedTrace.events.splice(i, 1);
                currentTraceSize -= JSON.stringify(event).length;
                if (currentTraceSize < consts.MAX_TRACE_SIZE_BYTES) {
                    break;
                }
            }
        }
    }
    if (totalTrimmedEvents || totalTrimmedExceptions) {
        utils.debugLog(`Epsagon - Trace size is larger than maximum size, ${totalTrimmedEvents} events and ${totalTrimmedExceptions} exceptions were trimmed.`);
    }
    return trimmedTrace;
}

/**
 * Sets labels to trace metadata
 * @param {object} tracerObj: Tracer object
 */
function addLabelsToTrace() {
    const tracerObj = module.exports.getTrace();
    Object.keys(config.getConfig().labels).forEach((key) => {
        const currLabels = tracerObj.currRunner.getResource().getMetadataMap().get('labels');
        if (!currLabels) {
            eventInterface.addLabelToMetadata(tracerObj.currRunner,
                key,
                config.getConfig().labels[key]);
        } else if (!JSON.parse(currLabels)[key]) {
            eventInterface.addLabelToMetadata(
                tracerObj.currRunner,
                key,
                config.getConfig().labels[key]
            );
        }
    });
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

    const { sendOnlyErrors, ignoredKeys } = config.getConfig();
    if (!tracerObj) {
        return Promise.resolve();
    }
    addLabelsToTrace();

    if (!tracerObj.currRunner) {
        utils.debugLog('Epsagon - no trace was sent since runner was not found.');
        return Promise.resolve();
    }

    // adding metadata here since it has a better chance of completing in time
    eventInterface.addToMetadata(
        tracerObj.currRunner,
        winstonCloudwatch.additionalMetadata()
    );
    ecs.addECSMetadata(tracerObj.currRunner);
    k8s.addK8sMetadata(tracerObj.currRunner);
    azure.addAzureMetadata(tracerObj.currRunner);

    // Check if got error events
    if (sendOnlyErrors) {
        const errorEvents = tracerObj.trace.getEventList().filter(event => event.getErrorCode());
        if (errorEvents.length === 0) {
            utils.debugLog('Epsagon - no trace was sent since no error events found.');
            tracerObj.pendingEvents.clear();
            return Promise.resolve();
        }
    }
    let traceJson = {
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

    traceJson = ignoredKeys &&
        Array.isArray(ignoredKeys) &&
        ignoredKeys.length > 0 ?
        module.exports.filterTrace(traceJson, ignoredKeys) : traceJson;

    let stringifyTraceJson;
    try {
        stringifyTraceJson = JSON.stringify(traceJson);
    } catch (err) {
        utils.printWarning('Epsagon - no trace was sent since there was an error serializing the trace. Please contact support.', err);
        return Promise.resolve();
    }
    const originalTraceLength = stringifyTraceJson.length;
    if (originalTraceLength >= consts.MAX_TRACE_SIZE_BYTES) {
        traceJson = getTrimmedTrace(originalTraceLength, traceJson);
    }

    const sendResult = traceSender(traceJson);
    tracerObj.pendingEvents.clear();

    if (config.getConfig().sampleRate !== consts.DEFAULT_SAMPLE_RATE) {
        tracerObj.deleted = true;
    }
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

        const unFilteredKeys = Object
            .keys(obj)
            .filter(isNotIgnored);
        const maskedKeys = Object.keys(obj).filter(k => !isNotIgnored(k));

        const primitive = unFilteredKeys.filter(k => !isObject(obj[k]) && !isString(obj[k]));
        const objects = unFilteredKeys
            .filter(k => isObject(obj[k]))
            .map(k => ({ [k]: filterObject(obj[k]) }));

        // trying to JSON load strings to filter sensitive data
        unFilteredKeys.filter(k => isString(obj[k])).forEach((k) => {
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
            maskedKeys.reduce((sum, key) => Object.assign({}, sum, { [key]: '****' }), {}),
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
    utils.debugLog(`trace: ${JSON.stringify(traceObject, null, 2)}`);

    // based on https://github.com/axios/axios/issues/647#issuecomment-322209906
    // axios timeout is only after the connection is made, not the address resolution itself
    const cancelTokenSource = axios.CancelToken.source();
    const handle = setTimeout(() => {
        cancelTokenSource.cancel('timeout sending trace');
    }, config.getConfig().sendTimeout);

    return session.post(
        config.getConfig().traceCollectorURL,
        traceObject,
        {
            headers: { Authorization: `Bearer ${config.getConfig().token}` },
            timeout: config.getConfig().sendTimeout,
            cancelToken: cancelTokenSource.token,
        }
    ).then((res) => {
        clearTimeout(handle);
        utils.debugLog('Trace posted!');
        return res;
    }).catch((err) => {
        clearTimeout(handle);
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

    if (config.getConfig().isEpsagonDisabled) {
        tracerObj.pendingEvents.clear();
        return Promise.resolve();
    }

    addLabelsToTrace();
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

    if (config.getConfig().isEpsagonDisabled) {
        tracerObj.pendingEvents.clear();
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
    if (!tracerObj || !tracerObj.currRunner) {
        utils.debugLog('Failed to label without an active tracer');
        return;
    }
    const labels = {
        [key]: value,
    };
    const flatLabels = utils.flatten(labels);
    Object.keys(flatLabels).forEach((k) => {
        eventInterface.addLabelToMetadata(tracerObj.currRunner, k, flatLabels[k]);
    });
};

/**
 * Set runner as an error.
 * @param {Error} err error data
 */
module.exports.setError = function setRunnerError(err) {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj || !tracerObj.currRunner) {
        utils.debugLog('Failed to setError without an active tracer');
        return;
    }
    eventInterface.setException(tracerObj.currRunner, err);
};

/**
 * Set runner as an warning.
 * @param {Error} err error data
 */
module.exports.setWarning = function setRunnerWarning(err) {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj || !tracerObj.currRunner) {
        utils.debugLog('Failed to setWarning without an active tracer');
        return;
    }
    eventInterface.setException(tracerObj.currRunner, err, true, true);
};

/**
 * Get a link to the trace in Epsagon.
 * @returns {string} traceUrl link to Epsagon.
 */
module.exports.getTraceUrl = function getTraceUrl() {
    const tracerObj = module.exports.getTrace();
    if (!tracerObj || !tracerObj.currRunner) {
        utils.debugLog('Failed to get trace URL without an active tracer');
        return '';
    }
    const activeRunner = tracerObj.currRunner.getResource();
    return (activeRunner.getType() !== 'lambda') ?
        consts.traceUrl(
            module.exports.getTraceId(),
            parseInt(tracerObj.currRunner.getStartTime(), 10)
        ) : consts.lambdaTraceUrl(
            activeRunner.getMetadataMap().get('aws_account'),
            activeRunner.getMetadataMap().get('region'),
            activeRunner.getName(),
            tracerObj.currRunner.getId(),
            parseInt(tracerObj.currRunner.getStartTime(), 10)
        );
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

module.exports.getTrimmedTrace = getTrimmedTrace;

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
            utils.debugLog('Setting logging_tracing_enabled');
            eventInterface.addToMetadata(tracer.currRunner, {
                logging_tracing_enabled: true,
            });
        }
    }
};
