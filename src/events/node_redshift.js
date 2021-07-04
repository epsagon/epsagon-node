const moduleUtils = require('./module_utils.js');
const sqlWrapper = require('./sql.js');

/**
 * Wraps Redshift's runQuery with tracing
 * @param {Function} wrappedFunction The function to wrap from node redshift
 * @returns {Function} The wrapped function
 */
function nodeRedshiftWrapper(wrappedFunction) {
    return function internalRedshiftRunQueryWrapper(...args) {
        debugger;
        const { config } = this;
        const argsCopy = [...args];
        const query = argsCopy.shift();
        const cb = argsCopy.pop();

        const patchedCallback = sqlWrapper.wrapSqlQuery(query, undefined, cb, config, 'redshift');

        argsCopy.unshift(query);
        argsCopy.push(patchedCallback);

        return wrappedFunction.apply(this, argsCopy);
    };
}

module.exports = {
    /**
     * Initializes the node-redshift tracer
     */
    init() {
        moduleUtils.patchModule('node-redshift', 'query', nodeRedshiftWrapper, nodeRs => nodeRs.prototype);
    },
};
