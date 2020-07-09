const uuid4 = require('uuid4');
const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wraps the redis' send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from redis module
 * @returns {Function} The wrapped function
 */
function redisClientWrapper(wrappedFunction) {
    return function internalRedisClientWrapper(command, stream) {
        try {
            if (this.status !== 'ready') {
                // Skipping such events since they are irrelevant / duplicated
                return wrappedFunction.apply(this, [command, stream]);
            }

            const host = this.options.host || 'local';
            const resource = new serverlessEvent.Resource([
                host,
                'redis',
                command.name,
            ]);

            const startTime = Date.now();

            const dbapiEvent = new serverlessEvent.Event([
                `ioredis-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'redis',
                0,
                errorCode.ErrorCode.OK,
            ]);

            dbapiEvent.setResource(resource);

            eventInterface.addToMetadata(dbapiEvent, {
                'Redis Host': host,
                'Redis Port': this.options.port,
                'Redis DB Index': this.options.db || '0',
            }, {
                'Command Arguments': command.args,
            });


            const responsePromise = new Promise((resolve) => {
                command.promise.then().catch((err) => {
                    eventInterface.setException(dbapiEvent, err);
                }).finally(() => {
                    dbapiEvent.setDuration(utils.createDurationTimestamp(startTime));
                    resolve();
                });
            });

            tracer.addEvent(dbapiEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }

        return wrappedFunction.apply(this, [command, stream]);
    };
}

module.exports = {
    /**
   * Initializes the ioredis tracer
   */
    init() {
        moduleUtils.patchModule(
            'ioredis',
            'sendCommand',
            redisClientWrapper,
            redis => redis.prototype
        );
    },
};
