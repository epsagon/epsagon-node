// All Session and Transaction properties are private
/* eslint-disable no-underscore-dangle, prefer-rest-params */

/**
 * @fileoverview: Handlers for Neo4j driver instrumentation
 */

const uuid4 = require('uuid4');

const moduleUtils = require('./module_utils.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');
const serverlessEvent = require('../proto/event_pb.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');

const DEFAULT_PORT = '7474';
const DEFAULT_HOST = 'neo4j';


/**
 * Extracts the relevant arguments from provided arguments
 * @returns {Object} Object of the extracted arguments
 */
function getArgsFromFunction(...args) {
    let relevantArgs = {};
    switch (args[args.length - 1]) {
    case 'Session':
        relevantArgs = {
            query: args[0],
            params: args[1],
            transactionConfig: args[2],
        };
        break;

    case 'Transaction':
        relevantArgs = {
            query: args[0],
            params: args[1],
        };
        break;
    default:
        break;
    }

    return relevantArgs;
}


/**
 * Gets session's address info from Transaction/Session instance
 * @param {neo4j.Session|neo4j.Transaction} session A DB session (could be Session of Transaction)
 * @returns {Object} json with address info { host, port }
 */
function getAddressInfo(session) {
    let port = DEFAULT_PORT;
    let host = DEFAULT_HOST;
    let connectionHolder;

    switch (session.constructor.name) {
    // By default, Session opens two same connectionProviders - Read and Write, and not default one
    case 'Session':
        connectionHolder = session._readConnectionHolder;
        break;

    case 'Transaction':
        connectionHolder = session._connectionHolder;
        break;

    default:
        return {
            host, port,
        };
    }

    if (session && connectionHolder && connectionHolder._connectionProvider) {
        const connectionProvider = connectionHolder._connectionProvider;
        port = connectionProvider._address.port();
        host = connectionProvider._address.host();
    }

    return {
        port, host,
    };
}


/**
 * Parse from DB session with Neo4j server, useful metadata
 * @param {neo4j.Session|neo4j.Transaction} session A DB session (could be Session of Transaction)
 * @returns {{metadata: Object, fullMetadata: Object}} JSONs with command's metadata and command's
 *      full metadata which contains additional data about the event
 */
function getNeo4JSessionMetadata(session) {
    const metadata = {};
    const fullMetadata = {};

    let connectionHolder;
    let sessionMode;
    let operationMode = '';

    switch (session.constructor.name) {
    // By default, Session opens two same connectionProviders - Read and Write, and not default one
    case 'Session':
        connectionHolder = session._readConnectionHolder;
        sessionMode = 'READ|WRITE';
        break;

    case 'Transaction':
        connectionHolder = session._connectionHolder;
        sessionMode = connectionHolder._mode;

        break;

    default:
        return;
    }

    switch (sessionMode) {
    case 'READ':
        operationMode = 'Read';
        break;

    case 'WRITE':
        operationMode = 'Write';
        break;

    case 'READ|WRITE':
        operationMode = 'Read|Write';
        break;

    default:
        break;
    }

    if (connectionHolder) {
        metadata.dbName = connectionHolder._database ? connectionHolder._database : 'default';
        metadata.operation = `${session.constructor.name}:${operationMode}`;

        fullMetadata.config = connectionHolder._connectionProvider._config;
    }

    // eslint-disable-next-line consistent-return
    return { metadata, fullMetadata };
}


/**
 * Create new patched methods for all relevant Observable methods and return
 * @param {neo4j.session.Session | neo4j.transaction.Transaction} session A session
 *      with Neo4j server
 * @param {Object} observer An observer instance to patch
 * @param {IArguments} sessionArguments The arguments of the observer
 * @param {serverlessEvent.Event} dbApiEvent The event of the current run
 * @param {number} startTime The Event start time
 * @returns {Object} All the patched methods
 */
function getPatchedSubscribeMethods(
    session,
    observer,
    sessionArguments,
    dbApiEvent,
    startTime
) {
    const records = [];

    return {
        // eslint-disable-next-line require-jsdoc
        onNext(record) {
            records.push(record);
            return observer.onNext.apply(session, sessionArguments);
        },

        // eslint-disable-next-line require-jsdoc
        onCompleted(summary) {
            switch (summary.queryType) {
            case 's':
                eventInterface.addToMetadata(
                    dbApiEvent,
                    { items_count: records.length, operation_executed: 'Schema, Write' }
                );
                break;

            case 'r':
                eventInterface.addToMetadata(
                    dbApiEvent,
                    { items_count: records.length, operation_executed: 'Read' }
                );
                break;

            case 'w':
                eventInterface.addToMetadata(
                    dbApiEvent,
                    { operation_executed: 'Write' },
                    { write_stats: summary.counters._stats }
                );
                break;
            case 'rw':
                eventInterface.addToMetadata(
                    dbApiEvent,
                    { items_count: records.length, operation_executed: 'Read, Write' },
                    { write_stats: summary.counters._stats }
                );
                break;

            default:
                utils.debugLog(`Unkown query type: ${summary.queryType}`);
                break;
            }

            dbApiEvent.setDuration(utils.createDurationTimestamp(startTime));
            tracer.addEvent(dbApiEvent);
            return observer.onCompleted.apply(session, sessionArguments);
        },

        // eslint-disable-next-line require-jsdoc
        onError(err) {
            eventInterface.setException(dbApiEvent, err);
            // eslint-disable-next-line prefer-rest-params
            return observer.onError.apply(session, sessionArguments);
        },
    };
}


/**
 * Create new serverlessEvent for Neo4J run event (any type of run) and
 *  add relevant metadata
 * @param {neo4j.Session|neo4j.Transaction} session A DB session (could be Session of Transaction)
 * @param {number} startTime The Event start time
 * @returns {serverlessEvent.Event} The new Event
 */
function createNewNeo4jEvent(session, startTime) {
    const { host, port } = getAddressInfo(session);

    const {
        metadata, fullMetadata,
    } = getNeo4JSessionMetadata(session);

    metadata.port = port;

    const resource = new serverlessEvent.Resource([
        host,
        'neo4j',
        metadata.operation,
    ]);

    const dbApiEvent = new serverlessEvent.Event([
        `neo4j-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'neo4j',
        0,
        errorCode.ErrorCode.OK,
    ]);

    dbApiEvent.setResource(resource);

    eventInterface.addToMetadata(dbApiEvent, metadata, fullMetadata);

    return dbApiEvent;
}


/**
 * Wraps neo4j.Session.run functions with tracing
 * @param {Function} wrappedFunction The function to wrap from Neo4j
 * @returns {Function} The wrapped function
 */
function neo4jSessionRunWrapper(wrappedFunction) {
    return function internalNeo4jSessionRunWrapper(...args) {
        const relevantArgs = getArgsFromFunction(...args, this.constructor.name);
        const {
            query, params, transactionConfig,
        } = relevantArgs;

        utils.debugLog('User called Neo4j wrapped Session run function');

        try {
            const startTime = Date.now();

            const dbApiEvent = createNewNeo4jEvent(this, startTime);

            eventInterface.addToMetadata(
                dbApiEvent,
                {},
                { query, param: params, transaction_config: transactionConfig }
            );


            const resultResponse = wrappedFunction.apply(
                this,
                [query, params, transactionConfig]
            );

            const originalSubscribe = resultResponse.subscribe;

            // Override the Result subscribe with patched subscriber
            // eslint-disable-next-line func-names
            resultResponse.subscribe = function (observer) {
                originalSubscribe.call(this, getPatchedSubscribeMethods(
                    this,
                    observer,
                    arguments,
                    dbApiEvent,
                    startTime
                ));
            };

            return resultResponse;
        } catch (error) {
            tracer.addException(error);
            return wrappedFunction.apply(this, [query, params, transactionConfig]);
        }
    };
}


/**
 * Wraps neo4j.Transaction.run functions with tracing
 * @param {Function} wrappedFunction The function to wrap from Neo4j
 * @returns {Function} The wrapped function
 */
function neo4jTransactionRunWrapper(wrappedFunction) {
    return function internalNeo4jTransactionRunWrapper(...args) {
        const relevantArgs = getArgsFromFunction(...args, this.constructor.name);
        const {
            query, params,
        } = relevantArgs;

        utils.debugLog('User called Neo4j wrapped Transaction run function');

        try {
            const startTime = Date.now();
            const dbApiEvent = createNewNeo4jEvent(this, startTime);

            eventInterface.addToMetadata(
                dbApiEvent,
                {},
                { query, param: params }
            );

            const resultResponse = wrappedFunction.apply(this, [query, params]);
            const originalSubscribe = resultResponse.subscribe;

            // Override the Result subscribe with patched subscriber
            // eslint-disable-next-line func-names
            resultResponse.subscribe = function (observer) {
                originalSubscribe.call(this, getPatchedSubscribeMethods(
                    this,
                    observer,
                    arguments,
                    dbApiEvent,
                    startTime
                ));
            };

            return resultResponse;
        } catch (error) {
            tracer.addException(error);
            return wrappedFunction.apply(this, [query, params]);
        }
    };
}


module.exports = {
    /**
     * Initializes the Neo4j tracer
     */
    init() {
        moduleUtils.patchModule(
            'neo4j-driver/lib/transaction.js',
            'run',
            neo4jTransactionRunWrapper,
            Transaction => Transaction.default.prototype
        );

        moduleUtils.patchModule(
            'neo4j-driver/lib/session.js',
            'run',
            neo4jSessionRunWrapper,
            Session => Session.default.prototype
        );
    },
};
