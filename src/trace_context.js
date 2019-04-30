/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const cls = require('cls-hooked');

const namespaceId = 'epsagon-context';
let namespace;


/**
 * Creates an active context for tracer and run the handle
 * @param {Object} tracer object
 * @param {Function} handle function to run the context in
 * @param {Function} The runner event
 */
function RunInContext(tracer, handle) {
    namespace.run(() => {
        namespace.set('tracer', tracer);
        handle();
    });
}


/**
 * Returns the active trace
 * @return {Object} tracer object
 */
function get() {
    if (!namespace) {
        namespace = cls.createNamespace(namespaceId);
    }
    return (namespace && namespace.active) ? namespace.get('tracer') : null;
}


/**
 * Initialize context namespace
 */
function init() {
    namespace = cls.createNamespace(namespaceId);
}


module.exports = {
    get,
    init,
    RunInContext,
};
