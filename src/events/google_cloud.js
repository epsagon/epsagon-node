/**
 * @fileoverview Instrumentation for google cloud library.
 */
const uuid4 = require('uuid4');
const shimmer = require('shimmer');
const tryRequire = require('../try_require.js');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

const common = tryRequire('@google-cloud/common/');

const URL_SPLIT_STRING = 'googleapis.com/';

/**
 * Wraps the bigQuery makeRequest function.
 * @param {Function} wrappedFunction The makeRequest function
 * @returns {Function} The wrapped function
 */
function bigQueryWrapper(wrappedFunction) {
    return function internalOWWrapper(reqOpts, config, callback) {
        const uri = reqOpts.uri.split(URL_SPLIT_STRING)[1] || '';
        const splitUri = uri.split('/');
        const service = splitUri[0] || 'google-cloud';
        const projectId = splitUri[3] || 'Unknown';
        const path = uri.split(`${projectId}/`)[1];
        const operation = path.split('/')[0] || 'Unknown';
        const resource = new serverlessEvent.Resource([
            projectId,
            service,
            operation,
        ]);

        const startTime = Date.now();
        let eventName = `${service}-${uuid4()}`;
        let jsonMetadata = {};

        if (reqOpts.json !== undefined) {
            eventName = reqOpts.json.jobReference.jobId;
            jsonMetadata = reqOpts.json;
        }
        else if (reqOpts.uri !== undefined) {
            // eslint-disable-next-line
            eventName = reqOpts.uri.split('/')[8];
        }
        const invokeEvent = new serverlessEvent.Event([
            eventName,
            utils.createTimestampFromTime(startTime),
            null,
            service,
            0,
            errorCode.ErrorCode.OK,
        ]);

        invokeEvent.setResource(resource);
        eventInterface.addToMetadata(
            invokeEvent,
            {},
            jsonMetadata
        );

        let patchedCallback;
        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, body, response) => {
                invokeEvent.setDuration(utils.createDurationTimestamp(startTime));
                eventInterface.addToMetadata(invokeEvent, {}, response.body);
                resolve();
                callback(err, body, response);
            };
        }).catch((err) => {
            tracer.addException(err);
        });

        tracer.addEvent(invokeEvent, responsePromise);
        return wrappedFunction.apply(this, [reqOpts, config, patchedCallback]);
    };
}

module.exports = {
    /**
     * Initializes the bigQuery makeRequest tracer
     */
    init() {
        if (common) shimmer.wrap(common.util, 'makeRequest', bigQueryWrapper);
    },
};
