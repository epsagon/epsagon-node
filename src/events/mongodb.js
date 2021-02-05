const uuid4 = require('uuid4');
const moduleUtils = require('./module_utils.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');
const serverlessEvent = require('../proto/event_pb.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');


/**
  * Gets command's metadata
  * @param {*} cmd original command that passed to mongodb function
  * @returns {Object} json with command's metadata
  */
function getCommandMetadata(cmd) {
    const result = {};
    if (!cmd || (typeof cmd !== 'object' && !Array.isArray(cmd))) return result;
    let filter = '';
    let query = '';
    if (typeof cmd === 'object') {
        filter = JSON.stringify(cmd.filter);
        query = JSON.stringify(cmd.query);
    }
    if (filter) {
        result.filter = filter;
    }
    if (query) {
        result.query = query;
    }
    if (Object.keys(result).length === 0) {
        result.criteria = JSON.stringify(cmd);
    }

    return result;
}

/**
 * Gets the post and the host of the mongodb server
 * @param {Objecy} server original server arg that provided to function
 * @returns {Object} json with host and port
 */
function getHostAndPort(server) {
    let port = '27017';
    let host = 'mongodb';
    if (server && server.s && server.s.options) {
        const { options } = server.s;
        port = options.port ? options.port : port;
        host = options.host ? options.host : host;
    }

    return { port, host };
}

/**
 * Gets the number of documents that mongodb operation affected
 * @param {String} operationName mongodb operation name
 * @param {Object} response response of the mongodb operation
 * @returns {Number} the number of documents that mongodb operation affected
 */
function getItemsCount(operationName, response) {
    let itemsCount;
    switch (operationName) {
    case 'find':
        itemsCount = response.result.cursor.firstBatch.length;
        break;
    case 'insert':
    case 'update':
    case 'delete':
        itemsCount = response.result.n;
        break;
    case 'getMore':
        itemsCount = response.cursor.nextBatch.length;
        break;
    default:
        break;
    }

    return itemsCount;
}

/**
 * Extracts the relevant arguments from provided arguments
 * @returns {Object} Object of the extracted arguments
 */
function getArgsFromFunction(...args) {
    return {
        server: args[0],
        namespace: args[1],
        cmd: args[args.length - 2] === 'getMore' ? {} : args[2],
        callback: args[args.length - 3],
        operationName: args[args.length - 2],
        wrappedFunction: args[args.length - 1],
    };
}

/**
 * Wrap Mongodb operations call with tracing
 * @returns {Array} Execiton of the called function
 */
function internalMongodbOperationWrapper(...args) {
    const relevantArgs = getArgsFromFunction(...args);
    const {
        server, namespace, cmd, callback, operationName, wrappedFunction,
    } = relevantArgs;
    let patchedCallback = callback;
    try {
        const startTime = Date.now();
        const criteria = getCommandMetadata(cmd);
        const { host, port } = getHostAndPort(server);
        const resource = new serverlessEvent.Resource([
            host,
            'mongodb',
            operationName,
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

        eventInterface.addToMetadata(dbapiEvent, {
            namespace,
        }, {
            ...criteria,
            port,
        });

        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, response) => {
                utils.debugLog('MongoDb Patched callback was called.');
                dbapiEvent.setDuration(utils.createDurationTimestamp(startTime));

                if (err) {
                    eventInterface.setException(dbapiEvent, err);
                } else {
                    eventInterface.addToMetadata(dbapiEvent,
                        { items_count: getItemsCount(operationName, response) });
                }

                resolve();

                if (callback) {
                    callback(err, response);
                }
            };
        });

        tracer.addEvent(dbapiEvent, responsePromise);
    } catch (error) {
        tracer.addException(error);
    }

    arguments[args.length - 3] = patchedCallback; // eslint-disable-line prefer-rest-params
    return wrappedFunction.apply(this, arguments); // eslint-disable-line prefer-rest-params
}

/**
 * Wraps insert function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbInsertWrapper(wrappedFunction) {
    return function internalMongodbInsertWrapper(...args) {
        return internalMongodbOperationWrapper(...args, 'insert', wrappedFunction);
    };
}

/**
 * Wraps update function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbUpdateWrapper(wrappedFunction) {
    return function internalMongodbUpdateWrapper(...args) {
        return internalMongodbOperationWrapper(...args, 'update', wrappedFunction);
    };
}

/**
 * Wraps remove function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbRemoveWrapper(wrappedFunction) {
    return function internalMongodbRemoveWrapper(...args) {
        return internalMongodbOperationWrapper(...args, 'delete', wrappedFunction);
    };
}

/**
 * Wraps getMore function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbGetMoreWrapper(wrappedFunction) {
    return function internalMongodbGetMoreWrapper(...args) {
        return internalMongodbOperationWrapper(...args, 'getMore', wrappedFunction);
    };
}

/**
 * Wraps query/find function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbQueryWrapper(wrappedFunction) {
    return function internalMongodbQueryWrapper(...args) {
        return internalMongodbOperationWrapper(...args, 'find', wrappedFunction);
    };
}

/**
 * Wraps command (count for example) function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbCommandWrapper(wrappedFunction) {
    return function internalMongodbCommandWrapper(...args) {
        const cmd = args[2];
        if (cmd && cmd.ismaster) {
            return wrappedFunction.apply(this, args);
        }
        return internalMongodbOperationWrapper(...args, cmd && typeof cmd === 'object' ? Object.keys(cmd)[0] : '', wrappedFunction);
    };
}

module.exports = {
    /**
     * Initializes the mongodb tracer
     */
    init() {
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'insert',
            mongodbInsertWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'update',
            mongodbUpdateWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'remove',
            mongodbRemoveWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'query',
            mongodbQueryWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'getMore',
            mongodbGetMoreWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'command',
            mongodbCommandWrapper,
            mongodb => mongodb
        );
    },
};
