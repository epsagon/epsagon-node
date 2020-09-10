/**
 * @fileoverview Handlers for kafka-node instrumentation
 */

const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');
const moduleUtils = require('./module_utils.js');
const { EPSAGON_HEADER } = require('../consts.js');
const { generateEpsagonTraceId } = require('../helpers/http');


/**
 * Wrap kafka-node producer send function
 * @param {Function} sendFunction kafka producer send function.
 * @returns {Promise} sendFunction response.
 */
function wrapKafkaSendFunction(sendFunction) {
    return function internalKafkaSendFunction(messages, callback) {
        let kafkaSendEvent;
        let kafkaSendStartTime;
        let kafkaSendResponse;
        let originalHandlerAsyncError;
        let patchedCallback;
        const producer = this;
        const epsagonId = generateEpsagonTraceId();

        // Each send operation can contain multiple messages to different topics. At the moment
        // we support just one.
        const payload = messages[0];

        try {
            const { slsEvent, startTime } = eventInterface.initializeEvent(
                'kafka',
                payload.topic,
                'produce',
                'kafka-node'
            );
            kafkaSendEvent = slsEvent;
            kafkaSendStartTime = startTime;
            // eslint-disable-next-line no-param-reassign
            messages = messages.map((message) => {
                // kafka-node doesn't support headers,
                // so we're checking if Epsagon found in a JSON value
                try {
                    if (typeof message.messages === 'string') {
                        const jsonData = JSON.parse(message.messages);
                        jsonData[EPSAGON_HEADER] = epsagonId;
                        // eslint-disable-next-line no-param-reassign
                        message.messages = JSON.stringify(jsonData);
                    } else {
                        const jsonData = JSON.parse(message.messages[0]);
                        jsonData[EPSAGON_HEADER] = epsagonId;
                        // eslint-disable-next-line no-param-reassign
                        message.messages[0] = JSON.stringify(jsonData);
                    }
                } catch (err) {
                    utils.debugLog('kafka-node - Could not extract epsagon header');
                }
                return message;
            });
        } catch (err) {
            tracer.addException(err);
        }

        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, data) => {
                let callbackResult;
                try {
                    if (!kafkaSendEvent) {
                        utils.debugLog('Could not initialize kafka-node, skipping response.');
                        return callbackResult;
                    }
                    eventInterface.finalizeEvent(
                        kafkaSendEvent,
                        kafkaSendStartTime,
                        originalHandlerAsyncError,
                        {
                            [EPSAGON_HEADER]: epsagonId,
                            host: producer.client.options.kafkaHost,
                        },
                        {
                            messages: payload.messages,
                        }
                    );
                } catch (callbackErr) {
                    tracer.addException(callbackErr);
                } finally {
                    if (callback && typeof callback === 'function') {
                        callbackResult = callback(err, data);
                    }
                }
                resolve();
                return callbackResult;
            };
        });

        try {
            kafkaSendResponse = sendFunction.apply(this, [messages, patchedCallback]);
        } catch (err) {
            if (kafkaSendEvent) {
                eventInterface.setException(kafkaSendEvent, err);
                tracer.addEvent(kafkaSendEvent);
            }
            throw err;
        }

        if (kafkaSendEvent) {
            tracer.addEvent(kafkaSendEvent, responsePromise);
        }
        return kafkaSendResponse;
    };
}

module.exports = {
    /**
     * Initializes the kafka-node tracer
     */
    init() {
        moduleUtils.patchModule(
            'kafka-node',
            'send',
            wrapKafkaSendFunction,
            kafka => kafka.Producer.prototype
        );
    },
};
