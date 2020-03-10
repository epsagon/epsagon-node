/**
 * @fileoverview Instrumentation for google cloud library.
 */
const uuid4 = require('uuid4');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const moduleUtils = require('./module_utils.js');
const epsagonConfig = require('../config.js');

const URL_SPLIT_STRING = 'googleapis.com/';
const BIG_QUERY = 'bigquery';

const GOOGLE_CLOUD_TYPES = {
    defaultProjectId: '{{projectId}}',
    pubsub: {
        type: 'pubsub',
        origin: 'google_cloud/pubsub',
    },
};

/**
 * Wraps the bigQuery makeRequest function.
 * @param {Function} wrappedFunction The makeRequest function
 * @returns {Function} The wrapped function
 */
function bigQueryWrapper(wrappedFunction) {
    return function internalOWWrapper(reqOpts, config, callback) {
        if (reqOpts.uri.indexOf(BIG_QUERY) === -1) {
            return wrappedFunction.apply(this, [reqOpts, config, callback]);
        }

        const uri = reqOpts.uri.split(URL_SPLIT_STRING)[1] || '';
        const splitUri = uri.split('/');
        const service = splitUri[0] || 'google-cloud';
        const projectId = splitUri[3] || 'Unknown';
        const path = uri.split(`${projectId}/`)[1];
        const operation = path.split('/')[0] || 'Unknown';
        const resource = new serverlessEvent.Resource([
            projectId,
            service,
            operation,
        ]);

        const startTime = Date.now();
        let eventName = `${service}-${uuid4()}`;
        let jsonMetadata = {};

        if (reqOpts.json !== undefined) {
            eventName = reqOpts.json.jobReference.jobId;
            jsonMetadata = reqOpts.json;
        } else if (reqOpts.uri !== undefined) {
            // eslint-disable-next-line
            eventName = reqOpts.uri.split('/')[8];
        }
        const invokeEvent = new serverlessEvent.Event([
            eventName,
            utils.createTimestampFromTime(startTime),
            null,
            service,
            0,
            errorCode.ErrorCode.OK,
        ]);

        invokeEvent.setResource(resource);
        eventInterface.addToMetadata(
            invokeEvent,
            {},
            jsonMetadata
        );

        let patchedCallback;
        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, body, response) => {
                invokeEvent.setDuration(utils.createDurationTimestamp(startTime));
                eventInterface.addToMetadata(invokeEvent, {}, response.body);
                resolve();
                callback(err, body, response);
            };
        }).catch((err) => {
            tracer.addException(err);
        });

        tracer.addEvent(invokeEvent, responsePromise);
        return wrappedFunction.apply(this, [reqOpts, config, patchedCallback]);
    };
}

/**
 * Getting message data from array.
 * Message data is Buffer which contain a json of js object.
 * @param {Array} reqOptsMessages array with messages data
 * @param {number} index index of message
 * @returns {*} message data, null if not found.
 */
const getMessageData = (reqOptsMessages, index) => {
    if (Array.isArray(reqOptsMessages) &&
        reqOptsMessages.length > index &&
        reqOptsMessages[index].data
    ) {
        try {
            const messageData = JSON.parse(`${reqOptsMessages[index].data}`);
            if (typeof messageData === 'object') {
                return messageData;
            }
        } catch (err) {
            return null;
        }
    }
    return null;
};

const getMessageIdsArray = (messages) => {
    const messageIds = messages && messages.messageIds ? messages.messageIds : messages;
    if (Array.isArray(messageIds)) {
        return messageIds;
    }
    return null;
};

const handlePublishMethod = (messages, config) => {
    const messageIdsArray = getMessageIdsArray(messages);
    if (messageIdsArray) {
        const reqOptsMessages = config.reqOpts && config.reqOpts.messages;
        const parsedMessages = messageIdsArray.reduce((acc, messageId, currentIndex) => {
            let message = { id: messageId };
            const messageData = getMessageData(reqOptsMessages, currentIndex);
            if (messageData) {
                message = Object.assign(message, messageData);
            }
            acc.push(message);
            return acc;
        }, []);
        return { messages: parsedMessages, messageIdsArray };
    }
    return null;
};

const getMessagesFromResponse = (res) => {
    if (res && res.receivedMessages) {
        const messageIdsArray = [];
        const messages = res.receivedMessages.reduce((acc, current) => {
            const { messageId } = current.message;
            messageIdsArray.push(messageId);
            let messageObject = { messageId };
            const messageData = (current.message.data && JSON.parse(`${current.message.data}`));
            // add message only when METADATA_ONLY === FALSE
            if (!epsagonConfig.getConfig().metadataOnly) {
                if (messageData && typeof messageData === 'object') {
                    messageObject = Object.assign(messageObject, messageData);
                }
            }
            acc.push(messageObject);
            return acc;
        }, []);
        return { messages, messageIdsArray };
    }
    return null;
};


/**
 * Wrap pubsub request function.
 * @param {Function} original pubsub request function.
 * @returns {Function} The wrapped function
 */
function wrapPubSubRequestFunction(original) {
    return function internalPubSubRequestFunction(config, callback) {
        let patchedCallback = callback;
        try {
            const pubsubProjectId = this.projectId;
            const { slsEvent: pubsubEvent, startTime } = eventInterface.initializeEvent(
                GOOGLE_CLOUD_TYPES.pubsub.type,
                pubsubProjectId,
                config.method,
                GOOGLE_CLOUD_TYPES.pubsub.origin
            );
            const requestFunctionThis = this;
            const responsePromise = new Promise((resolve) => {
                patchedCallback = (err, arg2, ...arg3) => {
                    if ((!pubsubProjectId || pubsubProjectId === GOOGLE_CLOUD_TYPES
                        .defaultProjectId) && !!requestFunctionThis.projectId) {
                        pubsubEvent.getResource().setName(requestFunctionThis.projectId);
                    }
                    const responseMetadata = {};
                    const payload = {};
                    switch (arg2 && config.method) {
                    case 'publish': {
                        const { messages, messageIdsArray } = handlePublishMethod(arg2, config);
                        if (messageIdsArray) {
                            responseMetadata.messageIds = messageIdsArray;
                            if (messageIdsArray.length) {
                                pubsubEvent.setId(messageIdsArray[0]);
                            }
                        }
                        if (messages) {
                            payload.messages = messages;
                        }
                        break;
                    }
                    case 'createSubscription':
                        responseMetadata.subscription = arg2;
                        break;
                    case 'deleteSubscription':
                        if (config.reqOpts && config.reqOpts.subscription) {
                            responseMetadata.subscription = utils.getLastSplittedItem(
                                config.reqOpts.subscription,
                                '/'
                            );
                        }
                        break;
                    case 'createTopic':
                        responseMetadata.topic = arg2;
                        break;
                    case 'deleteTopic':
                        if (config.reqOpts && config.reqOpts.topic) {
                            responseMetadata.topic = utils.getLastSplittedItem(
                                config.reqOpts.topic,
                                '/'
                            );
                        }
                        break;
                    default:
                        break;
                    }
                    eventInterface.finalizeEvent(
                        pubsubEvent,
                        startTime,
                        err,
                        responseMetadata,
                        payload
                    );
                    resolve();
                    if (callback) {
                        callback(err, arg2, ...arg3);
                    }
                };
            });
            tracer.addEvent(pubsubEvent, responsePromise);
        } catch (err) {
            tracer.addException(err);
        }
        return original.apply(this, [config, patchedCallback]);
    };
}

/**
 * Wrap pubsub request function.
 * @param {Function} original pubsub request function.
 * @returns {Function} The wrapped function
 */
function wrapPubSubPullFunction(original) {
    return function internalPubSubPullFunction(request, options, callback) {
        let clientPromiseRequest;
        try {
            let pubsubProjectId;
            if (request && request.subscription) {
                const subscriptionSplited = request.subscription.split('/');
                if (subscriptionSplited.length > 1) {
                    [, pubsubProjectId] = subscriptionSplited;
                }
            }
            const { slsEvent: pubsubEvent, startTime } = eventInterface.initializeEvent(
                GOOGLE_CLOUD_TYPES.pubsub.type, pubsubProjectId, 'Pull', GOOGLE_CLOUD_TYPES.pubsub.origin
            );
            const patchedCallback = (err, res, promiseResolve) => {
                const responseMetadata = {};
                const payload = {};
                const { receivedMessages, messageIdsArray } = getMessagesFromResponse(res);
                if (messageIdsArray) {
                    responseMetadata.messageIds = messageIdsArray;
                    if (messageIdsArray.length) {
                        pubsubEvent.setId(messageIdsArray[0]);
                    }
                }
                if (receivedMessages) {
                    payload.receivedMessages = receivedMessages;
                }
                eventInterface.finalizeEvent(
                    pubsubEvent,
                    startTime,
                    err,
                    responseMetadata,
                    payload
                );
                if (promiseResolve) {
                    promiseResolve();
                }
                if (callback) {
                    callback(err, res);
                }
            };
            // in case callback was given from the client.
            if (callback) {
                let patchedCallbackWithPromise = callback;
                const promise = new Promise((resolve) => {
                    patchedCallbackWithPromise = (err, res) => {
                        patchedCallback(err, res, resolve);
                    };
                });
                tracer.addEvent(pubsubEvent, promise);
                return original.apply(this, [request, options, patchedCallbackWithPromise]);
            }
            clientPromiseRequest = original.apply(this, [request, options, callback]).then(
                (res) => {
                    const [response] = res;
                    patchedCallback(null, response);
                    return res;
                }, (err) => {
                    patchedCallback(err, null);
                    throw err;
                }
            );
            tracer.addEvent(pubsubEvent, clientPromiseRequest);
        } catch (err) {
            tracer.addException(err);
            if (!clientPromiseRequest) {
                clientPromiseRequest = original.apply(this, [request, options, callback]);
            }
        }
        return clientPromiseRequest;
    };
}

module.exports = {
    /**
     * Initializes the bigQuery makeRequest tracer
     */
    init() {
        moduleUtils.patchModule(
            '@google-cloud/common/',
            'makeRequest',
            bigQueryWrapper,
            common => common.util
        );
        moduleUtils.patchModule(
            '@google-cloud/pubsub/',
            'request',
            wrapPubSubRequestFunction,
            pubsub => pubsub.PubSub.prototype
        );
        moduleUtils.patchModule(
            '@google-cloud/pubsub/',
            'pull',
            wrapPubSubPullFunction,
            pubsub => pubsub.v1.SubscriberClient.prototype
        );
    },
};

module.exports.getMessageData = getMessageData;
module.exports.handlePublishMethod = handlePublishMethod;
module.exports.getMessagesFromResponse = getMessagesFromResponse;
