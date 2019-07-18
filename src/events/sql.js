const uuid4 = require('uuid4');
const { parse } = require('../resource_utils/sql_utils.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

const MAX_QUERY_SIZE = 2048;
const MAX_PARAMS_LENGTH = 5;

/**
 * Parse query arguments - get the callback and params
 * @param {Array|Function} arg1 First argument
 * @param {Function} arg2 Second argument
 * @returns {{params: Array, callback: Function}} The callback and params
 */
module.exports.parseQueryArgs = function parseQueryArgs(arg1, arg2) {
    const paramNotSet = (arg2 === undefined && arg1 instanceof Function);
    const callback = (paramNotSet) ? arg1 : arg2;
    const params = (paramNotSet) ? [] : arg1;

    return { params, callback };
};

/**
 * Wrap SQL query call with tracing
 * @param {string} queryString The executed SQL command
 * @param {Array} params The params argument (values)
 * @param {Function} callback The callback argument (cb)
 * @param {Object} config The connection config object
 * @param {string} driver The database driver type (mysql/pg/..)
 * @returns {Array} The arguments
 */
module.exports.wrapSqlQuery = function wrapSqlQuery(queryString, params, callback, config, driver) {
    let patchedCallback;

    try {
        let sqlObj = {};
        try {
            // Sanitizing query.
            let queryStringSan = queryString.split('`').join('');
            if (queryStringSan.endsWith(';')) {
                queryStringSan = queryStringSan.substr(0, queryStringSan.length - 1);
            }
            sqlObj = parse(queryStringSan);
        } catch (error) {
            sqlObj.type = 'SQL-Command';
        }

        const { type, table } = sqlObj;

        const { database, host } = config;

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
            driver,
            0,
            errorCode.ErrorCode.OK,
        ]);

        dbapiEvent.setResource(resource);
        eventInterface.addToMetadata(dbapiEvent, {
            Host: host,
            Driver: driver,
            Type: type,
            'Table Name': table,
        }, {
            Query: queryString.substring(0, MAX_QUERY_SIZE),
        });
        if (params && params.length) {
            eventInterface.addToMetadata(dbapiEvent, {}, {
                Params: params.slice(0, MAX_PARAMS_LENGTH),
            });
        }

        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, res, fields) => {
                utils.debugLog('SQL Patched callback was called.');
                dbapiEvent.setDuration(utils.createDurationTimestamp(startTime));

                if (err) {
                    eventInterface.setException(dbapiEvent, err);
                } else {
                    let { rowCount } = res;
                    if (!rowCount && res instanceof Array) {
                        rowCount = res.length;
                    }
                    eventInterface.addToMetadata(dbapiEvent, { rowCount });
                }

                resolve();

                if (callback) {
                    callback(err, res, fields);
                }
            };
        });

        tracer.addEvent(dbapiEvent, responsePromise);
    } catch (error) {
        tracer.addException(error);
    }

    return patchedCallback || callback;
};
