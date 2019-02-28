const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const sqlWrapper = require('./sql.js');

const mysql2 = tryRequire('mysql2');
const mysqlConnection = tryRequire('mysql/lib/Connection.js');

/**
 * Wraps Connection.query function with tracing
 * @param {Function} wrappedFunction The function to wrap from mysql
 * @returns {Function} The wrapped function
 */
function mysqlQueryWrapper(wrappedFunction) {
    return function internalMySqlQueryWrapper(sql, arg1, arg2) {
        let queryString;
        let callback;
        let params;
        if (typeof sql !== 'string') {
            queryString = sql.sql;
        } else {
            queryString = sql;
        }

        if (sql.onResult) {
            params = sql.values;
            callback = sql.onResult;
        } else {
            ({ params, callback } = sqlWrapper.parseQueryArgs(arg1, arg2));
        }

        const patchedCallback = sqlWrapper.wrapSqlQuery(
            queryString,
            params,
            callback,
            this.config,
            'mysql'
        );
        if (sql.onResult) {
            sql.onResult = patchedCallback; // eslint-disable-line
        } else {
            callback = patchedCallback;
        }
        return wrappedFunction.apply(this, [sql, params, callback]);
    };
}

module.exports = {
    /**
     * Initializes the mysql tracer
     */
    init() {
        if (mysql2) shimmer.wrap(mysql2.Connection.prototype, 'query', mysqlQueryWrapper);
        if (mysqlConnection) {
            shimmer.wrap(mysqlConnection.prototype, 'query', mysqlQueryWrapper);
        }
    },
};
