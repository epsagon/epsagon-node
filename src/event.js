/**
 * @fileoverview an interface to {@link proto.event_pb.Event} objects, with useful methods to
 * manipulate them
 */
const utils = require('./utils');
const errorCode = require('./proto/error_code_pb.js');
const exception = require('./proto/exception_pb.js');
const { config } = require('./config.js');
const tracer = require('./tracer.js');

/**
 * Sets an event's exception to the given error
 * @param {proto.event_pb.Event} event The event the exception is set on
 * @param {Error} error The error to set as the exception
 */
module.exports.setException = function setException(event, error) {
    try {
        event.setErrorCode(errorCode.ErrorCode.EXCEPTION);
        event.setException(new exception.Exception([
            error.name,
            error.message,
            error.stack,
            utils.createTimestamp(),
        ]));
    } catch (err) {
        tracer.addException(err);
    }
};

/**
 * Adds items from a map to a resource Metadata
 * @param {proto.event_pb.Event} event The event to add the items to
 * @param {object} map The map containing the objects
 * @param {object} [fullDataMap={}] Additional data to add only if {@link config.metadataOnly}
 *     is True
 */
module.exports.addToMetadata = function addToMetadata(event, map, fullDataMap = {}) {
    Object.keys(map).forEach((key) => {
        event.getResource().getMetadataMap().set(key, map[key]);
    });
    if (!config.metadataOnly) {
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
    if (config.metadataOnly && dataFields.length > 0) {
        const fields = Object.getOwnPropertyNames(object).filter(
            field => !dataFields.includes(field)
        );
        objectToAdd = Object.assign(...(fields.map(field => ({ [field]: object[field] }))));
    }
    event.getResource().getMetadataMap().set(key, JSON.stringify(objectToAdd));
};
