/**
 * @fileoverview Handlers for kafkajs instrumentation
 */

const uuid4 = require('uuid4');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');
const moduleUtils = require('./module_utils.js');
const { EPSAGON_HEADER } = require('../consts.js');


/**
 * acts as a middleware for `producer.send()`
 * @param {object} messages the messages param to send
 * @param {Kafka} producer producer object
 * @returns {Promise} The response promise
 */
function kafkaMiddleware(messages, producer) {
    let result;
    let originalHandlerAsyncError;
    const epsagonId = uuid4();
    let kafkaEvent;
    let startTime;
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

    const response = producer.originalSend(messages);
    if (kafkaEvent) {
        tracer.addEvent(kafkaEvent, response);
    }

    response.then((res) => {
        result = res;
    }).catch((err) => {
        originalHandlerAsyncError = err;
        throw err;
    }).finally(() => {
        try {
            if (!kafkaEvent) {
                utils.debugLog('Could not initialize kafkajs, so skipping response.');
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
            kafkaWrapper,
            kafka => kafka.Kafka.prototype
        );
    },
};
