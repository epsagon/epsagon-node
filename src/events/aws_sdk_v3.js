/**
 * @fileoverview Handlers for the @aws-sdk js library instrumentation.
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
        switch (operation) {
        case 'publish':
            eventInterface.addToMetadata(event, {
                'Message ID': `${response.MessageId}`,
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
    default:
        return cmd;
    }
}

/**
 * Wraps the @aws-sdk sns-client commands
 * @param {Function} wrappedFunction The function to wrap
 * @returns {Function} The wrapped function
 */
function AWSSDKv3WrapperSNS(wrappedFunction) {
    return function internalAWSSDKv3WrapperSNS(command) {
        try {
            const serviceIdentifier = this.config.serviceId.toLowerCase();// sns
            const resourceName = '';
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
                'aws-sdk',
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
            '@aws-sdk/client-sns',
            'send',
            AWSSDKv3WrapperSNS,
            AWSmod => AWSmod.SNSClient.prototype
        );
        // Inorder to do instrumentation to more aws-sdk clients, we should
        // patch 'send' function in @aws-sdk/smithy-client. Talk to haddasbronfman
    },
};
