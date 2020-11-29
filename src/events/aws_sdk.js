/**
 * @fileoverview Handlers for the aws-sdk js library instrumentation.
 */
const md5 = require('md5');
const uuid4 = require('uuid4');
JSON.sortify = require('json.sortify');
const utils = require('../utils.js');
const tracer = require('../tracer');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const { STEP_ID_NAME } = require('../consts.js');
const resourceUtils = require('../resource_utils/sqs_utils.js');
const moduleUtils = require('./module_utils');
const tryRequire = require('../try_require');

const AWS = tryRequire('aws-sdk');

const AWS_TYPES = {
    kinesis: {
        putRecord: 'putRecord',
        putRecords: 'putRecords',
    },
};

const s3EventCreator = {
    /**
     * Updates an event with the appropriate fields from a S3 request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const { operation } = request;
        const resource = event.getResource();

        resource.setName(`${parameters.Bucket}`);

        switch (operation) {
        case 'headObject':
            // fall through
        case 'getObject':
            // fall through
        case 'putObject':
            resource.getMetadataMap().set('key', `${parameters.Key}`);
            break;
        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from a S3 response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        const resource = event.getResource();

        switch (response.request.operation) {
        case 'listObjects':
            resource.getMetadataMap().set(
                'files',
                response.data.Contents.map(
                    entry => [`${entry.Key}`, entry.Size, entry.Etag]
                ).toString()
            );
            break;

        case 'putObject':
            resource.getMetadataMap().set('etag', `${response.data.ETag.replace(/"/g, '')}`);
            break;

        case 'headObject':
            // fall through
        case 'getObject':
            eventInterface.addToMetadata(event, {
                etag: `${response.data.ETag.replace(/"/g, '')}`,
                file_size: `${response.data.ContentLength}`,
                last_modified: `${response.data.LastModified}`,
            });
            break;
        default:
            break;
        }
    },
};

const kinesisEventCreator = {
    /**
     * Updates an event with the appropriate fields from a Kinesis request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const resource = event.getResource();

        resource.setName(`${parameters.StreamName}`);
        if (request.operation !== AWS_TYPES.kinesis.putRecords) {
            eventInterface.addToMetadata(event, {
                partition_key: `${parameters.PartitionKey}`,
            }, {
                data: `${parameters.Data}`,
            });
        }
    },

    /**
     * Updates an event with the appropriate fields from a Kinesis response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case AWS_TYPES.kinesis.putRecord:
            eventInterface.addToMetadata(event, {
                shard_id: `${response.data.ShardId}`,
                sequence_number: `${response.data.SequenceNumber}`,
            });
            break;
        case AWS_TYPES.kinesis.putRecords:
            eventInterface.addToMetadata(event, {
                failed_record_count: `${response.data.FailedRecordCount}`,
                shard_id: `${response.data.Records[0].ShardId}`,
                sequence_number: `${response.data.Records[0].SequenceNumber}`,
            });
            break;
        default:
            break;
        }
    },
};

const SNSEventCreator = {
    /**
     * Updates an event with the appropriate fields from a SNS request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const resource = event.getResource();
        const paramArn = parameters.TopicArn || parameters.TargetArn;
        resource.setName(`${paramArn.split(':').pop()}` || 'N/A');
        eventInterface.addToMetadata(event, {}, {
            'Notification Message': `${parameters.Message}`,
            'Notification Message Attributes': `${JSON.stringify(parameters.MessageAttributes)}`,
        });
    },

    /**
     * Updates an event with the appropriate fields from a SNS response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'publish':
            eventInterface.addToMetadata(event, {
                'Message ID': `${response.data.MessageId}`,
            });
            break;
        default:
            break;
        }
    },
};

const SQSEventCreator = {
    /**
     * Updates an event with the appropriate fields from a SQS request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const resource = event.getResource();

        if ('QueueUrl' in parameters) {
            resource.setName(`${parameters.QueueUrl.split('/').pop()}`);
        }
        if ('QueueName' in parameters) {
            resource.setName(parameters.QueueName);
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
     * Updates an event with the appropriate fields from a SNS response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'sendMessage':
            eventInterface.addToMetadata(event, {
                'Message ID': `${response.data.MessageId}`,
                'MD5 Of Message Body': `${response.data.MD5OfMessageBody}`,
            });
            break;
        case 'receiveMessage': {
            let messagesNumber = 0;
            if (('Messages' in response.data) && (response.data.Messages.length > 0)) {
                messagesNumber = response.data.Messages.length;
                eventInterface.addToMetadata(event, {
                    'Message ID': `${response.data.Messages[0].MessageId}`,
                    'MD5 Of Message Body': `${response.data.Messages[0].MD5OfBody}`,
                });
                const snsData = resourceUtils.getSNSTrigger(response.data.Messages);
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

const SESEventCreator = {
    /**
     * Updates an event with the appropriate fields from a SES request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        switch (request.operation) {
        case 'sendEmail':
            eventInterface.addToMetadata(event, {
                source: `${parameters.Source}`,
                destination: `${parameters.Destination.ToAddresses}`,
            }, {
                subject: `${parameters.Message.Subject.Data}`,
                'Message Text': `${parameters.Message.Body.Text.Data}`,
                'Message Html': `${parameters.Message.Body.Html.Data}`,
            });
            break;
        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from a SES response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'sendEmail':
            eventInterface.addToMetadata(event, {
                message_id: `${response.data.MessageId}`,
            });
            break;
        default:
            break;
        }
    },
};

const lambdaEventCreator = {
    /**
     * Updates an event with the appropriate fields from a Lambda invoke request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const resource = event.getResource();
        utils.debugLog(`Got lambda event on function: ${parameters.FunctionName}`);
        const name = (parameters.FunctionName.includes(':')) ?
            parameters.FunctionName.split(':').slice(-1)[0] : parameters.FunctionName;
        resource.setName(name);
        eventInterface.addToMetadata(event, {}, {
            payload: `${parameters.Payload}`,
        });
    },

    /**
     * Updates an event with the appropriate fields from a Lambda invoke response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) { // eslint-disable-line no-unused-vars
    },
};

const dynamoDBEventCreator = {
    /**
     * Generates the Hash of a DynamoDB entry as should be sent to the server.
     * @param {Object} item The DynamoDB item to store
     * @return {string} The hash of the item
     */
    generateItemHash(item) {
        const unmarshalledItem = AWS.DynamoDB.Converter.unmarshall(item);
        return md5(JSON.sortify(unmarshalledItem));
    },

    /**
     * Updates an event with the appropriate fields from a DynamoDB request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const resource = event.getResource();
        const { operation } = request;

        resource.setName(parameters.TableName || 'DynamoDBEngine');
        switch (operation) {
        case 'deleteItem':
            // on delete, hash only the key
            eventInterface.addToMetadata(event, {
                item_hash: this.generateItemHash(parameters.Key),
            });
            /* fallthrough */
        case 'getItem':
            eventInterface.addToMetadata(event, {}, {
                Key: parameters.Key,
            });
            break;

        case 'putItem':
            eventInterface.addToMetadata(event, {
                item_hash: this.generateItemHash(parameters.Item),
            }, {
                Item: JSON.stringify(parameters.Item),
            });
            break;

        case 'updateItem':
            eventInterface.addToMetadata(event, {
                Key: parameters.Key,
                'Update Expression': JSON.stringify(
                    parameters.UpdateExpression
                ),
                'Expression Attribute Names': JSON.stringify(
                    parameters.ExpressionAttributeNames
                ),
                'Expression Attribute Values': JSON.stringify(
                    parameters.ExpressionAttributeValues
                ),
            });
            break;

        case 'query': {
            eventInterface.addObjectToMetadata(
                event,
                'Parameters',
                parameters,
                [
                    'KeyConditions',
                    'QueryFilter',
                    'ExclusiveStartKey',
                    'ProjectionExpression',
                    'FilterExpression',
                    'KeyConditionExpression',
                    'ExpressionAttributeValues',
                ]
            );
            break;
        }

        case 'scan': {
            eventInterface.addObjectToMetadata(
                event,
                'Parameters',
                parameters,
                [
                    'ScanFilter',
                    'ExclusiveStartKey',
                    'ProjectionExpression',
                    'FilterExpression',
                    'ExpressionAttributeValues',
                ]
            );
            break;
        }

        case 'batchWriteItem': {
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
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'getItem':
            eventInterface.addToMetadata(event, {}, {
                Item: JSON.stringify(response.data.Item),
            });
            break;

        case 'listTables':
            eventInterface.addToMetadata(event, {
                'Table Names': response.data.TableNames.join(', '),
            });
            break;

        case 'scan':
        case 'query': {
            eventInterface.addObjectToMetadata(
                event,
                'Response',
                response.data,
                ['Items', 'LastEvaluatedKey']
            );
            break;
        }

        default:
            break;
        }
    },
};

const athenaEventCreator = {
    /**
     * Updates an event with the appropriate fields from an Athena request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        switch (request.operation) {
        case 'startQueryExecution':
            if (('QueryExecutionContext' in parameters) &&
            ('Database' in parameters.QueryExecutionContext)) {
                eventInterface.addToMetadata(event, {
                    Database: `${parameters.QueryExecutionContext.Database}`,
                });
            }
            eventInterface.addToMetadata(event, {}, {
                Query: `${parameters.QueryString}`,
            });
            break;
        case 'getQueryExecution':
        case 'getQueryResults':
        case 'stopQueryExecution':
            eventInterface.addToMetadata(event, {
                'Query ID': `${parameters.QueryExecutionId}`,
            });
            break;
        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from an Athena response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'getQueryExecution':
            if (('Status' in response.data.QueryExecution) &&
            ('State' in response.data.QueryExecution.Status)) {
                eventInterface.addToMetadata(event, {
                    State: `${response.data.QueryExecution.Status.State}`,
                });
            }
            if (('ResultConfiguration' in response.data.QueryExecution) &&
            ('OutputLocation' in response.data.QueryExecution.Status)) {
                eventInterface.addToMetadata(event, {
                    'Result Location': `${response.data.QueryExecution.ResultConfiguration.OutputLocation}`,
                });
            }
            eventInterface.addToMetadata(event, {
                'Query ID': `${response.data.QueryExecutionId}`,
            }, {
                Query: `${response.data.Query}`,
            });
            break;
        case 'getQueryResults':
            eventInterface.addToMetadata(event, {
                'Query Row Count': `${response.data.ResultSet.Rows.length}`,
            });
            break;
        case 'startQueryExecution':
            eventInterface.addToMetadata(event, {
                'Query ID': `${response.data.QueryExecutionId}`,
            });
            break;
        default:
            break;
        }
    },
};

/**
 * Generate a new stpes_dict id, set the step number as -1 to mark the invoker,
 * and adding the new steps_dict to the event metadata.
 * @param {object} request The AWS.Request object
 * @param {string} paramsPropertyName relevant params property
 * @param {proto.event_pb.Event} event the event to update the new steps dict on
 */
const initializeStepsDict = (request, paramsPropertyName, event) => {
    const data = (request.params || {})[paramsPropertyName];
    let parsedData;
    try {
        // According to the docs input must be at least "{}". so if it is not
        // JSON parsable an error will be raised for sure and the machine won't
        // be invoked anyway.
        parsedData = JSON.parse(data);
    } catch (error) {
        parsedData = null;
    }
    if (parsedData) {
        parsedData[STEP_ID_NAME] = { id: uuid4(), step_num: -1 };
        request.params[paramsPropertyName] = JSON.stringify(parsedData);
        eventInterface.addToMetadata(event, {
            steps_dict: parsedData[STEP_ID_NAME],
        });
    }
};

const stepFunctionsEventCreator = {
    /**
     * Patches the input of a step functions AWS Request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    patchInput(request, event) {
        switch (request.operation) {
        case 'startExecution': {
            initializeStepsDict(request, 'input', event);
            break;
        }
        case 'sendTaskSuccess': {
            initializeStepsDict(request, 'output', event);
            break;
        }
        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from a stepFunctions request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params;
        const resource = event.getResource();
        switch (request.operation) {
        case 'startExecution':
            resource.setName(`${parameters.stateMachineArn.split(':').pop()}`);
            eventInterface.addToMetadata(event, {
                'State Machine ARN': `${parameters.stateMachineArn}`,
                'Execution Name': `${parameters.name}`,
            }, {
                Input: `${parameters.input}`,
            });
            break;

        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from a stepFunctions response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'startExecution':
            eventInterface.addToMetadata(event, {
                'Execution ARN': `${response.data.executionArn}`,
                'Start Date': `${response.data.startDate}`,
            });
            break;

        default:
            break;
        }
    },
};

const batchEventCreator = {
    /**
     * Updates an event with the appropriate fields from an AWS Batch request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const { operation } = request;
        const resource = event.getResource();


        switch (operation) {
        case 'submitJob': {
            resource.setName(`${parameters.jobName}`);
            const additionalData = {};
            if ('containerOverrides' in parameters) {
                additionalData['Container Overrides'] = parameters.containerOverrides;
            }
            if ('parameters' in parameters) {
                additionalData.Parameters = parameters.parameters;
            }

            eventInterface.addToMetadata(event, {
                'Job Definition': `${parameters.jobDefinition}`,
                'Job Queue': `${parameters.jobQueue}`,
            }, additionalData);
            break;
        }

        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from an AWS Batch response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'submitJob':
            eventInterface.addToMetadata(event, {
                'Job ID': `${response.data.jobId}`,
            });
            break;

        default:
            break;
        }
    },
};

const CloudWatchEventsEventCreator = {
    /**
     * Updates an event with the appropriate fields from an AWS CloudWatch Events request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const entry = parameters.Entries[0] || {};
        const { operation } = request;
        const resource = event.getResource();
        resource.setType('events');
        switch (operation) {
        case 'putEvents':
            resource.setName(entry.EventBusName || 'CloudWatch Events');
            eventInterface.addToMetadata(event, {
                'aws.cloudwatch.detail_type': entry.DetailType,
                'aws.cloudwatch.resources': entry.Resources,
                'aws.cloudwatch.source': entry.Source,
            }, {
                'aws.cloudwatch.detail': entry.Detail,
            });
            break;
        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from an AWS CloudWatch Events response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'putEvents':
            eventInterface.addToMetadata(event, {
                'aws.cloudwatch.event_id': `${response.data.Entries[0].EventId}`,
            });
            break;

        default:
            break;
        }
    },
};


const CloudWatchLogsEventCreator = {
    /**
     * Updates an event with the appropriate fields from an AWS CloudWatch Logs request
     * @param {object} request The AWS.Request object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    requestHandler(request, event) {
        const parameters = request.params || {};
        const { operation } = request;
        const resource = event.getResource();
        resource.setType('logs');
        switch (operation) {
        case 'filterLogEvents':
            resource.setName(parameters.logGroupName);
            eventInterface.addToMetadata(event, {
                'aws.cloudwatch.log_streams': request.logStreamNames,
                'aws.cloudwatch.start_time': request.startTime,
            });
            break;
        default:
            break;
        }
    },

    /**
     * Updates an event with the appropriate fields from an AWS CloudWatch Logs response
     * @param {object} response The AWS.Response object
     * @param {proto.event_pb.Event} event The event to update the data on
     */
    responseHandler(response, event) {
        switch (response.request.operation) {
        case 'filterLogEvents':
            eventInterface.addToMetadata(event, {
                'aws.cloudwatch.events_count': response.data.events.length,
                'aws.cloudwatch.searched_log_streams': response.data.searchedLogStreams.length,
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
    s3: s3EventCreator,
    kinesis: kinesisEventCreator,
    sns: SNSEventCreator,
    sqs: SQSEventCreator,
    ses: SESEventCreator,
    lambda: lambdaEventCreator,
    dynamodb: dynamoDBEventCreator,
    athena: athenaEventCreator,
    stepfunctions: stepFunctionsEventCreator,
    batch: batchEventCreator,
    cloudwatchevents: CloudWatchEventsEventCreator,
    cloudwatchlogs: CloudWatchLogsEventCreator,
};

/**
 * Wraps the aws-sdk Request object send/promise function with tracing
 * @param {Function} wrappedFunction The function to wrap
 * @returns {Function} The wrapped function
 */
function AWSSDKWrapper(wrappedFunction) {
    return function internalAWSSDKWrapper(callback) {
        try {
            const request = this;
            const { serviceIdentifier } = (
                request.service.constructor.prototype
            );
            if (!(serviceIdentifier in specificEventCreators)) {
                // resource is not supported yet
                return wrappedFunction.apply(this, [callback]);
            }

            const resource = new serverlessEvent.Resource([
                '',
                serviceIdentifier,
                `${request.operation}`,
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

            if ('patchInput' in specificEventCreators[serviceIdentifier]) {
                specificEventCreators[serviceIdentifier].patchInput(this, awsEvent);
            }

            const responsePromise = new Promise((resolve) => {
                request.on('send', () => {
                    try {
                        specificEventCreators[serviceIdentifier].requestHandler(
                            request,
                            awsEvent
                        );
                    } catch (e) {
                        tracer.addException(e);
                    }
                }).on('error', (error) => {
                    try {
                        eventInterface.setException(awsEvent, error);
                    } catch (e) {
                        tracer.addException(e);
                    }
                }).on('complete', (response) => {
                    try {
                        awsEvent.setId(`${response.requestId}`);
                        awsEvent.setDuration(utils.createDurationTimestamp(startTime));

                        if (response.data !== null) {
                            awsEvent.setErrorCode(errorCode.ErrorCode.OK);
                            eventInterface.addToMetadata(awsEvent, {
                                request_id: `${response.requestId}`,
                                retry_attempts: `${response.retryCount}`,
                                status_code: `${response.httpResponse.statusCode}`,
                            });

                            specificEventCreators[serviceIdentifier].responseHandler(
                                response,
                                awsEvent
                            );
                        }

                        if (response.error !== null) {
                            if (awsEvent.getErrorCode() !== errorCode.ErrorCode.EXCEPTION) {
                                awsEvent.setErrorCode(errorCode.ErrorCode.ERROR);
                            }

                            eventInterface.addToMetadata(awsEvent, {
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

            tracer.addEvent(awsEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }
        return wrappedFunction.apply(this, [callback]);
    };
}

/**
 * aws-sdk dynamically creates the `promise` function, so we have to re-wrap it
 * every time `addPromisesToClass` is called
 * @param {Function} wrappedFunction the `addPromisesToClass` function
 * @return {Function} The wrapped function
 */
function wrapPromiseOnAdd(wrappedFunction) {
    return function internalWrapPromiseOnAdd(promiseDependency) {
        const result = wrappedFunction.apply(this, [promiseDependency]);
        try {
            // it is OK to just re-wrap, as the original function overrides
            // `promise` anyway
            moduleUtils.patchModule(
                'aws-sdk',
                'promise',
                AWSSDKWrapper,
                AWSmod => AWSmod.Request.prototype
            );
        } catch (err) {
            utils.debugLog('Failed to re-instrument aws-sdk\'s promise method', err);
        }
        return result;
    };
}

module.exports = {
    /**
     * Initializes the aws-sdk tracer
     */
    init() {
        moduleUtils.patchModule(
            'aws-sdk',
            'send',
            AWSSDKWrapper,
            AWSmod => AWSmod.Request.prototype
        );
        moduleUtils.patchModule(
            'aws-sdk',
            'promise',
            AWSSDKWrapper,
            AWSmod => AWSmod.Request.prototype
        );

        // This method is static - not in prototype
        moduleUtils.patchModule(
            'aws-sdk',
            'addPromisesToClass',
            wrapPromiseOnAdd,
            AWSmod => AWSmod.Request
        );
    },

    /**
     * For DAX instrumentation
     */
    dynamoDBEventCreator,
};
