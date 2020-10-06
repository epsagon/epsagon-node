const uuid4 = require('uuid4');
const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');

const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

const requestsResolvers = {};
const MAX_DATA_LENGTH = 4096;

/**
 * Stringify given obejct (and shorten if needed)
 * @param {Object} obj The data to stringify
 * @returns {string} The stringified data
 * @note A better shortening approach should be added as a general feature
 */
function stringifyData(obj) {
    if (!obj) {
        return undefined;
    }
    const data = (typeof obj === 'string') ? obj : JSON.stringify(obj);
    return data.substring(0, MAX_DATA_LENGTH);
}

/**
 * Extract MongoDB metadata from response.
 * @param {Object} event MongoDB event.
 * @return {Object} response metadata.
 */
const getMongodbMetadata = (event) => {
    const { commandName, reply } = event;
    let metaData = {};
    switch (commandName) {
    case 'find':
        if (reply.cursor && Array.isArray(reply.cursor.firstBatch)) {
            metaData = { items_count: reply.cursor.firstBatch.length };
        }
        break;
    case 'getMore':
        if (reply.cursor && Array.isArray(reply.cursor.nextBatch)) {
            metaData = { items_count: reply.cursor.nextBatch.length };
        }
        break;
    case 'count':
        if (reply.ok) {
            metaData = { items_count: reply.n };
        }
        break;
    default:
        break;
    }

    return metaData;
};

/**
 * Extracts connection details from a conenction
 * @param {Object} connId The connectionId object of the instrumented event
 * @return {{port: *, host: *}} extracted connection details
 */
function getConnectionDetails(connId) {
    let host;
    let port;
    utils.debugLog('Epsagon - MongoDB - inspecting connectionId', connId);
    if (connId) {
        if (typeof connId === 'string') {
            const parts = connId.split(':');
            if (parts.length && parts[0][0] === '/') {
                host = 'localhost';
                [port] = parts;
            } else {
                [host, port] = parts;
            }
        } else if (connId.domainSocket) {
            [host, port] = ['localhost', connId.host]; // host for domainSocket is the identifier
        } else {
            // eslint-disable-next-line prefer-destructuring
            host = connId.host;
            // eslint-disable-next-line prefer-destructuring
            port = connId.port;
        }
    }
    return { host, port };
}

/**
 * Hook for mongodb requests starting
 * @param {Object} event The request event
 */
function onStartHook(event) {
    try {
        const startTime = Date.now();
        utils.debugLog('Epsagon - MongoDB - handling event', event);

        const { host, port } = getConnectionDetails(event ? event.connectionId : null);

        const resource = new serverlessEvent.Resource([
            host || 'mongodb',
            'mongodb',
            event.commandName,
        ]);
        const dbapiEvent = new serverlessEvent.Event([
            `mongodb-${uuid4()}`,
            utils.createTimestampFromTime(startTime),
            null,
            'mongodb',
            0,
            errorCode.ErrorCode.OK,
        ]);
        dbapiEvent.setResource(resource);

        let collection = event.command.collection || event.command[event.commandName];
        if (typeof collection !== 'string') {
            collection = '';
        }
        eventInterface.addToMetadata(dbapiEvent, {
            namespace: `${event.databaseName}.${collection}`,
        }, {
            filter: stringifyData(event.command.filter),
            query: stringifyData(event.command.query),
        });
        if (port) {
            eventInterface.addToMetadata(dbapiEvent, { port });
        }

        const responsePromise = new Promise((resolve) => {
            requestsResolvers[event.requestId] = { resolve, dbapiEvent };
        });

        tracer.addEvent(dbapiEvent, responsePromise);
    } catch (error) {
        tracer.addException(error);
    }
}

/**
 * Handle a mongodb response
 * @param {Object} event The response  event
 * @param {boolean} hasError True if the request failed
 */
function handleEventResponse(event, hasError) {
    try {
        const { resolve, dbapiEvent } = requestsResolvers[event.requestId];
        eventInterface.addToMetadata(dbapiEvent, getMongodbMetadata(event));
        dbapiEvent.setDuration(utils.createTimestampFromTime(event.duration));
        if (hasError) {
            eventInterface.setException(
                dbapiEvent,
                {
                    name: 'Mongodb Error',
                    message: '',
                    stack: [],
                }
            );
        }

        delete requestsResolvers[event.requestId];
        resolve();
    } catch (error) {
        tracer.addException(error);
    }
}

/**
 * Hook for mongodb requests ending successfully
 * @param {Object} event The response event
 */
function onSuccessHook(event) {
    handleEventResponse(event);
}

/**
 * Hook for mongodb requests ending with failure
 * @param {Object} event The response event
 */
function onFailureHook(event) {
    handleEventResponse(event, true);
}

module.exports = {
    /**
     * Initializes mongodb instrumentation
     */
    init() {
        utils.debugLog('Epsagon mongodb - starting');
        const modules = moduleUtils.getModules('mongodb');
        utils.debugLog('Epsagon mongodb - found', modules.length, 'modules');
        modules.forEach((mongodb) => {
            const listener = mongodb.instrument({}, (error) => {
                if (error) { utils.debugLog('Epsagon mongodb instrumentation failed', error); }
            });
            listener.on('started', onStartHook);
            listener.on('succeeded', onSuccessHook);
            listener.on('failed', onFailureHook);
        });
        utils.debugLog('Epsagon mongodb - done');
    },
};
