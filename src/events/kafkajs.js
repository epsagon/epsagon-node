/**
 * @fileoverview Handlers for kafkajs instrumentation
 */

const shimmer = require('shimmer');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');
const moduleUtils = require('./module_utils.js');
const { EPSAGON_HEADER } = require('../consts.js');
const { generateEpsagonTraceId } = require('../helpers/http');

/**
 * Wrap kafka producer send function
 * @param {Function} sendFunction kafka producer send function.
 * @returns {Promise} sendFunction response.
 */
function wrapKafkaSendFunction(sendFunction) {
    return function internalKafkaSendFunction(messages) {
        let kafkaSendEvent;
        let kafkaSendStartTime;
        let kafkaSendResponse;
        let originalHandlerAsyncError;
        let result;
        const epsagonId = generateEpsagonTraceId();
        try {
            const { slsEvent, startTime } = eventInterface.initializeEvent(
                'kafka',
                messages.topic,
                'produce',
                'kafkajs'
            );
            kafkaSendEvent = slsEvent;
            kafkaSendStartTime = startTime;
            // eslint-disable-next-line no-param-reassign
            messages.messages = messages.messages.map((message) => {
                if (!message.headers) {
                    // eslint-disable-next-line no-param-reassign
                    message.headers = {};
                }
                // eslint-disable-next-line no-param-reassign
                message.headers[EPSAGON_HEADER] = epsagonId;
                return message;
            });
        } catch (err) {
            tracer.addException(err);
        }
        try {
            kafkaSendResponse = sendFunction.apply(this, [messages]);
        } catch (err) {
            if (kafkaSendEvent) {
                eventInterface.setException(kafkaSendEvent, err);
                tracer.addEvent(kafkaSendEvent);
            }
            throw err;
        }

        kafkaSendResponse = kafkaSendResponse.then((res) => {
            result = res;
            return res;
        }).catch((err) => {
            originalHandlerAsyncError = err;
            throw err;
        }).finally(() => {
            try {
                if (!kafkaSendEvent) {
                    utils.debugLog('Could not initialize kafkajs, skipping response.');
                    return;
                }
                eventInterface.finalizeEvent(
                    kafkaSendEvent,
                    kafkaSendStartTime,
                    originalHandlerAsyncError,
                    {
                        messages_count: messages.messages.length,
                        [EPSAGON_HEADER]: epsagonId,
                    },
                    {
                        messages,
                        response: result,
                    }
                );
            } catch (err) {
                tracer.addException(err);
            }
        });
        if (kafkaSendEvent) {
            tracer.addEvent(kafkaSendEvent, kafkaSendResponse);
        }
        return kafkaSendResponse;
    };
}

/**
 * Wrap kafka cluster connect function
 * @param {Function} originalConnectFunction connect function
 * @returns {Promise} The response promise
 */
function kafkaConnectWrapper(originalConnectFunction) {
    return function internalKafkaConnectWrapper(...args) {
        let originalHandlerAsyncError;
        let kafkaEvent;
        let startTime;
        let response;
        let port;
        try {
            const { host, port: brokerPort } = this.brokerPool.seedBroker.connection;
            port = brokerPort;
            const { slsEvent, startTime: eventStartTime } = eventInterface.initializeEvent(
                'kafka_server',
                host,
                'connect',
                'kafkajs'
            );
            kafkaEvent = slsEvent;
            startTime = eventStartTime;
        } catch (err) {
            tracer.addException(err);
        }
        try {
            response = originalConnectFunction.apply(this, args);
        } catch (err) {
            if (kafkaEvent) {
                kafkaEvent.setException(kafkaEvent, err);
                tracer.addEvent(kafkaEvent);
            }
            throw err;
        }
        response = response.catch((err) => {
            originalHandlerAsyncError = err;
            throw err;
        }).finally(() => {
            try {
                if (!kafkaEvent) {
                    utils.debugLog('Could not initialize kafkajs, skipping response.');
                    return;
                }
                eventInterface.finalizeEvent(
                    kafkaEvent,
                    startTime,
                    originalHandlerAsyncError,
                    { port }
                );
            } catch (err) {
                tracer.addException(err);
            }
        });

        if (kafkaEvent) {
            tracer.addEvent(kafkaEvent, response);
        }

        return response;
    };
}

/**
 * Wraps the kafkajs producer creation and wrapping send function.
 * @param {Function} producerFunction The kafkajs producer function
 * @returns {Function} The wrapped function
 */
function kafkaProducerWrapper(producerFunction) {
    return function internalKafkaProducerWrapper(options) {
        const producerResponse = producerFunction.apply(this, [options]);
        // eslint-disable-next-line no-underscore-dangle
        if (producerResponse && !producerResponse.__epsagonPatched) {
            try {
                // eslint-disable-next-line no-underscore-dangle
                producerResponse.__epsagonPatched = true;
                shimmer.wrap(producerResponse, 'send', () => wrapKafkaSendFunction(producerResponse.send));
            } catch (err) {
                tracer.addException(err);
            }
        }
        return producerResponse;
    };
}

module.exports = {
    /**
     * Initializes the kafkajs tracer
     */
    init() {
        moduleUtils.patchModule(
            'kafkajs',
            'producer',
            kafkaProducerWrapper,
            (kafka) => kafka.Kafka.prototype
        );
        moduleUtils.patchModule(
            'kafkajs/src/cluster/index.js',
            'connect',
            kafkaConnectWrapper,
            (cluster) => cluster.prototype
        );
    },
};
