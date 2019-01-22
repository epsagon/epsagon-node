const uuid4 = require('uuid4');
const tryRequire = require('try-require');
const shimmer = require('shimmer');
const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');

const redis = tryRequire('redis');

function redisClientWrapper(wrappedFunction) {
    return function internalRedisClientWrapper(commandObj) {
        debugger
        const callback = commandObj.callback;

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

        const patchedCallback = (a, b) => {
            debugger;
            dbapiEvent.setDuration(utils.createDurationTimestamp(startTime));

            if (callback) {
                callback(a, b);
            }

            tracer.addEvent(dbapiEvent);
        };

        // const responsePromise = new Promise((resolve) => {
        //     patchedCallback = (err, res) => {
        //         if (err) {
        //             eventInterface.setException(dbapiEvent, err);
        //         } else {
        //             debugger;
        //             resolve()
        //         }
        //     };
        // });

        commandObj.callback = patchedCallback;
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
