const uuid4 = require('uuid4');
const utils = require('../utils.js');
const errorCode = require('../proto/error_code_pb.js');
const moduleUtils = require('./module_utils.js');
const serverlessEvent = require('../proto/event_pb.js');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');

/**
 * Wraps Redshift's runQuery with tracing
 * @param {Function} wrappedFunction The function to wrap from node redshift
 * @returns {Function} The wrapped function
 */
function nodeRedshiftWrapper(wrappedFunction) {
    return function internalRedshiftRunQueryWrapper(...args) {
        const { config } = this;
        const { host, port } = config;
        const argsCopy = [...args];
        const query = argsCopy.shift();
        const cb = argsCopy.pop();

        const startTime = Date.now();

        const resource = new serverlessEvent.Resource([
            host,
            'redis',
            'query',
        ]);

        const dbapiEvent = new serverlessEvent.Event([
            `redshift-${uuid4()}`,
            utils.createTimestampFromTime(startTime),
            null,
            'redis',
            0,
            errorCode.ErrorCode.OK,
        ]);

        dbapiEvent.setResource(resource);

        let patchedCB = cb;
        const p = new Promise(resolve => {
            patchedCB = (err, data) => {
                dbapiEvent.setDuration(utils.createDurationTimestamp(startTime));

                resolve();

                if (cb) {
                    cb(err, data);
                }
            }
        });

        // eventInterface.addToMetadata(dbapiEvent, { host, port }, { query });
        tracer.addEvent(dbapiEvent, p);

        argsCopy.unshift(query);
        argsCopy.push(patchedCB);

        return wrappedFunction.apply(this, argsCopy);
    };
}

module.exports = {
    /**
     * Initializes the node-redshift tracer
     */
    init() {
        moduleUtils.patchModule('node-redshift', 'query', nodeRedshiftWrapper, nodeRs => nodeRs.prototype);
    },
};
