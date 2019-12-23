const moduleUtils = require('./module_utils.js');
const sqlWrapper = require('./sql.js');

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
        let overrideInnerCallback = false;
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

        if (callback === undefined && sql._callback) { // eslint-disable-line no-underscore-dangle
            // In pool connection, no callback passed, but _callback is being used.
            callback = sql._callback; // eslint-disable-line no-underscore-dangle
            overrideInnerCallback = true;
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
        if (overrideInnerCallback) {
            // eslint-disable-next-line no-underscore-dangle,no-param-reassign
            sql._callback = patchedCallback;
        }
        return wrappedFunction.apply(this, [sql, params, callback]);
    };
}

module.exports = {
    /**
     * Initializes the mysql tracer
     */
    init() {
        moduleUtils.patchModule(
            'mysql2',
            'query',
            mysqlQueryWrapper,
            mysql2 => mysql2.Connection.prototype
        );

        moduleUtils.patchModule(
            'mysql2',
            'execute',
            mysqlQueryWrapper,
            mysql2 => mysql2.Connection.prototype
        );

        moduleUtils.patchModule(
            'mysql/lib/Connection.js',
            'query',
            mysqlQueryWrapper,
            mysqlConnection => mysqlConnection.prototype
        );
    },
};
