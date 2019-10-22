/**
 * @fileoverview Instrumentation for google cloud common library.
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

const uriSplitString = 'googleapis.com/';

/**
 * Wraps the google makeRequest function.
 * @param {Function} wrappedFunction The makeRequest function
 * @returns {Function} The wrapped function
 */
function googleWrapper(wrappedFunction) {
    return function internalOWWrapper(reqOpts, config, callback) {
        const uri = reqOpts.uri.split(uriSplitString)[1];
        const splitUri = uri.split('/');
        const service = splitUri[0];
        const projectId = splitUri[3];
        const path = uri.split(`${projectId}/`)[1];
        const operation = path.split('/')[0];
        const resource = new serverlessEvent.Resource([
            projectId,
            service,
            operation,
        ]);
        const startTime = Date.now();
        const invokeEvent = new serverlessEvent.Event([
            `${service}-${uuid4()}`,
            utils.createTimestampFromTime(startTime),
            null,
            service,
            0,
            errorCode.ErrorCode.OK,
        ]);

        invokeEvent.setResource(resource);
        if (reqOpts.json !== undefined) {
            eventInterface.addToMetadata(
                invokeEvent,
                reqOpts.json
            );
        }

        let patchedCallback;
        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, body, response) => {
                invokeEvent.setDuration(utils.createDurationTimestamp(startTime));
                eventInterface.addToMetadata(invokeEvent, response.body);
                callback(err, body, response);
                resolve();
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
     * Initializes the google makeRequest tracer
     */
    init() {
        if (common) shimmer.wrap(common.util, 'makeRequest', googleWrapper);
    },
};
