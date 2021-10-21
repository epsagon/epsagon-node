/**
 * @fileoverview Handlers for the aws-sdk js library instrumentation.
 */
JSON.sortify = require('json.sortify');
const utils = require('../utils.js');
const tracer = require('../tracer');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const moduleUtils = require('./module_utils');

const SNSv3EventCreator = {
    /**
     * Updates an event with the appropriate fields from a SNS request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        // const parameters = request.params || {};
        const resource = event.getResource();
        const paramArn = request.input.TopicArn || request.input.TargetArn;
        resource.setName(`${paramArn.split(':').pop()}` || 'N/A');
        eventInterface.addToMetadata(event, {}, {
            'Notification Message': `${request.input.Message}`,
            'Notification Message Attributes': `${JSON.stringify(request.input.MessageAttributes)}`,
        });
    },

    /**
     * Updates an event with the appropriate fields from a SNS response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        eventInterface.addToMetadata(event, {
            'Message ID': `${response.MessageId}`,
        });
    },
};

/**
 * a map between AWS resource names and their appropriate creator object.
 */
const specificEventCreators = {
    sns: SNSv3EventCreator,
};

/**
 * Wraps the aws-sdk Request object send/promise function with tracing
 * @param {Function} wrappedFunction The function to wrap
 * @returns {Function} The wrapped function
 */
function AWSSDKWrapperSNSV3(wrappedFunction) {
    return function internalAWSSDKWrapper(callback) {
        try {
            const serviceIdentifier = this.config.serviceId.toLowerCase();
            const resourceName = ''; // sns
            // request.params ? request.params.FunctionName : 'lambda';
            const requestPayload = undefined; // request.params ? request.params.Payload : '';

            if (!(serviceIdentifier in specificEventCreators)) {
                // resource is not supported yet
                return wrappedFunction.apply(this, [callback]);
            }

            const resource = new serverlessEvent.Resource([
                resourceName,
                serviceIdentifier,
                `${wrappedFunction.name}`,
            ]);

            const startTime = Date.now();
            const awsEvent = new serverlessEvent.Event([
                '',
                utils.createTimestampFromTime(startTime),
                null,
                'aws-sdk',
                0,
                errorCode.ErrorCode.OK,
            ]);

            awsEvent.setResource(resource);
            eventInterface.addToMetadata(awsEvent, { payload: requestPayload });

            // if promies - use then
            // if async await - event emmiter
            let responsePromise = wrappedFunction.apply(this, [callback]);
            specificEventCreators[serviceIdentifier].requestHandler(
                callback,
                awsEvent
            );
            responsePromise = responsePromise.then((response) => {
                try {
                    awsEvent.setId(`${response.$metadata.requestId}`);
                    awsEvent.setDuration(utils.createDurationTimestamp(startTime));
                    if (response.MessageId !== null) {
                        awsEvent.setErrorCode(errorCode.ErrorCode.OK);
                        eventInterface.addToMetadata(awsEvent, {
                            request_id: `${response.$metadata.requestId}`,
                            attempts: `${response.$metadata.attempts}`,
                            status_code: `${response.$metadata.httpStatusCode}`,
                        });
                        specificEventCreators[serviceIdentifier].responseHandler(
                            response,
                            awsEvent
                        );
                    }
                } catch (e) {
                    tracer.addException(e);
                }
            }).catch((error) => {
                console.log(error);
                try {
                    eventInterface.setException(awsEvent, error); // todo: test
                    if (awsEvent.getErrorCode() !== errorCode.ErrorCode.EXCEPTION) {
                        awsEvent.setErrorCode(errorCode.ErrorCode.ERROR);
                    }
                    eventInterface.addToMetadata(awsEvent, {
                        request_id: `${error.$metadata.requestId}`,
                        error_message: `${error.message}`,
                        error_code: `${error.Code}`,
                    });
                } catch (e) {
                    // console.log(e);
                    tracer.addException(e);
                }
                throw error;
            });
            // .finally(() => {
            //     console.log('finally');
            // });
            tracer.addEvent(awsEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }
        return wrappedFunction.apply(this, [callback]);
    };
}

module.exports = {
    /**
     * Initializes the aws-sdk tracer
     */
    init() { // will catch 'publish', 'send.(PublishCommand)', listTables
        // moduleUtils.patchModule( // patch that will catch the publish function
        //     '@aws-sdk/client-sns',
        //     'publish',
        //     AWSSDKWrapperSNSV3,
        //     AWSmod => AWSmod.SNS.prototype
        // );
        // moduleUtils.patchModule( // will catch the publish
        //     '@aws-sdk/client-sns',
        //     'send',
        //     AWSSDKWrapperSNSV3,
        //     AWSmod => AWSmod.SNSClient.prototype
        // );
        moduleUtils.patchModule( // will catch publish
            '@aws-sdk/smithy-client',
            'send',
            AWSSDKWrapperSNSV3,
            AWSmod => AWSmod.Client.prototype
        );
    },
};
