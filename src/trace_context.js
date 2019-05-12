/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const cls = require('cls-hooked');

const namespaceId = 'epsagon-context';
let namespace;


/**
 * Creates an active context for tracer and run the handle
 * @param {Function} createTracer create a tracer object
 * @param {Function} handle function to run the context in
 * @returns {Object} The return value
 */
function RunInContext(createTracer, handle) {
    return namespace.runAndReturn(() => {
        namespace.set('tracer', createTracer());
        return handle();
    });
}


/**
 * Returns the active trace
 * @return {Object} tracer object
 */
function get() {
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
