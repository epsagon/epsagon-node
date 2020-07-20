/**
 * @fileoverview Handlers for amqplib instrumentation
 */

const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');
const { EPSAGON_HEADER } = require('../consts.js');
const { generateEpsagonTraceId } = require('../helpers/http');


/**
 * Wraps the amqplib producer creation and wrapping send function.
 * @param {Function} sendFunction The amqplib producer function
 * @returns {Function} The wrapped function
 */
function amqplibProducerWrapper(sendFunction) {
    return function internalamqplibProducerWrapper(fields, properties, content) {
        let sendResponse;
        let sendEvent;
        let eventStartTime;
        const epsagonId = generateEpsagonTraceId();
        try {
            const { slsEvent, startTime } = eventInterface.initializeEvent(
                'rabbitmq',
                fields.routingKey,
                'SendMessage',
                'amqplib'
            );
            sendEvent = slsEvent;
            eventStartTime = startTime;
            // eslint-disable-next-line no-param-reassign
            fields.headers[EPSAGON_HEADER] = epsagonId;
        } catch (err) {
            tracer.addException(err);
        }
        try {
            sendResponse = sendFunction.apply(this, [fields, properties, content]);
        } catch (err) {
            if (sendEvent) {
                eventInterface.setException(sendEvent, err);
                tracer.addEvent(sendEvent);
            }
            throw err;
        }

        eventInterface.finalizeEvent(
            sendEvent,
            eventStartTime,
            undefined,
            {
                exchange: fields.exchange,
                host: this.connection.stream._host, // eslint-disable-line no-underscore-dangle
                [EPSAGON_HEADER]: epsagonId,
                'messaging.message_payload_size_bytes': content.toString().length,
            },
            {
                headers: fields.headers,
                message: content.toString(),
            }
        );
        tracer.addEvent(sendEvent);
        return sendResponse;
    };
}

module.exports = {
    /**
     * Initializes the amqplib tracer
     */
    init() {
        moduleUtils.patchModule(
            'amqplib/lib/channel.js',
            'sendMessage',
            amqplibProducerWrapper,
            amqplib => amqplib.Channel.prototype
        );
    },
};
