/**
 * @fileoverview Handlers for the azure-sdk js library instrumentation.
 */
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wraps the BlockBlobClient upload method.
 * @param {Function} wrappedFunction The function to wrap
 * @returns {Function} The wrapped function
 */
function blobUploadWrapper(wrappedFunction) {
    return function internalUploadWrapper(content, size) {
        const { accountName, containerName } = this;
        const { slsEvent: uploadEvent, startTime } = eventInterface.initializeEvent(
            'blob_storage',
            containerName,
            'upload',
            'azure-sdk'
        );
        eventInterface.addToMetadata(uploadEvent, {
            'azure.blob.account_name': accountName,
            'azure.blob.container_name': containerName,
            'azure.blob.content_size': size,
        }, { 'azure.blob.content': content });
        const request = wrappedFunction.apply(this, [content, size]);
        const requestPromise = request.then((res) => {
            eventInterface.addToMetadata(uploadEvent, { 'azure.blob.error_code': res.errorCode });
            uploadEvent.setDuration(utils.createDurationTimestamp(startTime));
            return res;
        }).catch((err) => {
            eventInterface.setException(uploadEvent, err);
            throw err;
        });

        tracer.addEvent(uploadEvent, requestPromise);
        return requestPromise;
    };
}

/**
 * Wraps the BlockBlobClient download method.
 * @param {Function} wrappedFunction The function to wrap
 * @returns {Function} The wrapped function
 */
function blobDownloadWrapper(wrappedFunction) {
    return function internalDownloadWrapper(offset, count, options) {
        const { accountName, containerName } = this;
        const { slsEvent: downloadEvent, startTime } = eventInterface.initializeEvent(
            'blob_storage',
            containerName,
            'download',
            'azure-sdk'
        );
        eventInterface.addToMetadata(downloadEvent, {
            'azure.blob.account_name': accountName,
            'azure.blob.container_name': containerName,
            'azure.blob.offset': offset,
        });
        const request = wrappedFunction.apply(this, [offset, count, options]);
        const requestPromise = request.then((res) => {
            eventInterface.addToMetadata(downloadEvent, { 'azure.blob.content_length': res.contentLength });
            downloadEvent.setDuration(utils.createDurationTimestamp(startTime));
            return res;
        }).catch((err) => {
            eventInterface.setException(downloadEvent, err);
            throw err;
        });
        tracer.addEvent(downloadEvent, requestPromise);
        return requestPromise;
    };
}


/**
 * Wraps the CosmosDB Item create method.
 * @param {Function} wrappedFunction The function to wrap
 * @returns {Function} The wrapped function
 */
function cosmosCreateItemWrapper(wrappedFunction) {
    return function internalCreateWrapper(body, options) {
        const { id: itemId, content } = body;
        const { container, clientContext } = this;
        const { database } = container;
        const name = `${database.id}/${container.id}`;
        const { slsEvent: createEvent, startTime } = eventInterface.initializeEvent(
            'cosmos_db',
            name,
            'create',
            'azure-sdk'
        );
        eventInterface.addToMetadata(createEvent, {
            'azure.cosmos.endpoint': clientContext.cosmosClientOptions.endpoint,
            'azure.cosmos.database_id': database.id,
            'azure.cosmos.container_id': container.id,
            'azure.cosmos.item_id': itemId,
        },
        { 'azure.cosmos.item_content': content });
        const request = wrappedFunction.apply(this, [body, options]);
        const requestPromise = request.then((res) => {
            eventInterface.addToMetadata(createEvent, { 'azure.cosmos.status_code': res.statusCode });
            createEvent.setDuration(utils.createDurationTimestamp(startTime));
            return res;
        }).catch((err) => {
            eventInterface.setException(createEvent, err);
            throw err;
        });
        tracer.addEvent(createEvent, requestPromise);
        return requestPromise;
    };
}

module.exports = {
    /**
     * Patch Azure SDK methods.
     */
    init() {
        moduleUtils.patchModule(
            '@azure/storage-blob',
            'upload',
            blobUploadWrapper,
            Clients => Clients.BlockBlobClient.prototype
        );
        moduleUtils.patchModule(
            '@azure/storage-blob',
            'download',
            blobDownloadWrapper,
            Clients => Clients.BlockBlobClient.prototype
        );
        moduleUtils.patchModule(
            '@azure/cosmos',
            'create',
            cosmosCreateItemWrapper,
            index => index.Items.prototype
        );
    },
};
