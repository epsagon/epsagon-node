/**
 * @fileoverview Handlers for amqp instrumentation
 */

const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');
const { EPSAGON_HEADER } = require('../consts.js');
const { generateEpsagonTraceId } = require('../helpers/http');


/**
 * Wraps the amqp producer creation and wrapping send function.
 * @param {Function} sendFunction The amqp producer function
 * @returns {Function} The wrapped function
 */
function amqpProducerWrapper(sendFunction) {
    return function internalamqpProducerWrapper(routingKey, data, options, callback) {
        let sendResponse;
        let sendEvent;
        let eventStartTime;
        const epsagonId = generateEpsagonTraceId();
        try {
            const { slsEvent, startTime } = eventInterface.initializeEvent(
                'rabbitmq',
                routingKey,
                'SendMessage',
                'amqplib'
            );
            sendEvent = slsEvent;
            eventStartTime = startTime;
            if (!options || !options.headers) {
                // eslint-disable-next-line no-param-reassign
                options.headers = {};
            }
            // eslint-disable-next-line no-param-reassign
            options.headers[EPSAGON_HEADER] = epsagonId;
        } catch (err) {
            tracer.addException(err);
        }
        try {
            sendResponse = sendFunction.apply(this, [routingKey, data, options, callback]);
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
                exchange: this.name,
                host: this.connection.options.host,
                vhost: this.connection.options.vhost,
                [EPSAGON_HEADER]: epsagonId,
                'messaging.message_payload_size_bytes': data.toString().length,
            },
            {
                headers: options.headers,
                message: JSON.stringify(data),
            }
        );
        tracer.addEvent(sendEvent);
        return sendResponse;
    };
}

module.exports = {
    /**
     * Initializes the amqp tracer
     */
    init() {
        moduleUtils.patchModule(
            'amqp/lib/exchange.js',
            'publish',
            amqpProducerWrapper,
            amqp => amqp.prototype
        );
    },
};
