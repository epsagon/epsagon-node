const shimmer = require('shimmer');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wraps the publish' command function with tracing
 * @param {Function} originalPublishFunc The wrapped function
 * from mqtt module
 * @returns {Function} The wrapped function
 */
function publishWrapper(originalPublishFunc) {
    return function internalPublishWrapper(topic, message, options, callback) {
        let patchedCallback = callback;

        try {
            const { slsEvent: mqttEvent, startTime } = eventInterface.initializeEvent('MQTT',
                this.options.host,
                'publish',
                'mqtt');
            const responseMetadata = {
                region: this.options.region,
                protocol: this.options.protocol,
                topic,
            };
            const payload = {
                clientId: this.options.clientId,
                protocolId: this.options.protocolId,
                protocolVersion: this.options.protocolVersion,
                message,
            };
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
                    if (callback) {
                        callback();
                    }
                };
            });
            tracer.addEvent(mqttEvent, promise);
        } catch (err) {
            tracer.addException(err);
        }

        return originalPublishFunc.apply(this, [topic, message, options, patchedCallback]);
    };
}


/**
 * Wraps the constructor' command function
 * @param {Function} originalConstructorFunc The wrapped function
 * from mqtt module
 * @returns {Function} The wrapped function
 */
function mqttClientWrapper(originalConstructorFunc) {
    return function internalMqttClientWrapper(streamBuilder, options) {
        try {
            const mqttClient = originalConstructorFunc.apply(this, [streamBuilder, options]);
            shimmer.wrap(
                mqttClient,
                'publish',
                func => publishWrapper(func)
            );
            return mqttClient;
        } catch (error) {
            tracer.addException(error);
        }
        return originalConstructorFunc.apply(this, [options]);
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
            mqttModule => mqttModule
        );
    },
};
