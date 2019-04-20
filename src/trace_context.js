/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const cls = require('cls-hooked');

const namespaceId = 'epsagon-context';
const namespace = cls.createNamespace(namespaceId);


/**
 * Creates an active context for tracer
 * @param {Trace} tracer object
 * @param {Request} next The Express's next function
 * @param {Function} The runner event
 */
function activateContext(tracer, next) {
    namespace.run(() => {
        namespace.set('tracer', tracer);
        next();
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
    activateContext,
};
