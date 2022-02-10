/**
 * @fileoverview Handlers for the @aws-sdk js library instrumentation.
 */
const md5 = require('md5');
const sortJson = require('sort-json');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const utils = require('../utils.js');
const tracer = require('../tracer');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const resourceUtils = require('../resource_utils/sqs_utils.js');
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

const SQSv3EventCreator = {
    /**
     * Updates an event with the appropriate fields from a SQS command
     * @param {string} operation the operation we wrapped.
     * @param {Command} command the wrapped command
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(operation, command, event) {
        const parameters = command.input || {};
        const resource = event.getResource();

        if ('QueueUrl' in parameters) {
            if (parameters.QueueUrl.split('/') != null &&
               parameters.QueueUrl.split('/') !== '') {
                resource.setName(`${parameters.QueueUrl.split('/').pop()}`);
            }
        }

        const entry = ('Entries' in parameters) ? parameters.Entries : parameters;
        if ('MessageBody' in entry) {
            eventInterface.addToMetadata(event, {}, {
                'Message Body': entry.MessageBody,
            });
        }

        if ('MessageAttributes' in entry) {
            eventInterface.addToMetadata(event, {}, {
                'Message Attributes': entry.MessageAttributes,
            });
        }
    },

    /**
     * Updates an event with the appropriate fields from a SQS response
     * @param {string} operation the operation we wrapped.
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(operation, response, event) {
        switch (operation) {
        case 'SendMessageCommand':
            eventInterface.addToMetadata(event, {
                'Message ID': `${response.MessageId}`,
                'MD5 Of Message Body': `${response.MD5OfMessageBody}`,
            });
            break;
        case 'ReceiveMessageCommand': {
            let messagesNumber = 0;
            if (('Messages' in response) && (response.Messages != null)) {
                messagesNumber = response.Messages.length;
                eventInterface.addToMetadata(event, {
                    'Message ID': `${response.Messages[0].MessageId}`,
                    'MD5 Of Message Body': `${response.Messages[0].MD5OfBody}`,
                });
                const snsData = resourceUtils.getSNSTrigger(response.Messages);
                if (snsData != null) {
                    eventInterface.addToMetadata(event, { 'SNS Trigger': snsData });
                }
            }
            eventInterface.addToMetadata(event, { 'Number Of Messages': messagesNumber });
            break;
        }
        default:
            break;
        }
    },
};

const DynamoDBv3EventCreator = {
    /**
     * Generates the Hash of a DynamoDB entry as should be sent to the server.
     * @param {Object} item The DynamoDB item to store
     * @return {string} The hash of the item
     */
    generateItemHash(item) {
        try {
            const unmarshalledItem = unmarshall(item);
            return md5(sortJson(unmarshalledItem), { ignoreCase: true });
        } catch (e) {
            tracer.addException(e);
        }
        return '';
    },

    /**
     * Updates an event with the appropriate fields from a dynamoDB command
     * @param {string} operation the operation we wrapped.
     * @param {Command} command the wrapped command
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(operation, command, event) {
        const resource = event.getResource();
        const parameters = command.input || {};
        resource.setName(command.input.TableName || 'DynamoDBEngine');

        switch (operation) {
        case 'DeleteCommand':
        case 'DeleteItemCommand':
            // on delete, hash only the key
            eventInterface.addToMetadata(event, {
                item_hash: this.generateItemHash(parameters.Key),
            });
            /* fallthrough */
        case 'GetCommand':
        case 'GetItemCommand':
            eventInterface.addToMetadata(event, {}, {
                Key: parameters.Key,
            });
            break;

        case 'PutCommand':
        case 'PutItemCommand':
            eventInterface.addToMetadata(event, {
                item_hash: this.generateItemHash(parameters.Item),
            }, {
                Item: JSON.stringify(parameters.Item),
            });
            break;

        case 'UpdateCommand':
        case 'UpdateItemCommand':
            eventInterface.addToMetadata(event, {
                Key: parameters.Key,
            }, {
                'Update Expression': JSON.stringify(
                    parameters.UpdateExpression
                ),
                'Expression Attribute Names': JSON.stringify(
                    parameters.ExpressionAttributeNames
                ),
                ReturnValues: JSON.stringify(
                    parameters.ReturnValues
                ),
            });
            break;

        case 'ScanCommand':
        case 'QueryCommand': {
            eventInterface.addObjectToMetadata(
                event,
                'Parameters',
                parameters,
                [
                    'KeyConditionExpression',
                    'FilterExpression',
                    'ExpressionAttributeValues',
                    'ProjectionExpression',
                ]
            );
            break;
        }

        case 'BatchWriteItemCommand': {
            const tableName = Object.keys(parameters.RequestItems)[0];
            resource.setName(tableName || parameters.TableName);
            const addedItems = [];
            const deletedKeys = [];
            parameters.RequestItems[tableName].forEach(
                (item) => {
                    if (item.PutRequest) {
                        addedItems.push(item.PutRequest.Item);
                    }
                    if (item.DeleteRequest) {
                        deletedKeys.push(item.DeleteRequest.Key);
                    }
                }
            );
            if (addedItems.length !== 0) {
                eventInterface.addToMetadata(event, {}, { 'Added Items': JSON.stringify(addedItems) });
            }
            if (deletedKeys.length !== 0) {
                eventInterface.addToMetadata(event, {}, { 'Deleted Keys': JSON.stringify(deletedKeys) });
            }
            break;
        }

        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from a DynamoDB response
     * @param {string} operation the operation we wrapped.
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(operation, response, event) {
        switch (operation) {
        case 'GetCommand':
        case 'GetItemCommand':
            eventInterface.addToMetadata(event, {}, {
                Item: JSON.stringify(response.Item),
            });
            break;

        case 'UpdateCommand':
            if (response.Attributes) {
                eventInterface.addToMetadata(event, {
                    item_hash: this.generateItemHash(response.Attributes),
                }, {});
            }
            break;

        case 'ListTablesCommand':
            eventInterface.addToMetadata(event, {
                'Table Names': response.TableNames.join(', '),
            });
            break;

        case 'ScanCommand':
        case 'QueryCommand': {
            eventInterface.addObjectToMetadata(
                event,
                'Response',
                response,
                ['Items', 'LastEvaluatedKey']
            );
            break;
        }

        case 'BatchWriteItemCommand': {
            if (response.UnprocessedItems) {
                const unprocessedItems = (Object.keys(response.UnprocessedItems));
                eventInterface.addToMetadata(event, {
                    unprocessedItems_count: unprocessedItems.length,
                });
            }
            break;
        }

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
    dynamodb: DynamoDBv3EventCreator,
    sqs: SQSv3EventCreator,
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
            '@aws-sdk/client-dynamodb', // A client that can catch all 'send' commands
            // sent from aws resources using aws-sdk v3.
            'send',
            AWSSDKv3Wrapper,
            AWSmod => AWSmod.DynamoDBClient.prototype
        );
        moduleUtils.patchModule(
            '@aws-sdk/client-sqs', // A client that can catch all 'send' commands
            // sent from aws resources using aws-sdk v3.
            'send',
            AWSSDKv3Wrapper,
            AWSmod => AWSmod.SQSClient.prototype
        );
        moduleUtils.patchModule(
            '@aws-sdk/smithy-client', // A client that can catch all 'send' commands
            // sent from aws resources using aws-sdk v3.
            'send',
            AWSSDKv3Wrapper,
            AWSmod => AWSmod.Client.prototype
        );
    },
};
