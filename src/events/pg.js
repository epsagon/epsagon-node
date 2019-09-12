const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const utils = require('../utils.js');
const sqlWrapper = require('./sql.js');

const pgPath = process.env.EPSAGON_PG_PATH ? `${process.cwd()}${process.env.EPSAGON_PG_PATH}` : 'pg';
const pg = tryRequire(pgPath);
const Pool = tryRequire('pg-pool');

/**
 * Wraps the pg's module request function with tracing
 * @param {Function} wrappedFunction The pg's module
 * @returns {Function} The wrapped function
 */
function pgClientWrapper(wrappedFunction) {
    return function internalPgClientWrapper(queryString, arg1, arg2) {
        if (queryString && queryString.submit) {
            // this is a Submittable instance, not supported yet - return as is.
            return wrappedFunction.apply(this, [queryString, arg1, arg2]);
        }

        const parseResult = sqlWrapper.parseQueryArgs(arg1, arg2);
        let { params } = parseResult;
        const { callback } = parseResult;

        let sqlString = queryString;
        let sqlParams = params;
        if (queryString && queryString.text) {
            // this is a query object, use the values inside it.
            sqlString = queryString.text;
            if (queryString.values && params && !params.length) {
                // values are in the object
                params = undefined;
                sqlParams = queryString.values;
            }
        }

        let patchedCallback = sqlWrapper.wrapSqlQuery(
            sqlString,
            sqlParams,
            callback,
            this.connectionParameters || this._clients[0], // eslint-disable-line
            'pg'
        );


        if (callback) {
            // it's safe to use callback, user not expecting a Promise.
            return wrappedFunction.apply(this, [queryString, params, patchedCallback]);
        }

        // verify we have a patched callback;
        patchedCallback = patchedCallback || (() => {});
        // we need to return a Promise. we can't pass patchedCallback or a Promise won't be returned
        const responsePromise = wrappedFunction.apply(this, [queryString, params]);

        if (!(responsePromise && typeof responsePromise.then === 'function')) {
            // the return value is not a promise. This is an old version
            // call patchedCallback now or it will never be called
            // using empty result
            patchedCallback(null, null, null);
        }

        // we got a promise. call patchedCallback when it resolves/rejects.
        return responsePromise.then((res) => {
            patchedCallback(null, res, null);
            return res;
        }, (err) => {
            patchedCallback(err, null, null);
            throw err;
        });
    };
}

module.exports = {
    /**
     * Initializes the pg tracer
     */
    init() {
        if (process.env.EPSAGON_PG_PATH) {
            utils.debugLog(`EPSAGON_PG_PATH=${process.env.EPSAGON_PG_PATH}`);
            utils.debugLog(`cwd=${process.cwd()}`);
            utils.debugLog(`pg=${pg}`);
            utils.debugLog(`pg.defaults=${JSON.stringify(pg.defaults)}`);
        }
        if (pg) shimmer.wrap(pg.Client.prototype, 'query', pgClientWrapper);
        if (Pool) shimmer.wrap(Pool.prototype, 'query', pgClientWrapper);
    },
};
