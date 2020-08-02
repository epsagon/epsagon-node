// const uuid4 = require('uuid4');
// const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
// const errorCode = require('../proto/error_code_pb.js');
// const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wraps the ldap.js createClient command function with tracing
 * @param {Function} createClientFunction The wrapped createClient function from ldap.js module
 * @returns {Function} The wrapped function
 */
function createClientWrapper(createClientFunction) {
    return function internalCreateClientWrapper(url, socketPath, log, timeout, connectTimeout, tlsOptions, idleTimeout, strictDN) {
        try {
            utils.debugLog(`LDAP.js function wrapper: url=${url}`);
        } catch (error) {
            tracer.addException(error);
        }
        return createClientFunction.apply(this, [url, socketPath, log, timeout, connectTimeout, tlsOptions, idleTimeout, strictDN]);
    };
}

module.exports = {
    /**
   * Initializes the ldap.js tracer
   */
    init() {
        moduleUtils.patchModule(
            'ldapjs',
            'createClient',
            createClientWrapper,
        );
    },
};


