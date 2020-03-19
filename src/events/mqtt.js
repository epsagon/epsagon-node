const shimmer = require('shimmer');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

/**
 *  Build pub sub parameters.
 * @param {Object} options options object (optional).
 * @param {Function} callback callback function (optional).
 * @returns {Object} Wrapped object.
 */
function getPubSubParams(options, callback) {
    let internalCallback = callback;
    let internalOptions = options;
    if (typeof internalOptions === 'function') {
        internalCallback = options;
        internalOptions = undefined;
    }

    return { internalCallback, internalOptions };
}

/**
 * Check if the host is part of amazon iot
 * @param {String} host the host of the connection.
 * @returns {Boolean} true or false.
 */
function checkIfHostIsIot(host) {
    return host.includes('iot') && host.includes('amazonaws.com');
}

/**
 * Wraps the publish command function with tracing
 * @param {Function} originalPublishFunc The wrapped function
 * from mqtt module
 * @returns {Function} The wrapped function
 */
function publishWrapper(originalPublishFunc) {
    return function internalPublishWrapper(topic, message, options, callback) {
        const { internalCallback, internalOptions } = getPubSubParams(options, callback);
        let patchedCallback = internalCallback;
        try {
            const resourceType = checkIfHostIsIot(this.options.host) ? 'iot' : 'mqtt';
            const { slsEvent: mqttEvent, startTime } = eventInterface.initializeEvent(resourceType,
                topic,
                'publish',
                'mqtt');
            const responseMetadata = {
                region: this.options.region,
                protocol: this.options.protocol,
                host: this.options.host,
            };
            const payload = {
                clientId: this.options.clientId,
                protocolId: this.options.protocolId,
                protocolVersion: this.options.protocolVersion,
                message,
            };
            const promise = new Promise((resolve) => {
                patchedCallback = (err, ...rest) => {
                    eventInterface.finalizeEvent(
                        mqttEvent,
                        startTime,
                        err || null,
                        responseMetadata,
                        payload
                    );
                    if (internalCallback) {
                        internalCallback(err, ...rest);
                    }
                    resolve();
                };
            });
            tracer.addEvent(mqttEvent, promise);
        } catch (err) {
            tracer.addException(err);
        }

        return originalPublishFunc.apply(this, [topic, message, internalOptions, patchedCallback]);
    };
}

/**
 * Wraps the subscribe command function with tracing
 * @param {Function} originalSubscribeFunc The wrapped function
 * from mqtt module
 * @returns {Function} The wrapped function
 */
function subscribeWrapper(originalSubscribeFunc) {
    return function internalSubscribeWrapper(topic, options, callback) {
        const { internalCallback, internalOptions } = getPubSubParams(options, callback);
        let patchedCallback = internalCallback;
        try {
            const resourceType = checkIfHostIsIot(this.options.host) ? 'iot' : 'mqtt';
            const { slsEvent: mqttEvent, startTime } = eventInterface.initializeEvent(resourceType,
                topic,
                'subscribe',
                'mqtt');
            const responseMetadata = {
                region: this.options.region,
                protocol: this.options.protocol,
                host: this.options.host,
            };
            const payload = {
                clientId: this.options.clientId,
                protocolId: this.options.protocolId,
                protocolVersion: this.options.protocolVersion,
            };
            const promise = new Promise((resolve) => {
                patchedCallback = (err, ...rest) => {
                    eventInterface.finalizeEvent(
                        mqttEvent,
                        startTime,
                        err || null,
                        responseMetadata,
                        payload
                    );
                    if (internalCallback) {
                        internalCallback(err, ...rest);
                    }
                    resolve();
                };
            });
            tracer.addEvent(mqttEvent, promise);
        } catch (err) {
            tracer.addException(err);
        }

        return originalSubscribeFunc.apply(this, [topic, internalOptions, patchedCallback]);
    };
}

/**
 * Wraps the on command function with tracing
 * @param {Function} originalOnFunc The wrapped function
 * from mqtt module
 * @returns {Function} The wrapped function
 */
function onWrapper(originalOnFunc) {
    return function internalOnWrapper(eventName, callback) {
        let patchedCallback = callback;
        try {
            const resourceType = checkIfHostIsIot(this.options.host) ? 'iot' : 'mqtt';
            if (eventName === 'message') {
                const responseMetadata = {
                    region: this.options.region,
                    protocol: this.options.protocol,
                    host: this.options.host,
                };
                const payload = {
                    clientId: this.options.clientId,
                    protocolId: this.options.protocolId,
                    protocolVersion: this.options.protocolVersion,
                };
                patchedCallback = (topic, message, ...rest) => {
                    const { slsEvent: mqttEvent, startTime } = eventInterface.initializeEvent(resourceType, topic, 'onMessage', 'mqtt');
                    payload.message = message ? message.toString() : message;
                    eventInterface.finalizeEvent(
                        mqttEvent,
                        startTime,
                        null,
                        responseMetadata,
                        payload
                    );
                    if (callback) {
                        callback(topic, message, ...rest);
                    }
                    tracer.addEvent(mqttEvent);
                };
            }
        } catch (err) {
            tracer.addException(err);
        }

        return originalOnFunc.apply(this, [eventName, patchedCallback]);
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
        const mqttClient = originalConstructorFunc.apply(this, [streamBuilder, options]);
        try {
            shimmer.wrap(
                mqttClient,
                'publish',
                func => publishWrapper(func)
            );
            shimmer.wrap(
                mqttClient,
                'subscribe',
                func => subscribeWrapper(func)
            );
            shimmer.wrap(
                mqttClient,
                'on',
                func => onWrapper(func)
            );
        } catch (error) {
            tracer.addException(error);
        }
        return mqttClient;
    };
}

module.exports = {
    /**
   * Initializes the MQTT tracer.
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
