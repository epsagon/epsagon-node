/**
 * @fileoverview Handlers for kafkajs instrumentation
 */

const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');
const moduleUtils = require('./module_utils.js');
const { EPSAGON_HEADER } = require('../consts.js');
const { generateEpsagonTraceId } = require('../helpers/http');


/**
 * acts as a middleware for `producer.send()`
 * @param {object} messages the messages param to send
 * @param {Kafka} producer producer object
 * @returns {Promise} The response promise
 */
function kafkaSendMiddleware(messages, producer) {
    let result;
    let originalHandlerAsyncError;
    const epsagonId = generateEpsagonTraceId();
    let kafkaEvent;
    let startTime;
    let response;
    try {
        const { slsEvent, startTime: eventStartTime } = eventInterface.initializeEvent(
            'kafka',
            messages.topic,
            'produce',
            'kafkajs'
        );
        kafkaEvent = slsEvent;
        startTime = eventStartTime;

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
        response = producer.originalSend(messages);
    } catch (err) {
        if (kafkaEvent) {
            eventInterface.setException(kafkaEvent, err);
            tracer.addEvent(kafkaEvent);
        }
        throw err;
    }

    response = response.then((res) => {
        result = res;
        return res;
    }).catch((err) => {
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

    if (kafkaEvent) {
        tracer.addEvent(kafkaEvent, response);
    }

    return response;
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
 * Wraps the kafkajs producer creation
 * @param {Function} wrappedFunction The kafkajs producer function
 * @returns {Function} The wrapped function
 */
function kafkaProducerWrapper(wrappedFunction) {
    return function internalKafkaProducerWrapper(options) {
        // patching send request.
        const producer = wrappedFunction.apply(this, [options]);
        const patchedSend = messages => kafkaSendMiddleware(messages, producer);
        producer.originalSend = producer.send;
        producer.send = patchedSend.bind(producer);
        return producer;
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
            kafka => kafka.Kafka.prototype
        );
        moduleUtils.patchModule(
            'kafkajs/src/cluster/index.js',
            'connect',
            kafkaConnectWrapper,
            cluster => cluster.prototype
        );
    },
};
