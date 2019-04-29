/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const cls = require('cls-hooked');

const namespaceId = 'epsagon-context';
const namespace = cls.createNamespace(namespaceId);


/**
 * Creates an active context for tracer and run the handle
 * @param {Object} tracer object
 * @param {Function} handle function to run the context in
 */
function RunInContext(tracer, handle) {
    namespace.run(() => {
        namespace.set('tracer', tracer);
        handle();
    });
}


/**
 * Creates an active context for tracer and run the handle. Return the original value
 * @param {Object} tracer object
 * @param {Function} handle function to run the context in
 * @returns {Object} The return value
 */
function RunInContextAndReturn(tracer, handle) {
    return namespace.runAndReturn(() => {
        namespace.set('tracer', tracer);
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

module.exports = {
    get,
    RunInContext,
    RunInContextAndReturn,
};
