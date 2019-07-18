/**
 * @fileoverview Handlers for the amazon-dax-client js library instrumantation.
 */
const shimmer = require('shimmer');
const tracer = require('../tracer');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const tryRequire = require('../try_require.js');
const utils = require('../utils.js');
const { dynamoDBEventCreator } = require('./aws_sdk.js');

const AmazonDaxClient = tryRequire('amazon-dax-client');

/**
 * Wraps the Dax client request methods with tracing
 * @param {Function} wrappedFunction The function to wrap
 * @returns {Function} The wrapped function
 */
function DAXWrapper(wrappedFunction) {
    return function internalDAXWrapper(opname, params, operation, callback) {
        const resource = new serverlessEvent.Resource([
            '',
            'dax',
            `${opname}`,
        ]);
        const startTime = Date.now();
        const daxEvent = new serverlessEvent.Event([
            '',
            utils.createTimestampFromTime(startTime),
            null,
            'amazon-dax-client',
            0,
            errorCode.ErrorCode.OK,
        ]);
        daxEvent.setResource(resource);
        try {
            dynamoDBEventCreator.requestHandler(
                {
                    params,
                    operation: opname,
                },
                daxEvent
            );
        } catch (e) {
            tracer.addException(e);
        }
        const request = wrappedFunction.apply(this, [opname, params, operation, callback]);
        try {
            const responsePromise = new Promise((resolve) => {
                request.once('error', (error) => {
                    try {
                        eventInterface.setException(daxEvent, error);
                    } catch (e) {
                        tracer.addException(e);
                    }
                    if (request.listenerCount('error') === 0) {
                        throw error; // no error listener, we should explode
                    }
                }).on('complete', (response) => {
                    try {
                        daxEvent.setId(`${response.requestId}`);
                        daxEvent.setDuration(utils.createDurationTimestamp(startTime));

                        if (response.data !== null) {
                            daxEvent.setErrorCode(errorCode.ErrorCode.OK);
                            eventInterface.addToMetadata(daxEvent, {
                                request_id: `${response.requestId}`,
                                retry_attempts: `${response.retryCount}`,
                                status_code: `${response.httpResponse.statusCode}`,
                            });

                            dynamoDBEventCreator.responseHandler(
                                response,
                                daxEvent
                            );
                        }

                        if (response.error !== null) {
                            if (daxEvent.getErrorCode() !== errorCode.ErrorCode.EXCEPTION) {
                                daxEvent.setErrorCode(errorCode.ErrorCode.ERROR);
                            }

                            eventInterface.addToMetadata(daxEvent, {
                                request_id: `${response.requestId}`,
                                error_message: `${response.error.message}`,
                                error_code: `${response.error.code}`,
                            });
                        }
                    } catch (e) {
                        tracer.addException(e);
                    } finally {
                        resolve();
                    }
                });
            });
            tracer.addEvent(daxEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }
        return request;
    };
}

module.exports = {
    /**
   * Initializes the dax tracer
   */
    init() {
        if (AmazonDaxClient) {
            shimmer.wrap(AmazonDaxClient.prototype, '_makeWriteRequestWithRetries', DAXWrapper);
            shimmer.wrap(AmazonDaxClient.prototype, '_makeReadRequestWithRetries', DAXWrapper);
        }
    },
};
