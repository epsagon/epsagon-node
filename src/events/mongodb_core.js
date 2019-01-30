const uuid4 = require('uuid4');
const tryRequire = require('try-require');
const shimmer = require('shimmer');
const serverlessEvent = require('../proto/event_pb.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');

const mongodb = tryRequire('mongodb-core');


function mongoGeneralCommandWrapper(operation) {
    return function mongoCommandWrapper(wrappedFunction) {
        return function internalMongoCommandWrapper(ns, ops, options, callback) {
            const startTime = Date.now();

            const connectionOptions = this.s ? (this.s.options || {}) : {};

            const resource = new serverlessEvent.Resource([
                this.s.options.host || 'local',
                'mongodb',
                operation || Object.keys(ops)[0],
            ]);
            const dbapiEvent = new serverlessEvent.Event([
                `mongodb-${uuid4()}`,
                utils.createTimestampFromTime(startTime),
                null,
                'mongodb',
                0,
                errorCode.ErrorCode.OK,
            ]);
            dbapiEvent.setResource(resource);

            eventInterface.addToMetadata(dbapiEvent, {
                Port: connectionOptions.port,
            });

            tracer.addEvent(dbapiEvent);

            return wrappedFunction.apply(this, [ns, ops, connectionOptions, callback]);
        };
    };
}


function mongoInsertWrapper(wrappedFunction) {
    return function internalMongoInsertWrapper(ns, ops, options, callback) {
        console.trace();

        return wrappedFunction.apply(this, [ns, ops, options, callback]);
    };
}


function mongoNextWrapper(wrappedFunction) {
    return function internalMongoNextWrapper(callback) {
        console.trace();

        return wrappedFunction.apply(this, [callback]);
    };
}

module.exports = {
    /**
     * Initializes the Mongodb tracer
     */
    init() {
        if (mongodb) {
            shimmer.wrap(mongodb.Server.prototype, 'command', mongoGeneralCommandWrapper());
            shimmer.wrap(mongodb.Server.prototype, 'insert', mongoGeneralCommandWrapper('insert'));
            shimmer.wrap(mongodb.Server.prototype, 'update', mongoGeneralCommandWrapper('update'));
            shimmer.wrap(mongodb.Server.prototype, 'remove', mongoGeneralCommandWrapper('remove'));
            shimmer.wrap(mongodb.Cursor.prototype, 'next', mongoNextWrapper);
        }
    },
};
