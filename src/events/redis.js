const uuid4 = require('uuid4');
const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');

const redis = tryRequire('redis');

/**
 * Wraps the redis' send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from redis module
 * @returns {Function} The wrapped function
 */
function redisClientWrapper(wrappedFunction) {
    return function internalRedisClientWrapper(commandObj) {
        try {
            // This is used to prevent duplicates command tracing. In this case,
            // the command won't be executed until the client is able to do it,
            // and the wrapped internal function will be called again.
            if (this.ready === false || this.stream.writable === false) {
                return wrappedFunction.apply(this, [commandObj]);
            }

            const { callback } = commandObj;

            const host = this.connection_options.host || 'local';
            const resource = new serverlessEvent.Resource([
                this.connection_options.host || 'local',
                'redis',
                commandObj.command,
            ]);

            const startTime = Date.now();

            const dbapiEvent = new serverlessEvent.Event([
                `redis-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'redis',
                0,
                errorCode.ErrorCode.OK,
            ]);

            dbapiEvent.setResource(resource);

            eventInterface.addToMetadata(dbapiEvent, {
                'Redis Host': host,
                'Redis Port': this.connection_options.port,
                'Redis DB Index': this.connection_options.db || '0',
            }, {
                'Command Arguments': commandObj.args,
            });

            const responsePromise = new Promise((resolve) => {
                commandObj.callback = (err, res) => { // eslint-disable-line no-param-reassign
                    // The callback is run when the response for the command is received
                    dbapiEvent.setDuration(utils.createDurationTimestamp(startTime));

                    // Note: currently not saving the response
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
            tracer.addException(error);
        }

        return wrappedFunction.apply(this, [commandObj]);
    };
}

module.exports = {
    /**
   * Initializes the Redis tracer
   */
    init() {
        if (redis) shimmer.wrap(redis.RedisClient.prototype, 'internal_send_command', redisClientWrapper);
    },
};
