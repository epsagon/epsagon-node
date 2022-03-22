
const config = require('../config.js');
const tracer = require('../tracer.js');
const moduleUtils = require('./module_utils');
const tryRequire = require('../try_require');
const utils = require('../utils.js');
const consts = require('../consts.js');

const console = tryRequire('console');

/**
 * Wrap console stdout methods.
 * @param {Function} originalFunc the Original stdout function
 * @returns {Function} the wrapped function
 */
function wrapConsoleStdoutFunction(originalFunc) {
    return function internalWrapConsoleStdoutFunction(...args) {
        originalFunc.apply(this, args);
        if (args.length === 2) {
            const [k, v] = args;

            if (k === consts.LOG_PREFIX) {
                return;
            }

            if (config.isKeyMatched(config.getConfig().keysToAllow, k)) {
                tracer.label(k, v);
            }
        }
    };
}

module.exports = {
    /**
     * Patch Node.JS console functions.
     */
    init() {
        if (console) {
            utils.debugLog('Patching console module');
            [
                'log',
                'warn',
                'error',
            ]
                .forEach((method) => {
                    moduleUtils.patchSingle(console, method, wrapConsoleStdoutFunction);
                });
        }
    },
};
