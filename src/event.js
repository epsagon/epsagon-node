/**
 * @fileoverview an interface to {@link proto.event_pb.Event} objects, with useful methods to
 * manipulate them
 */
const uuid4 = require('uuid4');
const utils = require('./utils');
const errorCode = require('./proto/error_code_pb.js');
const exception = require('./proto/exception_pb.js');
const config = require('./config.js');
const tracer = require('./tracer.js');
const consts = require('./consts.js');
const serverlessEvent = require('./proto/event_pb.js');

/**
 * Sets an event's exception to the given error
 * @param {proto.event_pb.Event} event The event the exception is set on
 * @param {Error} error The error to set as the exception
 * @param {boolean} handled False if the exception was raised by the wrapped function
 */
module.exports.setException = function setException(event, error, handled = true) {
    try {
        event.setErrorCode(errorCode.ErrorCode.EXCEPTION);
        const userException = new exception.Exception([
            error.name,
            error.message,
            error.stack,
            utils.createTimestamp(),
        ]);
        event.setException(userException);
        userException.getAdditionalDataMap().set('handled', handled);
    } catch (err) {
        tracer.addException(err);
    }
};

/**
 * Add timeout indication to a given event
 * @param {proto.event_pb.Event} event The event the timeout is set on
 */
module.exports.markAsTimeout = function setTimeout(event) {
    event.setErrorCode(errorCode.ErrorCode.TIMEOUT);
};

/**
 * Adds items from a map to a resource Metadata
 * @param {proto.event_pb.Event} event The event to add the items to
 * @param {object} map The map containing the objects
 * @param {object} [fullDataMap={}] Additional data to add only if {@link config.metadataOnly}
 *     is False
 */
module.exports.addToMetadata = function addToMetadata(event, map, fullDataMap = {}) {
    Object.keys(map).forEach((key) => {
        event.getResource().getMetadataMap().set(key, map[key]);
    });
    if (!config.getConfig().metadataOnly) {
        Object.keys(fullDataMap).forEach((key) => {
            event.getResource().getMetadataMap().set(key, fullDataMap[key]);
        });
    }
};


/**
 * Adds JSON serialized object to a resource Metadata
 * @param {proto.event_pb.Event} event The event to add the items to
 * @param {string} key The name of field that is added
 * @param {object} object The object to add
 * @param {array} [dataFields=[]] List of data fields that should be filtered out
 *  only if {@link config.metadataOnly} is True
 */
module.exports.addObjectToMetadata = function addObjectToMetadata(
    event,
    key,
    object,
    dataFields = []
) {
    let objectToAdd = object;
    if (config.getConfig().metadataOnly && dataFields.length > 0) {
        const fields = Object.getOwnPropertyNames(object).filter(
            field => !dataFields.includes(field)
        );
        objectToAdd = Object.assign(...(fields.map(field => ({ [field]: object[field] }))));
    }
    event.getResource().getMetadataMap().set(key, JSON.stringify(objectToAdd));
};

/**
 * Adds a given label to the metadata map
 * @param {proto.event_pb.Event} event The event to add the items to
 * @param {string} key key for the added label
 * @param {string} value value for the added label
 */
module.exports.addLabelToMetadata = function addLabelToMetadata(event, key, value) {
    const currLabels = event.getResource().getMetadataMap().get('labels');
    let labels = null;
    if (currLabels !== undefined) {
        labels = JSON.parse(currLabels);
        labels[key] = value;
    } else {
        labels = { [key]: value };
    }

    const labelsJson = JSON.stringify(labels);
    if (labelsJson.length <= consts.MAX_LABEL_SIZE) {
        event.getResource().getMetadataMap().set('labels', labelsJson);
    }
};

/**
 * Create and initialize a new serverless event in the epsagon format.
 * @param {string} resourceType resourceType name
 * @param {string} name Event name
 * @param {string} operation Operation name
 * @param {string} origin Origin name
 * @returns {Object} Object with serverlessEvent and event started time.
 */
module.exports.initializeEvent = function initializeEvent(resourceType, name, operation, origin) {
    const startTime = Date.now();
    const resource = new serverlessEvent.Resource([
        name,
        resourceType,
        operation,
    ]);
    const slsEvent = new serverlessEvent.Event([
        `${resourceType}-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        origin,
        0,
        errorCode.ErrorCode.OK,
    ]);
    slsEvent.setResource(resource);
    return { slsEvent, startTime, resource };
};

/**
 * Adding callback data/error to event, and finalize event.
 * @param {serverlessEvent.Event} slsEvent Serverless event.
 * @param {number} startTime Event start time.
 * @param {Error} error Callback error.
 * @param {string[] | Object[] | Object} metadata Callback metadata.
 */
module.exports.finalizeEvent = function finalizeEvent(slsEvent, startTime, error, metadata) {
    try {
        if (error) {
            this.setException(slsEvent, error);
        }
        if (metadata) {
            this.addToMetadata(slsEvent, metadata);
        }
        slsEvent.setDuration(utils.createDurationTimestamp(startTime));
    } catch (err) {
        tracer.addException(err);
    }
};
