const uuid4 = require('uuid4');
const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wraps the ldap.js bind command function with tracing
 * @param {Function} bindFunction The wrapped bind function from ldap.js module
 * @returns {Function} The wrapped function
 */
function bindWrapper(bindFunction) {
    return function internalBindWrapper(dn, password, controls, callback) {
        try {
            utils.debugLog(`LDAP.js bind() wrapper - dn: ${dn}`);

            const resource = new serverlessEvent.Resource([
                this.url,
                'ldap',
                'bind',
            ]);
            const startTime = Date.now();
            const bindEvent = new serverlessEvent.Event([
                `ldap-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'ldap',
                0,
                errorCode.ErrorCode.OK,
            ]);
            bindEvent.setResource(resource);
            eventInterface.addToMetadata(bindEvent, {
                'LDAP Client': {
                    URL: this.url || '',
                    socketPath: this.socketPath || '',
                    timeout: this.timeout || '',
                    connectTimeout: this.connectTimeout || '',
                    tlsOptions: this.tlsOptions || '',
                    idleTimeout: this.idleTimeout || '',
                    strictDN: this.strictDN || '',
                    Controls: controls || '',
                    DN: dn || '',
                },
            });
            const responsePromise = new Promise((resolve) => {
                callback = (err, res) => { // eslint-disable-line no-param-reassign
                    // The callback is run when the response for the command is received
                    bindEvent.setDuration(utils.createDurationTimestamp(startTime));

                    // Note: currently not saving the response
                    if (err) {
                        eventInterface.setException(bindEvent, err);
                    }

                    // Resolving to mark this event as complete
                    resolve();
                    if (callback) {
                        callback(err, res);
                    }
                };
            });
            tracer.addEvent(bindEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }
        return bindFunction.apply(this, [dn, password, controls, callback]);
    };
}


module.exports = {
    /**
   * Initializes the ldap.js tracer
   */
    init() {
        moduleUtils.patchModule(
            'ldapjs',
            'bind',
            bindWrapper,
            ldapjs => ldapjs.Client.prototype
        );
    },
};
