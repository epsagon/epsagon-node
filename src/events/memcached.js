const uuid4 = require('uuid4');
const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wraps memcached 'command' function with tracing
 * @param {Function} wrappedFunction The wrapped function from memcached module
 * @returns {Function} The wrapped function
 */
function memcachedClientWrapper(wrappedFunction) {
    return function internalMemcachedClientWrapper(commandObj) {
        try {
            const { callback } = commandObj;
            const cmdArgs = commandObj(() => ({
                // eslint-disable-next-line no-undef
                key: fullkey,
                validate: [['key', String], ['callback', Function]],
                type: 'get',
                // eslint-disable-next-line no-undef
                command: `get ${fullkey}`,
            }));
            const host = this.servers && this.servers.length > 0 ? this.servers[0].split(':') : ['local', 0];
            const hostname = host[0];
            const port = host.length > 1 ? host[1] : 0;
            const resource = new serverlessEvent.Resource([
                hostname,
                'memcached',
                commandObj.name,
            ]);

            const startTime = Date.now();

            const dbapiEvent = new serverlessEvent.Event([
                `memcached-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'memcached',
                0,
                errorCode.ErrorCode.OK,
            ]);

            dbapiEvent.setResource(resource);

            eventInterface.addToMetadata(dbapiEvent, {
                memcached_hostname: hostname,
                memcached_host: port,
            }, {
                'Command Arguments': cmdArgs,
            });

            const responsePromise = new Promise((resolve) => {
                commandObj.callback = (err, res) => { // eslint-disable-line no-param-reassign
                    // The callback is run when the response for the command is received
                    dbapiEvent.setDuration(utils.createDurationTimestamp(startTime));

                    if (err) {
                        eventInterface.setException(dbapiEvent, err);
                    }

                    // Resolving to mark this event as complete
                    resolve();

                    if (callback) {
                        callback(err, res);
                    }
                };
            });

            tracer.addEvent(dbapiEvent, responsePromise);
        } catch (error) {
            utils.debugLog('memcahced catch error', error);
            tracer.addException(error);
        }

        return wrappedFunction.apply(this, [commandObj]);
    };
}

module.exports = {
    /**
   * Initializes the memcached tracer
   */
    init() {
        moduleUtils.patchModule(
            'memcached/lib/memcached.js',
            'command',
            memcachedClientWrapper,
            memcached => memcached.prototype
        );
    },
};
