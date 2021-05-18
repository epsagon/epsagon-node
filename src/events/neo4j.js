// All Session and Transaction properties are private
/* eslint-disable no-underscore-dangle */
/* eslint-disable prefer-rest-params */

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

/**
 * Extracts the relevant arguments from provided arguments
 * @returns {Object} Object of the extracted arguments
 */
function getArgsFromFunction(...args) {
    return {
        query: args[0],
        params: args[1],
    };
}


/**
 * Gets session's address info from Transaction/Session instance
 * @param {neo4j.Session|neo4j.Transaction} session A DB session (could be Session of Transaction)
 * @returns {Object} json with address info { host, port }
 */
function getAddressInfo(session) {
    let port = '7474';
    let host = 'neo4j';
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

    metadata.dbName = connectionHolder._database ? connectionHolder._database : 'default';
    metadata.operation = `${session.constructor.name}:${operationMode}`;

    fullMetadata.config = connectionHolder._connectionProvider._config;

    // eslint-disable-next-line consistent-return
    return { metadata, fullMetadata };
}


/**
 * Wraps neo4j.Session.run and neo4j.Transaction.run functions with tracing
 * @param {Function} wrappedFunction The function to wrap from Neo4j
 * @returns {Function} The wrapped function
 */
function neo4jSessionRunWrapper(wrappedFunction) {
    return function internalNeo4jSessionRunWrapper(...args) {
        const relevantArgs = getArgsFromFunction(...args);
        const {
            query, params,
        } = relevantArgs;

        utils.debugLog('User called Neo4j wrapped run function');

        try {
            const startTime = Date.now();

            const {
                metadata, fullMetadata,
            } = getNeo4JSessionMetadata(this);

            const { host, port } = getAddressInfo(this);
            metadata.port = port;
            fullMetadata.query = query;
            fullMetadata.params = params;

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

            const resultResponse = wrappedFunction.apply(this, [query, params]);
            const originalSubscribe = resultResponse.subscribe;

            // Override the Result subscribe with patched subscriber
            // eslint-disable-next-line func-names
            resultResponse.subscribe = function (observer) {
                const records = [];

                return originalSubscribe.call(this, {
                    ...observer,
                    // eslint-disable-next-line no-unused-vars,require-jsdoc
                    onKeys(_keys) {
                        if (!observer.onKeys) return;
                        observer.keys.apply(this, arguments);
                    },

                    // eslint-disable-next-line require-jsdoc
                    onNext(record) {
                        records.push(record);
                        return observer.onNext.apply(this, arguments);
                    },

                    // eslint-disable-next-line require-jsdoc
                    onCompleted(summary) {
                        switch (summary.queryType) {
                        case 's':
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
                        return observer.onCompleted.apply(this, arguments);
                    },

                    // eslint-disable-next-line require-jsdoc
                    onError(err) {
                        eventInterface.setException(dbApiEvent, err);
                        // eslint-disable-next-line prefer-rest-params
                        return observer.onError.apply(this, arguments);
                    },
                });
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
            neo4jSessionRunWrapper,
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
