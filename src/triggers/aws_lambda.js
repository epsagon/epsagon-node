/**
 * @fileoverview Trigger creation for aws-Lambda function invocations
 */
const uuid4 = require('uuid4');
const md5 = require('md5');
JSON.sortify = require('json.sortify');
const tryRequire = require('../try_require.js');
const serverlessEvent = require('../proto/event_pb.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');
const utils = require('../utils');
const resourceUtils = require('../resource_utils/sqs_utils.js');

const AWS = tryRequire('aws-sdk');

/**
 * Fills the common fields for a trigger event
 * @param {proto.event_pb.Event} trigger The trigger whose fields are being filled
 * @param {string} resourceType The type of the resource that initiated the trigger
 */
function fillCommonFields(trigger, resourceType) {
    trigger.setStartTime(utils.createTimestamp());
    trigger.setDuration(utils.createTimestampFromTime(0));
    trigger.setOrigin('trigger');
    trigger.getResource().setType(resourceType);
    trigger.setErrorCode(errorCode.ErrorCode.OK);
}

/**
 * Initializes an event representing a trigger to the lambda caused by JSON (invoke)
 * @param {object} event The event the Lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 * @param {object} context The context the Lambda was triggered with
 */
function createJSONTrigger(event, trigger, context) {
    const resource = trigger.getResource();
    trigger.setId(`trigger-${uuid4()}`);
    resource.setName(`trigger-${context.functionName}`);
    resource.setOperation('Event');
    eventInterface.addToMetadata(trigger, {}, {
        data: JSON.stringify(event),
    });
}

/**
 * Initializes an event representing a trigger to the lambda caused by S3
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createS3Trigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(event.Records[0].responseElements['x-amz-request-id']);
    resource.setName(event.Records[0].s3.bucket.name);
    resource.setOperation(event.Records[0].eventName);
    eventInterface.addToMetadata(trigger, {
        region: `${event.Records[0].awsRegion}`,
        request_parameters: JSON.stringify(event.Records[0].requestParameters),
        user_identity: JSON.stringify(event.Records[0].userIdentity),
        object_key: `${event.Records[0].s3.object.key}`,
        object_size: `${event.Records[0].s3.object.size}`,
        object_etag: `${event.Records[0].s3.object.eTag}`,
        'x-amz-request-id': `${event.Records[0].responseElements['x-amz-request-id']}`,
    });
}

/**
 * Initializes an event representing a trigger to the lambda caused by Kinesis
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createKinesisTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(event.Records[0].eventID);
    resource.setName(event.Records[0].eventSourceARN.split('/').pop());
    resource.setOperation(event.Records[0].eventName.replace('aws:kinesis:', ''));
    eventInterface.addToMetadata(trigger, {
        region: event.Records[0].awsRegion,
        invoke_identity: event.Records[0].invokeIdentityArn,
        sequence_number: event.Records[0].kinesis.sequenceNumber,
        partition_key: event.Records[0].kinesis.partitionKey,
    });
}

/**
 * Initializes an event representing a trigger to the lambda caused by SNS
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createSNSTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(event.Records[0].Sns.MessageId);
    resource.setName(event.Records[0].EventSubscriptionArn.split(':').slice(-2)[0]);
    resource.setOperation(event.Records[0].Sns.Type);
    eventInterface.addToMetadata(trigger, {
        'Notification Subject': event.Records[0].Sns.Subject,
    }, {
        'Notification Message': event.Records[0].Sns.Message,
    });
}

/**
 * Initializes an event representing a trigger to the lambda caused by SQS
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createSQSTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(event.Records[0].messageId);
    resource.setName(event.Records[0].eventSourceARN.split(':').slice(-1)[0]);
    resource.setOperation('ReceiveMessage');
    eventInterface.addToMetadata(trigger, {
        'MD5 Of Message Body': event.Records[0].md5OfBody,
        'Message Attributes': event.Records[0].attributes,
    }, {
        'Message Body': event.Records[0].body,
    });
    const snsData = resourceUtils.getSNSTrigger(event.Records);
    if (snsData != null) {
        eventInterface.addToMetadata(trigger, { 'SNS Trigger': snsData });
    }
}

/**
 * Initializes an event representing a trigger to the lambda caused by API Trigger
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createAPIGatewayTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(event.requestContext.requestId);
    resource.setName(event.resource);
    resource.setOperation(event.httpMethod);
    eventInterface.addToMetadata(trigger, {
        stage: event.requestContext.stage,
        query_string_parameters: JSON.stringify(event.queryStringParameters),
        path_parameters: JSON.stringify(event.pathParameters),
    }, {
        body: JSON.stringify(event.body),
        headers: JSON.stringify(event.headers),
        requestContext: JSON.stringify(event.requestContext),
    });
}

/**
 * Initializes an event representing a trigger to the lambda caused by No-Proxy API Trigger
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createNoProxyAPIGatewayTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(event.context['request-id']);
    resource.setName(event.context['resource-path']);
    resource.setOperation(event.context['http-method']);
    eventInterface.addToMetadata(trigger, {
        stage: event.context.stage,
        query_string_parameters: JSON.stringify(event.params.querystring),
        path_parameters: JSON.stringify(event.params.path),
    }, {
        body: JSON.stringify(event['body-json']),
        headers: JSON.stringify(event.params.header),
    });
}

/**
 * Initializes an event representing a trigger to the lambda caused by Events
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createEventsTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(event.id);
    resource.setName(event.resources[0].split('/').pop());
    resource.setOperation(event['detail-type']);
    eventInterface.addToMetadata(trigger, {
        region: event.region,
        detail: JSON.stringify(event.detail),
        account: event.account,
    });
}

/**
 * Initializes an event representing a trigger to the lambda caused by DynamoDB
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createDynamoDBTrigger(event, trigger) {
    const resource = trigger.getResource();
    const record = event.Records[0];
    let itemHash = '';
    if (AWS) {
        // in case of a delete - hash only the key.
        const item = (
            record.eventName === 'REMOVE' ?
                AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage) :
                AWS.DynamoDB.Converter.unmarshall(record.dynamodb.Keys)
        );
        itemHash = md5(JSON.sortify(item));
    }
    trigger.setId(record.eventID);
    resource.setName(record.eventSourceARN.split('/')[1]);
    resource.setOperation(record.eventName);
    eventInterface.addToMetadata(trigger, {
        region: record.awsRegion,
        sequence_number: record.dynamodb.SequenceNumber,
        item_hash: itemHash,
    });
}

/**
 * Initializes an event representing a trigger to the lambda caused by API Trigger
 * @param {object} event The event the lambda was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createElbTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(`elb-${uuid4()}`);
    resource.setName(event.path);
    resource.setOperation(event.httpMethod);
    eventInterface.addToMetadata(trigger, {
        query_string_parameters: JSON.stringify(event.queryStringParameters),
        target_group_arn: event.requestContext.elb.targetGroupArn,
    }, {
        body: JSON.stringify(event.body),
        headers: JSON.stringify(event.headers),
    });
}

const resourceTypeToFactoryMap = {
    s3: createS3Trigger,
    json: createJSONTrigger,
    kinesis: createKinesisTrigger,
    events: createEventsTrigger,
    sns: createSNSTrigger,
    sqs: createSQSTrigger,
    api_gateway: createAPIGatewayTrigger,
    api_gateway_no_proxy: createNoProxyAPIGatewayTrigger,
    dynamodb: createDynamoDBTrigger,
    elastic_load_balancer: createElbTrigger,
};


/**
 * Creates an {@link proto.event_pb.Event} describing the lambda trigger
 * @param {object} event The event the lambda was triggered with
 * @param {object} context The context the lambda was triggered with
 * @return {proto.event_pb.Event} The trigger of the lambda
 */
module.exports.createFromEvent = function createFromEvent(event, context) {
    let triggerService = 'json';
    if (event) {
        // eslint-disable-next-line
        console.log(event);
        if ('Records' in event) {
            if ('EventSource' in event.Records[0]) {
                triggerService = event.Records[0].EventSource.split(':').pop();
            }

            if ('eventSource' in event.Records[0]) {
                triggerService = event.Records[0].eventSource.split(':').pop();
            }
        } else if ('source' in event) {
            triggerService = event.source.split('.').pop();
        } else if (('requestContext' in event) && ('elb' in event.requestContext)) {
            triggerService = 'elastic_load_balancer';
        } else if ('httpMethod' in event) {
            triggerService = 'api_gateway';
        } else if (('context' in event) && ('http-method' in event.context)) {
            triggerService = 'api_gateway_no_proxy';
        } else if ('dynamodb' in event) {
            triggerService = 'dynamodb';
        }
    }

    const resource = new serverlessEvent.Resource();
    const trigger = new serverlessEvent.Event();
    trigger.setResource(resource);
    resourceTypeToFactoryMap[triggerService](event, trigger, context);
    fillCommonFields(trigger, triggerService);
    return trigger;
};
