const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const sqlWrapper = require('./sql.js');
const utils = require('../utils.js');

const pg = tryRequire('pg');
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
            utils.debugLog(`pg: Submittable instance: ${queryString}`);
            return wrappedFunction.apply(this, [queryString, arg1, arg2]);
        }

        const parseResult = sqlWrapper.parseQueryArgs(arg1, arg2);
        let { params } = parseResult;
        const { callback } = parseResult;

        let sqlString = queryString;
        let sqlParams = params;
        if (queryString && queryString.text) {
            // this is a query object, use the values inside it.
            utils.debugLog(`pg: query object: ${queryString.text}`);
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
            utils.debugLog('pg: calling callback');
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
            utils.debugLog('pg: return value is not a promise');
            patchedCallback(null, null, null);
        }

        // we got a promise. call patchedCallback when it resolves/rejects.
        return responsePromise.then((res) => {
            utils.debugLog('pg: promise, calling callback without error');
            patchedCallback(null, res, null);
            return res;
        }, (err) => {
            utils.debugLog('pg: promise, calling callback with error');
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
        if (pg) shimmer.wrap(pg.Client.prototype, 'query', pgClientWrapper);
        if (Pool) shimmer.wrap(Pool.prototype, 'query', pgClientWrapper);
    },
};
