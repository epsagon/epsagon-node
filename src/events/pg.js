const uuid4 = require('uuid4');
const shimmer = require('shimmer');
const tryRequire = require('try-require');
const sqlParser = require('node-sqlparser');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

const pg = tryRequire('pg');
const Pool = tryRequire('pg-pool');

const MAX_QUERY_SIZE = 2048;

/**
 * Wraps the pg's module request function with tracing
 * @param {Function} wrappedFunction The pg's module
 * @returns {Function} The wrapped function
 */
function pgClientWrapper(wrappedFunction) {
    return function internalpgClientWrapper(queryString, arg1, arg2) {
        let patchedCallback;
        const paramNotSet = (arg2 === undefined && arg1 instanceof Function);
        const callback = (paramNotSet) ? arg1 : arg2;
        const params = (paramNotSet) ? [] : arg1;

        try {
            let sqlObj = {};
            try {
                sqlObj = sqlParser.parse(queryString);
            } catch (error) {
                sqlObj.type = 'SQL-Command';
            }

            const { type, table, } = sqlObj;

            const {
                database,
                host,
            } = this.connectionParameters || this._clients[0]; // eslint-disable-line

            let resourceType = 'sql';
            if (host.match('.rds.')) { resourceType = 'rds'; }
            if (host.match('.redshift.')) { resourceType = 'redshift'; }

            const resource = new serverlessEvent.Resource([
                database, // name of the database
                resourceType,
                type,
            ]);

            const startTime = Date.now();

            const dbapiEvent = new serverlessEvent.Event([
                `dbapi-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'pg',
                0,
                errorCode.ErrorCode.OK,
            ]);

            dbapiEvent.setResource(resource);

            const extendedData = {};
            if ((type === 'select') || (!tracer.metadata_only)) {
                extendedData.Query = queryString;
            }

            eventInterface.addToMetadata(dbapiEvent, {
                Host: host,
                Driver: 'pg',
                Type: type,
                'Table Name': table,
            }, {
                Query: queryString.substring(0, MAX_QUERY_SIZE),
            });

            const responsePromise = new Promise((resolve) => {
                patchedCallback = (err, res) => {
                    dbapiEvent.setDuration(utils.createDurationTimestamp(startTime));

                    if (err) {
                        eventInterface.setException(dbapiEvent, err);
                    } else {
                        eventInterface.addToMetadata(dbapiEvent, {
                            rowCount: res.rowCount,
                        });
                    }

                    if (callback) {
                        callback(err, res);
                    }

                    resolve();
                };
            }).catch((err) => {
                tracer.addException(err);
            });

            tracer.addEvent(dbapiEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }

        return wrappedFunction.apply(this, [queryString, params, patchedCallback]);
    };
}

module.exports = {
    /**
     * Initializes the pg tracer
     */
    init() {
        if (pg) shimmer.wrap(pg.Client.prototype, 'query', pgClientWrapper);
        if (Pool) shimmer.wrap(Pool.prototype, 'query', pgClientWrapper);
    },
};
