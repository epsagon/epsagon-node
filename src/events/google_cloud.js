/**
 * @fileoverview Instrumentation for google cloud library.
 */
const { PubSub, v1 } = require('@google-cloud/pubsub');
const shimmer = require('shimmer');
const uuid4 = require('uuid4');
const utils = require('../utils.js');
const { initialEvent, finalizeEvent } = require('../helpers/events');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const moduleUtils = require('./module_utils.js');

const URL_SPLIT_STRING = 'googleapis.com/';
const BIG_QUERY = 'bigquery';

const GOOGLE_CLOUD_TYPES = {
    defaultProjectId: '{{projectId}}',
    pubsub: {
        name: 'pubsub',
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

const getLastSplittedString = (array) => {
    const splittedArray = (array && array.split('/')) || [];
    return splittedArray[splittedArray.length - 1];
};

/**
 * Wrap pubsub request function.
 * @param {Function} original pubsub request function.
 * @returns {Function} The wrapped function
 */
function wrapPubSubRequestFunction(original) {
    return function internalPubSubRequestFunction(config, callback) {
        if (!config || !config.method) {
            return original.apply(this, [config, callback]);
        }
        let patchedCallback = callback;
        try {
            const pubsubProjectId = this.projectId;
            const { event, startTime } = initialEvent(
                GOOGLE_CLOUD_TYPES.pubsub.name, pubsubProjectId, config.method
            );
            const requestFunctionThis = this;
            const responsePromise = new Promise((resolve) => {
                patchedCallback = (err, arg2, arg3) => {
                    if ((!pubsubProjectId || pubsubProjectId === GOOGLE_CLOUD_TYPES
                        .defaultProjectId) && !!requestFunctionThis.projectId) {
                        event.getResource().setName(requestFunctionThis.projectId);
                    }
                    const callbackResponse = {};
                    if (arg2) {
                        if (config.method === 'publish') {
                            const messageIds = arg2.messageIds ? arg2.messageIds : arg2;
                            if (Array.isArray(messageIds) && messageIds.length) {
                                callbackResponse.messageIds = messageIds;
                                const [messageId] = messageIds;
                                callbackResponse.messageId = messageId;
                            }
                        } else if (config.method === 'createSubscription') {
                            callbackResponse.subscription = arg2;
                        } else if (config.method === 'deleteSubscription') {
                            if (config.reqOpts && config.reqOpts.subscription) {
                                callbackResponse.subscription = getLastSplittedString(
                                    config.reqOpts.subscription
                                );
                            }
                        } else if (config.method === 'deleteTopic') {
                            if (config.reqOpts && config.reqOpts.topic) {
                                callbackResponse.topic = getLastSplittedString(
                                    config.reqOpts.topic
                                );
                            }
                        } else if (config.method === 'createTopic') {
                            callbackResponse.topic = arg2;
                        }
                    }
                    finalizeEvent(event, startTime, err, callbackResponse);
                    resolve();
                    if (callback) {
                        if (arg3) {
                            callback(err, arg2, ...arg3);
                        } else {
                            callback(err, arg2);
                        }
                    }
                };
            });
            tracer.addEvent(event, responsePromise);
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
        try {
            let pubsubProjectId;
            if (request && request.subscription) {
                const subscriptionSplited = request.subscription.split('/');
                if (subscriptionSplited.length > 1) {
                    [, pubsubProjectId] = subscriptionSplited;
                }
            }
            const { event, startTime } = initialEvent(
                GOOGLE_CLOUD_TYPES.pubsub.name, pubsubProjectId, 'Pull'
            );
            const patchedCallback = (err, res) => {
                const callbackResponse = {};
                if (res && res.receivedMessages) {
                    const messageIds = res.receivedMessages.reduce((acc, current) => {
                        acc.push(current.message.messageId);
                        return acc;
                    }, []);
                    callbackResponse.messageIds = messageIds;
                }
                finalizeEvent(event, startTime, err, callbackResponse);
            };
            let responsePromise;
            // in case callback has given from the client.
            if (callback) {
                responsePromise = original.apply(this, [request, options, patchedCallback]);
                tracer.addEvent(event, responsePromise);
            }
            responsePromise = original.apply(this, [request, options, callback]);
            tracer.addEvent(event, responsePromise);
            return responsePromise.then((res) => {
                const [response] = res;
                patchedCallback(null, response);
                return res;
            }, (err) => {
                patchedCallback(err, null);
                throw err;
            });
        } catch (err) {
            tracer.addException(err);
        }
        return original.apply(this, [request, options, callback]);
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

        shimmer.wrap(PubSub.prototype, 'request', () => wrapPubSubRequestFunction(PubSub.prototype.request));
        shimmer.wrap(PubSub.prototype, 'subscription', () => wrapPubSubRequestFunction(PubSub.prototype.subscription));
        shimmer.wrap(v1.SubscriberClient.prototype, 'pull', () => wrapPubSubPullFunction(v1.SubscriberClient.prototype.pull));
    },
};
