const shimmer = require('shimmer');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');


const getPublishParams = (topic, message, options, callback) => {
    const topic_internal = topic;
    const message_internal = message;
    const options_internal = options;
    const callback_internal = callback;

    return {
        topic_internal,
        message_internal,
        options_internal,
        callback_internal
    };
};

function publishWrapper(wrappedFunction) {
    return function internalPublishWrapper(topic, message, options, callback) {
        const {
                topic_internal,
                message_internal,
                options_internal,
                callback_internal
            } = getPublishParams(topic, message, options, callback);
        let patchedCallback = callback_internal;   

        try {
                const { slsEvent: mqttEvent, startTime } = eventInterface.initializeEvent('MQTT',
                                                                                          this.options.host,
                                                                                          'publish', 
                                                                                          'mqtt');
                const responseMetadata = {
                    region: this.options.region,
                    protocol: this.options.protocol,
                    topic
                }
                const payload = {
                    clientId: this.options.clientId,
                    protocolId: this.options.protocolId,
                    protocolVersion: this.options.protocolVersion,
                    message
                }
                const promise = new Promise((resolve) => {
                    patchedCallback = () => {
                        eventInterface.finalizeEvent(
                            mqttEvent,
                            startTime,
                            null,
                            responseMetadata,
                            payload
                        );
                        resolve();
                        if (callback_internal) {
                            callback_internal();
                        }
                    };
                });
                tracer.addEvent(mqttEvent, promise);
        } catch (err) {
            tracer.addException(err);
        }
        
        return wrappedFunction.apply(this, [topic_internal, message_internal, options_internal, patchedCallback]);
    }
}


/**
 * Wraps the publish' command function with tracing
 * @param {Function} wrappedFunction The wrapped function 
 * from aws-iot-device-sdk module
 * @returns {Function} The wrapped function
 */
function mqttClientWrapper(wrappedFunction) {
    return function internalMqttClientWrapper(streamBuilder, options) {
        try {
            const mqttClient = wrappedFunction.apply(this, [streamBuilder, options]);
            shimmer.wrap(
                mqttClient,
                'publish',
                (wrappedFunction) => publishWrapper(wrappedFunction)
            );
            return mqttClient
        } catch (error) {
            tracer.addException(error);
        }
        return wrappedFunction.apply(this, [options]);
    };
}

module.exports = {
    /**
   * Initializes the AWS IOT tracer.
   */
    init() {
        moduleUtils.patchModule(
            'mqtt',
            'MqttClient',
            mqttClientWrapper,
            mqttModule => {
                return mqttModule
            }
        );
    },
};