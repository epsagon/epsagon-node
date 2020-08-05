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
    return function internalBindWrapper(a, b, c, d) {
        let callback;
        let controls;
        let patchedCallback;

        try {
            const name = a;

            if (typeof (c) === 'function') {
                callback = c;
                controls = [];
            } else if (typeof (d) === 'function') {
                callback = d;
                controls = c;
            }
            utils.debugLog(`LDAP.js bind() wrapper - name: ${name}`);
            const resource = new serverlessEvent.Resource([
                this.url.hostname,
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
                enduser: { id: name },
                net: {
                    transport: 'IP.TCP',
                    protocol: this.url.protocol || '',
                    socketPath: this.socketPath || '',
                    timeout: this.timeout || '',
                    connectTimeout: this.connectTimeout || '',
                    tlsOptions: this.tlsOptions || '',
                    idleTimeout: this.idleTimeout || '',
                    strictDN: this.strictDN || '',
                    pathname: this.url.pathname || '',
                    secure: this.url.secure || '',
                    peer: {
                        address: this.url.href || '',
                        name: this.url.hostname || '',
                        hostname: this.url.hostname || '',
                        port: this.url.port || '',
                        service: 'ldap',
                    },
                },
            });
            const responsePromise = new Promise((resolve) => {
                patchedCallback = (err, res) => { // eslint-disable-line no-param-reassign
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
        return bindFunction.apply(this, [a, b, controls, patchedCallback]);
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
