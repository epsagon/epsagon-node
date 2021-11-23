/**
 * @fileoverview Handlers for the @aws-sdk js library instrumentation.
 */
const utils = require('../utils.js');
const tracer = require('../tracer');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const moduleUtils = require('./module_utils');

const SNSv3EventCreator = {
    /**
     * Updates an event with the appropriate fields from a SNS command
     * @param {string} operation the operation we wrapped.
     * @param {Command} command the wrapped command
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(operation, command, event) {
        switch (operation) {
        case 'publish': {
            const resource = event.getResource();
            const paramArn = command.input.TopicArn || command.input.TargetArn;
            resource.setName(`${paramArn.split(':').pop()}` || 'N/A');
            eventInterface.addToMetadata(event, {}, {
                'Notification Message': `${command.input.Message}`,
                'Notification Message Attributes': `${JSON.stringify(command.input.MessageAttributes)}`,
            });
            break;
        }
        case 'publishBatch': {
            const resource = event.getResource();
            const paramArn = command.input.TopicArn || command.input.TargetArn;
            resource.setName(`${paramArn.split(':').pop()}` || 'N/A');
            eventInterface.addToMetadata(event, {}, {
                'Notification Message Attributes': `${JSON.stringify(command.input.MessageAttributes)}`,
            });
            break;
        }
        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from a SNS response
     * @param {string} operation the operation we wrapped.
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(operation, response, event) {
        let errorMessages = '';
        let errorMessagesCount = 0;
        switch (operation) {
        case 'publish':
            eventInterface.addToMetadata(event, {
                'Message ID': `${response.MessageId}`,
            });
            break;
        case 'publishBatch':
            if (response.Successful && response.Successful.length > 0) {
                eventInterface.addToMetadata(event, {
                    record: JSON.stringify(response.Successful.map(item => item)),
                });
            }
            if (response.Failed && response.Failed > 0) {
                errorMessages = JSON.stringify(response.Failed
                    .map(item => item));
                errorMessagesCount = response.Failed.length;
            }
            eventInterface.addToMetadata(event, {
                successful_record_count: `${response.Successful.length}`,
                failed_record_count: `${errorMessagesCount}`,
                sqs_error_messages: errorMessages,
            });
            break;
        default:
            break;
        }
    },
};

/**
 * a map between AWS resource names and their appropriate creator object.
 */
const specificEventCreators = {
    sns: SNSv3EventCreator,
};

/**
 *
 * @param {Command} command the wrapped command
 * @returns {operation} operation name
 */
function getOperationByCommand(command) {
    const cmd = command.constructor.name;
    switch (cmd) {
    case 'PublishCommand':
        return 'publish';
    case 'PublishBatchCommand':
        return 'publishBatch';
    default:
        return cmd;
    }
}

/**
 * Wraps the @aws-sdk sns-client commands
 * @param {Function} wrappedFunction The function to wrap
 * @returns {Function} The wrapped function
 */
function AWSSDKv3Wrapper(wrappedFunction) {
    return function internalAWSSDKv3Wrapper(command) {
        try {
            const serviceIdentifier = this.config.serviceId.toLowerCase();
            const resourceName = '';

            if (!(serviceIdentifier in specificEventCreators)) {
                // resource is not supported yet
                return wrappedFunction.apply(this, [command]);
            }

            const operation = getOperationByCommand(command);
            const resource = new serverlessEvent.Resource([
                resourceName,
                serviceIdentifier,
                `${operation}`,
            ]);

            const startTime = Date.now();
            const awsEvent = new serverlessEvent.Event([
                '',
                utils.createTimestampFromTime(startTime),
                null,
                '@aws-sdk',
                0,
                errorCode.ErrorCode.OK,
            ]);
            awsEvent.setResource(resource);

            let responsePromise = wrappedFunction.apply(this, [command]);
            specificEventCreators[serviceIdentifier].requestHandler(
                operation,
                command,
                awsEvent
            );
            responsePromise = responsePromise.then((response) => {
                try {
                    awsEvent.setDuration(utils.createDurationTimestamp(startTime));
                    if (response.$metadata !== null) {
                        awsEvent.setId(`${response.$metadata.requestId}`);
                        awsEvent.setErrorCode(errorCode.ErrorCode.OK);
                        eventInterface.addToMetadata(awsEvent, {
                            request_id: `${response.$metadata.requestId}`,
                            attempts: `${response.$metadata.attempts}`,
                            status_code: `${response.$metadata.httpStatusCode}`,
                        });
                        specificEventCreators[serviceIdentifier].responseHandler(
                            operation,
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
                    eventInterface.setException(awsEvent, error);
                    if (awsEvent.getErrorCode() !== errorCode.ErrorCode.EXCEPTION) {
                        awsEvent.setErrorCode(errorCode.ErrorCode.ERROR);
                    }
                    eventInterface.addToMetadata(awsEvent, {
                        request_id: `${error.$metadata.requestId}`,
                        error_message: `${error.message}`,
                        error_code: `${error.Code}`,
                    });
                } catch (e) {
                    tracer.addException(e);
                }
                throw error;
            });
            tracer.addEvent(awsEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }
        return wrappedFunction.apply(this, [command]);
    };
}

module.exports = {
    /**
     * Initializes the @aws-sdk tracer
     */
    init() {
        moduleUtils.patchModule(
            '@aws-sdk/smithy-client', // A client that can catch all 'send' commands
            // sent from aws resources using aws-sdk v3.
            'send',
            AWSSDKv3Wrapper,
            AWSmod => AWSmod.Client.prototype
        );
    },
};
