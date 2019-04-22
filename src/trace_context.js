/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const cls = require('cls-hooked');

const namespaceId = 'epsagon-context';
const namespace = cls.createNamespace(namespaceId);


/**
 * Creates an active context for tracer and run the handle
 * @param {Trace} tracer object
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
 * @return {Trace} tracer object
 */
function getTracer() {
    return (namespace && namespace.active) ? namespace.get('tracer') : null;
}

module.exports = {
    getTracer,
    RunInContext,
};
