/**
 * @fileoverview Handlers for kafkajs instrumentation
 */

const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');
const { EPSAGON_HEADER } = require('../consts.js');
const { generateEpsagonTraceId } = require('../helpers/http.js');


/**
 * acts as a middleware for `producer.send()`
 * @param {object} messages the messages param to send
 * @param {Kafka} producer producer object
 * @returns {Promise} The response promise
 */
function kafkaMiddleware(messages, producer) {
    let response = Promise.resolve();
    try {
        const { slsEvent: kafkaEvent, startTime } = eventInterface.initializeEvent(
            'kafka',
            messages.topic,
            'send',
            'kafkajs'
        );

        const epsagonId = generateEpsagonTraceId();
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

        response = producer.originalSend(messages);

        const sendPromise = new Promise((resolve) => {
            let result;
            let originalHandlerAsyncError;
            response.then((res) => {
                result = res;
            }).catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface.finalizeEvent(
                    kafkaEvent,
                    startTime,
                    originalHandlerAsyncError,
                    {
                        messages_count: messages.messages.length,
                        epsagon_id: epsagonId,
                    },
                    {
                        messages,
                        response: result,
                    }
                );
            });
            resolve();
        });
        tracer.addEvent(kafkaEvent, sendPromise);
    } catch (err) {
        tracer.addException(err);
    }
    return response;
}


/**
 * Wraps the kafkajs producer creation
 * @param {Function} wrappedFunction The kafkajs producer function
 * @returns {Function} The wrapped function
 */
function kafkaWrapper(wrappedFunction) {
    return function internalKafkaWrapper(options) {
        const producer = wrappedFunction.apply(this, [options]);
        const patchedSend = messages => kafkaMiddleware(messages, producer);
        producer.originalSend = producer.send;
        producer.send = patchedSend;
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
            kafkaWrapper,
            kafka => kafka.Kafka.prototype
        );
    },
};
