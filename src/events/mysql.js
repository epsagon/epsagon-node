const shimmer = require('shimmer');
const tryRequire = require('try-require');
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
            params = sql.values;
            callback = (
                sql.onResult ||
                (typeof arg2 === 'function' && arg2) ||
                (typeof arg1 === 'function' && arg1)
            );
        } else {
            queryString = sql;
            ({ params, callback } = sqlWrapper.parseQueryArgs(arg1, arg2));
        }

        const patchedCallback = sqlWrapper.wrapSqlQuery(
            queryString,
            params,
            callback,
            this.config,
            'mysql'
        );
        if (typeof sql === 'string') {
            callback = patchedCallback;
        } else {
            sql.onResult = patchedCallback; // eslint-disable-line
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
