/**
 * @fileoverview The tracer, managing all the trace collecting and sending
 */
const uuid4 = require('uuid4');
const stringify = require('json-stringify-safe');
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
const ec2 = require('./containers/ec2.js');
const winstonCloudwatch = require('./events/winston_cloudwatch');
const TraceQueue = require('./trace_queue.js');
const { isStrongId } = require('./helpers/events');
const logSender = require('./trace_senders/logs.js');
const httpSender = require('./trace_senders/http.js');


/**
 * Returns a function to get the relevant tracer.
 */
module.exports.getTrace = () => {};

/**
 * Returns a trace queue singletone.
 */
const traceQueue = TraceQueue.getInstance();

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
        createdAt: Date.now(),
    };
};


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
    this.addPendingEvent(event, promise);
    tracerObj.trace.addEvent(event);
};

/**
 * Add promise event result to pendingEvents map.
 * @param {proto.event_pb.Event} event The event
 * @param {Promise} [promise] A promise that resolves when the event handling is Done
 */
module.exports.addPendingEvent = function addPendingEvent(event, promise) {
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

            utils.debugLog('checking for K8s metadata')
            if (k8s.hasK8sMetadata()) {
                utils.debugLog('found K8s metadata, loading')
                k8s.loadK8sMetadata();
            }
            azure.loadAzureMetadata((azureAdditionalConfig) => {
                config.setConfig(Object.assign(azureAdditionalConfig, configData));
            });
            ec2.loadEC2Metadata().catch(err => utils.debugLog(err));
        }
    } catch (err) {
        utils.debugLog('Could not extract container env data');
    }
    config.setConfig(configData);
    traceQueue.updateConfig();
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
        if (!(isStrongId(eventKey) || (isRunner && eventKey === 'labels'))) {
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
    utils.debugLog(`Epsagon - Pre metadata trim: current trace size ${currentTraceSize}`);
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
    utils.debugLog(`Epsagon - After metadata trim: current trace size ${currentTraceSize}`);
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
    utils.debugLog(`Epsagon - After events trim: current trace size ${currentTraceSize}`);
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
    if (!tracerObj) {
        return;
    }
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
 * @param {object} tracerObject Optional tracer object to use for sending.
 * @return {*} traceSender's result
 */
function sendCurrentTrace(traceSender, tracerObject) {
    const tracerObj = tracerObject || module.exports.getTrace();

    const { sendOnlyErrors, ignoredKeys, removeIgnoredKeys } = config.getConfig();
    if (!tracerObj) {
        utils.debugLog('Trace object not found for sending');
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

    utils.debugLog('adding K8s metadata to trace');
    k8s.addK8sMetadata(tracerObj.currRunner);
    azure.addAzureMetadata(tracerObj.currRunner);
    ec2.addEC2Metadata(tracerObj.currRunner);

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

    try {
        traceJson = ignoredKeys &&
            Array.isArray(ignoredKeys) &&
            ignoredKeys.length > 0 ?
            module.exports.filterTrace(traceJson, ignoredKeys, removeIgnoredKeys) : traceJson;
    } catch (err) {
        utils.printWarning('Epsagon - failed to filter trace, cancelling send', err);
        return Promise.resolve({});
    }

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
 * Tests if a string value (which is suspected to be a stringyfied JSON)
 * contains an ignored key
 * @param {Array<String | RegExp>} keysToIgnore a list of keys to ignore
 * @param {string} value a value to search ignored keys in
 * @returns {boolean} true for non-ignored keys
 */
module.exports.doesContainIgnoredKey = function doesContainIgnoredKey(keysToIgnore, value) {
    return keysToIgnore
        .some((predicate) => {
            if (typeof predicate === 'string' && config.processIgnoredKey(value).includes(predicate)) {
                return true;
            }
            if (predicate instanceof RegExp && predicate.test(value)) {
                return true;
            }
            return false;
        });
};

/**
 * Filter a trace to exclude all unwanted keys
 * @param {Object} traceObject  the trace to filter
 * @param {Array<String>} ignoredKeys   keys to ignore
 * @param {Boolean} removeIgnoredKeys Whether to remove keys instead of masking
 * @returns {Object}  filtered trace
 */
module.exports.filterTrace = function filterTrace(traceObject, ignoredKeys, removeIgnoredKeys) {
    const isString = x => typeof x === 'string';

    const isPossibleStringJSON = v => isString(v) && v.length > 1 && ['[', '{'].includes(v[0]);

    /**
     * Tests if a key is to be ignored or not.
     * @param {string} key a key in an object or hash map
     * @returns {boolean} true for non-ignored keys
     */
    function isNotIgnored(key) {
        for (let i = 0; i < ignoredKeys.length; i += 1) {
            const predicate = ignoredKeys[i];
            if (typeof predicate === 'string' &&
            predicate === config.processIgnoredKey(key)) {
                return false;
            }
            if (predicate instanceof RegExp && predicate.test(key)) {
                return false;
            }
        }
        return true;
    }

    /**
     * stringify replacer function, used to ignore the relevant keys
     * @param {string} key  the key of the value
     * @param {any} value   the json value
     * @returns {any} the value to serialize
     */
    function replacer(key, value) {
        if (isNotIgnored(key)) {
            if (isPossibleStringJSON(value)) {
                try {
                    const objValue = JSON.parse(value);
                    const filtered = stringify(objValue, replacer, 0, () => {});
                    return JSON.parse(filtered);
                } catch (e) {
                    return value;
                }
            }

            return value;
        }

        return removeIgnoredKeys ? undefined : '****';
    }

    utils.debugLog('Trace was filtered with ignored keys');
    const events = traceObject.events.map((event) => {
        if (!(event && event.resource && event.resource.metadata)) {
            return event;
        }

        const filteredEvent = Object.assign({}, event);

        // remove all circular references from the metadata object
        // before recursively ignoring keys to avoid an endless recursion
        const metadata = JSON.parse(stringify(event.resource.metadata, replacer, 0, () => {}));
        filteredEvent.resource.metadata = metadata;

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
    if (config.getConfig().logTransportEnabled) {
        return logSender.sendTrace(traceObject);
    }

    return httpSender.sendTrace(traceObject);
};

/**
 * Sends the trace to epsagon's infrastructure when all pending events are finished.
 * @param {function} runnerUpdateFunc function that sets the duration of the runner.
 * @param {object} tracerObject Optional tracer object to use for sending.
 * @returns {Promise} a promise that is resolved when the trace transmission ends.
 */
module.exports.sendTrace = function sendTrace(runnerUpdateFunc, tracerObject) {
    const tracerObj = tracerObject || module.exports.getTrace();
    if (!tracerObj || (tracerObj && tracerObj.disabled)) {
        utils.debugLog('Trace object not found or disabled');
        return Promise.resolve();
    }

    if (config.getConfig().isEpsagonDisabled) {
        tracerObj.pendingEvents.clear();
        return Promise.resolve();
    }

    addLabelsToTrace();
    utils.debugLog('Sending trace async...');
    return Promise.all(tracerObj.pendingEvents.values()).then(() => {
        // Setting runner's duration.
        runnerUpdateFunc();
        if (config.getConfig().sendBatch) {
            return sendCurrentTrace(traceObject => traceQueue.push(traceObject), tracerObj);
        }
        return sendCurrentTrace(traceObject => module.exports.postTrace(traceObject), tracerObj);
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
