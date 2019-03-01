const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const sqlWrapper = require('./sql.js');

const pg = tryRequire('pg');
const Pool = tryRequire('pg-pool');

/**
 * Wraps the pg's module request function with tracing
 * @param {Function} wrappedFunction The pg's module
 * @returns {Function} The wrapped function
 */
function pgClientWrapper(wrappedFunction) {
    return function internalPgClientWrapper(queryString, arg1, arg2) {
        const { params, callback } = sqlWrapper.parseQueryArgs(arg1, arg2);
        const patchedCallback = sqlWrapper.wrapSqlQuery(
            queryString,
            params,
            callback,
            this.connectionParameters || this._clients[0], // eslint-disable-line
            'pg'
        );
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
