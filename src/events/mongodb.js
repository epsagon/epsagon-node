const uuid4 = require('uuid4');
const moduleUtils = require('./module_utils.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');
const serverlessEvent = require('../proto/event_pb.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');
const consts = require('../consts.js');


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
 * @param {Object} server original server arg that provided to function
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
    case 'connectionfind':
        itemsCount = response.cursor.firstBatch.length;
        break;
    case 'insert':
    case 'update':
    case 'delete':
        itemsCount = response.result.n;
        break;
    case 'getMore':
    case 'connectiongetMore':
        itemsCount = response.cursor.nextBatch.length;
        break;
    case 'connectioninsert':
    case 'connectionupdate':
    case 'connectiondelete':
        itemsCount = response.n;
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
    const operationName = args[args.length - 2];
    const checkVersion = args[0].db;

    // Mongo >= 4
    if (checkVersion) {
        const ctx = args[args.length - 3];
        let options = {};
        if (ctx) {
            const hostParts = typeof ctx.address === 'string' ? ctx.address.split(':') : '';
            if (hostParts.length === 2) {
                options = { host: hostParts[0], port: hostParts[1] };
            }
        } else {
            utils.debugLog('ctx in not defined. args: ', args);
        }

        const topology = { s: { options } };

        return {
            server: topology,
            namespace: args[0].db.collection,
            cmd: args[args.length - 2] === 'getMore' ? {} : args[1],
            callback: args[args.length - 4],
            operationName,
            wrappedFunction: args[args.length - 1],
            callbackIndex: 3,
        };
    }
    // Mongo <= 4
    return {
        server: args[0],
        namespace: args[1],
        cmd: args[args.length - 2] === 'getMore' ? {} : args[2],
        callback: args[args.length - 4],
        operationName: args[args.length - 2],
        wrappedFunction: args[args.length - 1],
        callbackIndex: args.length - 4,
    };
}

/**
 * Adds response data by operation name
 * @param {String} operationName mongodb operation name
 * @param {Object} response response of the mongodb operation
 * @param {serverlessEvent.Event} dbapiEvent The event to add the items to
 */
function addDataByOperation(operationName, response, dbapiEvent) {
    switch (operationName) {
    case 'connectionfind':
        if (response.cursor.firstBatch.length > consts.MAX_QUERY_ELEMENTS) {
            // create copy so we can trim the long response body
            const trimmed = JSON.parse(JSON.stringify(response));
            trimmed.cursor.firstBatch =
                trimmed.cursor.firstBatch.slice(0, consts.MAX_QUERY_ELEMENTS);
            trimmed.cursor.firstBatch =
                trimmed.cursor.firstBatch.slice(0, consts.MAX_QUERY_ELEMENTS);
            eventInterface.addToMetadata(dbapiEvent,
                {
                    items_count: consts.MAX_QUERY_ELEMENTS,
                    is_trimmed: true,
                    response: trimmed,
                });
        }
        break;

    case 'find':
        if (response.result.cursor.firstBatch.length > consts.MAX_QUERY_ELEMENTS) {
            // create copy so we can trim the long response body
            const trimmed = JSON.parse(JSON.stringify(response));
            trimmed.result.cursor.firstBatch =
                    trimmed.result.cursor.firstBatch.slice(0, consts.MAX_QUERY_ELEMENTS);
            trimmed.cursor.firstBatch =
                    trimmed.cursor.firstBatch.slice(0, consts.MAX_QUERY_ELEMENTS);
            eventInterface.addToMetadata(dbapiEvent,
                {
                    items_count: consts.MAX_QUERY_ELEMENTS,
                    is_trimmed: true,
                    response: trimmed,
                });
        }
        break;
    case 'insert':
    case 'update':
    case 'delete':
    case 'connectioninsert':
    case 'connectionupdate':
    case 'connectiondelete':
    case 'connectiongetMore':
        eventInterface.addToMetadata(dbapiEvent,
            { items_count: getItemsCount(operationName, response), response });
        break;
    case 'getMore':
        // do not add the response in case of getMore. only meta data
        eventInterface.addToMetadata(dbapiEvent,
            { items_count: getItemsCount(operationName, response) });
        break;
    default:
        break;
    }
}


/**
 * Wrap Mongodb operations call with tracing
 * @returns {Array} Execiton of the called function
 */
function internalMongodbOperationWrapper(...args) {
    const relevantArgs = getArgsFromFunction(...args);
    const {
        server, namespace, cmd, callback, operationName, wrappedFunction, callbackIndex,
    } = relevantArgs;
    let patchedCallback = callback;
    try {
        const startTime = Date.now();
        const criteria = getCommandMetadata(cmd);
        const { host, port } = getHostAndPort(server);
        const resource = new serverlessEvent.Resource([
            host,
            'mongodb',
            operationName.replace('connection', '').toLowerCase(),
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
                    addDataByOperation(operationName, response, dbapiEvent);
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

    arguments[callbackIndex] = patchedCallback; // eslint-disable-line prefer-rest-params
    // eslint-disable-next-line max-len
    return wrappedFunction.apply(arguments[arguments.length - 3], arguments); // eslint-disable-line prefer-rest-params
}

/**
 * Wraps insert function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbInsertWrapper(wrappedFunction) {
    return function internalMongodbInsertWrapper(...args) {
        return internalMongodbOperationWrapper(...args, this, 'insert', wrappedFunction);
    };
}

/**
 * Wraps update function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbUpdateWrapper(wrappedFunction) {
    return function internalMongodbUpdateWrapper(...args) {
        return internalMongodbOperationWrapper(...args, this, 'update', wrappedFunction);
    };
}

/**
 * Wraps remove function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbRemoveWrapper(wrappedFunction) {
    return function internalMongodbRemoveWrapper(...args) {
        return internalMongodbOperationWrapper(...args, this, 'delete', wrappedFunction);
    };
}

/**
 * Wraps getMore function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbGetMoreWrapper(wrappedFunction) {
    return function internalMongodbGetMoreWrapper(...args) {
        return internalMongodbOperationWrapper(...args, this, 'getMore', wrappedFunction);
    };
}

/**
 * Wraps query/find function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbQueryWrapper(wrappedFunction) {
    return function internalMongodbQueryWrapper(...args) {
        return internalMongodbOperationWrapper(...args, this, 'find', wrappedFunction);
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
        return internalMongodbOperationWrapper(...args, this, cmd && typeof cmd === 'object' ? Object.keys(cmd)[0] : '', wrappedFunction);
    };
}

/**
 * Wraps Connection.command (count for example) function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbConnectionCommandWrapper(wrappedFunction) {
    return function internalMongodbConnectionCommandWrapper(...args) {
        const cmd = args[1];
        if (cmd && cmd.ismaster) {
            return wrappedFunction.apply(this, args);
        }
        return internalMongodbOperationWrapper(...args, this, cmd && typeof cmd === 'object' ? `connection${Object.keys(cmd)[0]}` : 'connectionCommand', wrappedFunction);
    };
}

/**
 * Wraps query/find function function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbConnectionQueryWrapper(wrappedFunction) {
    return function internalMongodbConnectionCommandWrapper(...args) {
        return internalMongodbOperationWrapper(...args, this, 'connectionFind', wrappedFunction);
    };
}

/**
 * Wraps Connection getMore function with tracing
 * @param {Function} wrappedFunction The function to wrap from mongodb
 * @returns {Function} The wrapped function
 */
function mongodbConnectionGetMoreWrapper(wrappedFunction) {
    return function internalMongodbConnectionCommandWrapper(...args) {
        return internalMongodbOperationWrapper(...args, this, 'connectiongetMore', wrappedFunction);
    };
}

module.exports = {
    /**
     * Initializes the mongodb tracer
     */
    init() {
        // MongoDB <= 4
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
        // MongoDB >= 4
        moduleUtils.patchModule(
            'mongodb/lib/cmap/connection',
            'command',
            mongodbConnectionCommandWrapper,
            connection => connection.Connection.prototype
        );
        moduleUtils.patchModule(
            'mongodb/lib/cmap/connection',
            'query',
            mongodbConnectionQueryWrapper,
            connection => connection.Connection.prototype
        );
        moduleUtils.patchModule(
            'mongodb/lib/cmap/connection',
            'getMore',
            mongodbConnectionGetMoreWrapper,
            connection => connection.Connection.prototype
        );
    },
};
