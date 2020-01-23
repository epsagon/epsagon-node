/* eslint-disable camelcase */
/**
 * @fileoverview Instrumentation for nats library.
 */
const shimmer = require('shimmer');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

const NATS_TYPES = {
    name: 'nats',
    mainWrappedFunction: 'Client',
    badMessage: 'NATS_BAD_JSON_MSG',
};

const getServerHostname = (currentServer) => {
    let serverHostname = NATS_TYPES.serverDefaultHostname;
    if (currentServer.url && currentServer.url.hostname) {
        serverHostname = currentServer.url.hostname;
    }
    return serverHostname;
};

const getPublishParams = (subject, msg, opt_reply, opt_callback, jsonConnectProperty) => {
    let subject_internal = subject;
    let msg_internal = msg;
    let opt_reply_internal = opt_reply;
    let opt_callback_internal = opt_callback;
    let msgJsonStringify;
    if (typeof subject_internal === 'function') {
        opt_callback_internal = subject_internal;
        subject_internal = undefined;
    }
    if (!jsonConnectProperty) {
        msg_internal = msg_internal || '';
    } else {
        // undefined is not a valid JSON-serializable value, but null is
        msg_internal = msg_internal === undefined ? null : msg_internal;
    }
    if (typeof msg_internal === 'function') {
        opt_callback_internal = msg;
        msg_internal = '';
        opt_reply_internal = undefined;
    }
    if (typeof opt_reply_internal === 'function') {
        opt_callback_internal = opt_reply;
        opt_reply_internal = undefined;
    }
    if (!Buffer.isBuffer(msg_internal)) {
        if (jsonConnectProperty) {
            try {
                msgJsonStringify = JSON.stringify(msg_internal);
            } catch (e) {
                msgJsonStringify = NATS_TYPES.badMessage;
            }
        }
    }
    return {
        subject_internal, msg_internal, msgJsonStringify, opt_reply_internal, opt_callback_internal,
    };
};

/**
 * Wrap nats publish function.
 * @param {Function} original nats publish function.
 * @param {string} serverHostname nats server host name.
 * @param {Boolean} jsonConnectProperty json connect property.
 * @returns {Function} The wrapped function
 */
function wrapNatsPublishFunction(original, serverHostname, jsonConnectProperty) {
    return function internalNatsPublishFunction(subject, msg, opt_reply, opt_callback) {
        const {
            subject_internal,
            msg_internal,
            msgJsonStringify,
            opt_reply_internal,
            opt_callback_internal,
        } = getPublishParams(subject, msg, opt_reply, opt_callback, jsonConnectProperty);
        let clientRequest;
        try {
            // in case of publish call is a part of request call.
            if (opt_reply_internal) {
                return original.apply(this, [subject, msg, opt_reply, opt_callback]);
            }
            const { slsEvent: natsPublishEvent, startTime } = eventInterface.initializeEvent(
                NATS_TYPES.name,
                serverHostname,
                'publish',
                NATS_TYPES.name
            );
            const responseMetadata = {
                subject: subject_internal,
            };
            if (!jsonConnectProperty) {
                responseMetadata.msg = msg_internal;
            } else if (msgJsonStringify && msgJsonStringify !== NATS_TYPES.badMessage) {
                responseMetadata.msg = msgJsonStringify;
            }
            let patchedCallback = opt_callback_internal;

            if (opt_callback_internal) {
                const promise = new Promise((resolve) => {
                    patchedCallback = () => {
                        eventInterface.finalizeEvent(
                            natsPublishEvent,
                            startTime,
                            null,
                            responseMetadata
                        );
                        resolve();
                        opt_callback_internal();
                    };
                });
                tracer.addEvent(natsPublishEvent, promise);
            } else {
                tracer.addEvent(natsPublishEvent);
                eventInterface.finalizeEvent(
                    natsPublishEvent,
                    startTime,
                    null,
                    responseMetadata
                );
            }
            return original.apply(this,
                [subject_internal, msg_internal, opt_reply_internal, patchedCallback]);
        } catch (err) {
            tracer.addException(err);
            if (!clientRequest) {
                clientRequest = original.apply(this,
                    [subject, msg, opt_reply, opt_callback]);
            }
        }
        return clientRequest;
    };
}

/**
 * Wrap nats connect function.
 * @param {Function} connectFunction nats connect function.
 * @returns {Function} The wrapped function
 */
function wrapNatsConnectFunction(connectFunction) {
    return function internalNatsConnectFunction(url, opts) {
        const connectFunctionResponse = connectFunction(url, opts);
        if (connectFunctionResponse && connectFunctionResponse.constructor) {
            if (connectFunctionResponse.constructor.name !== NATS_TYPES.mainWrappedFunction) {
                return connectFunctionResponse;
            }
            const serverHostname = getServerHostname(connectFunctionResponse.currentServer);
            const jsonConnectProperty = connectFunctionResponse.options ?
                connectFunctionResponse.options.json : null;
            shimmer.wrap(connectFunctionResponse, 'publish', () => wrapNatsPublishFunction(connectFunctionResponse.publish, serverHostname, jsonConnectProperty));
        }
        return connectFunctionResponse;
    };
}

module.exports = {
    /**
     * Initializes the nats tracer.
     */
    init() {
        moduleUtils.patchModule(
            'nats',
            'connect',
            wrapNatsConnectFunction
        );
    },
    getServerHostname,
};
