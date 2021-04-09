/**
 * @fileoverview Trigger creation for Tencent function invocations
 */
const uuid4 = require('uuid4');
const serverlessEvent = require('../proto/event_pb.js');
const errorCode = require('../proto/error_code_pb.js');
const eventInterface = require('../event.js');
const utils = require('../utils');


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
 * Initializes an event representing a trigger to the Tencent Function caused by JSON (invoke)
 * @param {object} event The event the Tencent Function was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 * @param {object} context The context the Tencent Function was triggered with
 * @param {object} runner The original runner
 */
function createJSONTrigger(event, trigger, context, runner) {
    eventInterface.addToMetadata(runner, {}, {
        'tencent.scf.trigger_data': event,
    });
}

/**
 * Initializes an event representing a trigger to the Tencent Function caused by a timer
 * @param {object} event The event the Tencent Function was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createTimerTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(`timer-${uuid4()}`);
    resource.setName(event.TriggerName);
    resource.setOperation('Timer');
    eventInterface.addToMetadata(trigger, {
        'tencent.timer.timestamp': event.Time,
    }, {
        'tencent.timer.message': event.Message,
    });
}


/**
 * Initializes an event representing a trigger to the Tencent Function caused by COS
 * @param {object} event The event the Tencent Function was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createCOSTrigger(event, trigger) {
    const record = event.Records[0];
    const resource = trigger.getResource();
    trigger.setId(record.cos.cosObject.meta['x-cos-request-id']);
    resource.setName(`${record.cos.cosBucket.name}-${record.cos.cosBucket.appid}`);
    resource.setOperation(record.event.eventName.replace('cos:', ''));
    eventInterface.addToMetadata(trigger, {
        'tencent.region': record.cos.cosBucket.cosRegion,
        'tencent.app_id': record.cos.cosBucket.appid,
        'tencent.cos.object_key': record.cos.cosObject.key,
        'tencent.cos.object_size': record.cos.cosObject.size,
        'tencent.cos.request_id': record.cos.cosObject.meta['x-cos-request-id'],
    });
}


/**
 * Initializes an event representing a trigger to the Tencent Function caused by CMQ
 * @param {object} event The event the Tencent Function was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createCMQTrigger(event, trigger) {
    const record = event.Records[0].CMQ;
    const resource = trigger.getResource();
    trigger.setId(record.msgId);
    resource.setName(record.topicName);
    resource.setOperation('consume');
    eventInterface.addToMetadata(trigger, {
        'tencent.cmq.message.id': record.msgId,
        'tencent.cmq.message.tags': record.msgTag,
        'tencent.cmq.request_id': record.requestId,
        'tencent.cmq.subscription_name': record.subscriptionName,
    }, {
        'tencent.cmq.message.body': record.msgBody,
    });
}


/**
 * Initializes an event representing a trigger to the Tencent Function caused by CKafka
 * @param {object} event The event the Tencent Function was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createKafkaTrigger(event, trigger) {
    const record = event.Records[0].Ckafka;
    const resource = trigger.getResource();
    trigger.setId(record.msgKey);
    resource.setName(record.topic);
    resource.setOperation('consume');
    eventInterface.addToMetadata(trigger, {
        'messaging.message.partition': record.partition,
        'messaging.message.offset': record.offset,
        'messaging.message.key': record.msgKey,
    }, {
        'messaging.message.body': record.msgBody,
    });
}


/**
 * Initializes an event representing a trigger to the Tencent Function caused by APIGW
 * @param {object} event The event the Tencent Function was triggered with
 * @param {proto.event_pb.Event} trigger An Event to initialize as the trigger
 */
function createAPIGatewayTrigger(event, trigger) {
    const resource = trigger.getResource();
    trigger.setId(event.requestContext.requestId);
    resource.setName(event.headers.Host);
    resource.setOperation(event.httpMethod);
    eventInterface.addToMetadata(trigger, {
        'http.route': event.requestContext.path,
        'http.request.path': event.path,
        'tencent.api_gateway.request_id': event.requestContext.requestId,
        'tencent.api_gateway.stage': event.requestContext.stage,
    }, {
        'http.request.headers': event.headers,
        'http.request.body': event.body,
        'http.request.path_params': event.pathParameters,
        'http.request.query': event.queryString,
    });
}


const resourceTypeToFactoryMap = {
    json: createJSONTrigger,
    timer: createTimerTrigger,
    http: createAPIGatewayTrigger,
    cos: createCOSTrigger,
    cmq: createCMQTrigger,
    kafka: createKafkaTrigger,
};


/**
 * Creates an {@link proto.event_pb.Event} describing the Tencent Function trigger
 * @param {object} event The event the Tencent Function was triggered with
 * @param {object} context The context the Tencent Function was triggered with
 * @param {object} runner The Tencent Function runner event
 * @return {proto.event_pb.Event} The trigger of the Tencent Function
 */
module.exports.createFromEvent = function createFromEvent(event, context, runner) {
    let triggerService = 'json';

    if (event) {
        if ('Type' in event && event.Type === 'Timer') {
            triggerService = 'timer';
        } else if ('httpMethod' in event) {
            triggerService = 'http';
        } else if ('Records' in event) {
            if ('cos' in event.Records[0]) {
                triggerService = 'cos';
            } else if ('CMQ' in event.Records[0]) {
                triggerService = 'cmq';
            } else if ('Ckafka' in event.Records[0]) {
                triggerService = 'kafka';
            }
        }
    }

    const resource = new serverlessEvent.Resource();
    const trigger = new serverlessEvent.Event();
    trigger.setResource(resource);
    resourceTypeToFactoryMap[triggerService](event, trigger, context, runner);
    fillCommonFields(trigger, triggerService);
    return trigger;
};
