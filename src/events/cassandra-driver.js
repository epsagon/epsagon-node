const utils = require('../utils.js');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');
const { parse } = require('../resource_utils/sql_utils.js');

/**
 * Wraps the cassandra send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from cassandra module
 * @returns {Function} The wrapped function
 */
function cassandraClientWrapper(wrappedFunction) {
    return function internalCassandraClientWrapper(query, params, execOptions, cb) {
        let executeResponse;
        let cassandraEvent;
        let eventStartTime;
        let table;
        let patchedCallback;
        let operation = 'execute';
        try {
            const parsedQuery = parse(query);
            operation = parsedQuery.type;
            table = parsedQuery.from.length && parsedQuery.from[0].table;
        } catch (err) {
            utils.debugLog(`could not extract cassandra operation ${err}`);
        }
        try {
            const { slsEvent, startTime } = eventInterface.initializeEvent(
                'cassandra',
                this.options.contactPoints[0],
                operation,
                'cassandra-driver'
            );
            cassandraEvent = slsEvent;
            eventStartTime = startTime;
        } catch (err) {
            tracer.addException(err);
        }

        if (this.options.keyspace) {
            eventInterface.addToMetadata(cassandraEvent, {
                'db.cassandra.keyspace': this.options.keyspace,
            });
        }
        if (this.options.localDataCenter) {
            eventInterface.addToMetadata(cassandraEvent, {
                'db.cassandra.coordinator.dc': this.options.localDataCenter,
            });
        }
        if (table) {
            eventInterface.addToMetadata(cassandraEvent, { 'db.cassandra.table': table });
        }

        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, data) => {
                let callbackResult;
                try {
                    if (!cassandraEvent) {
                        utils.debugLog('Could not initialize cassandra, skipping response.');
                        return callbackResult;
                    }
                    eventInterface.finalizeEvent(
                        cassandraEvent,
                        eventStartTime,
                        err,
                        {
                            'db.name': this.options.contactPoints[0],
                            'db.operation': operation,
                        },
                        {
                            'db.statement': query,
                            'db.cassandra.params': params,
                        }
                    );
                } catch (callbackErr) {
                    tracer.addException(callbackErr);
                } finally {
                    if (cb && typeof cb === 'function') {
                        callbackResult = cb(err, data);
                    }
                }
                resolve();
                return callbackResult;
            };
        });

        try {
            executeResponse = wrappedFunction.apply(
                this,
                [query, params, execOptions, patchedCallback]
            );
        } catch (err) {
            if (cassandraEvent) {
                eventInterface.setException(cassandraEvent, err);
                tracer.addEvent(cassandraEvent);
            }
            throw err;
        }

        if (cassandraEvent) {
            tracer.addEvent(cassandraEvent, responsePromise);
        }

        return executeResponse;
    };
}

module.exports = {
    /**
   * Initializes the cassandra tracer
   */
    init() {
        moduleUtils.patchModule(
            'cassandra-driver/lib/client',
            'execute',
            cassandraClientWrapper,
            cassandra => cassandra.prototype
        );
    },
};
