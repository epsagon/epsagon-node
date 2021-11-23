const { SNSClient, PublishCommand, PublishBatchCommand } = require('@aws-sdk/client-sns');
const { expect, assert } = require('chai');
const epsagon = require('../../../src/index');
const tracerObj = require('../../../src/trace_object.js');
const consts = require('../consts.js');

describe('aws sdk v3 sns-client tests', () => {
    beforeEach(() => {
        epsagon.init({
            token: '',
            appName: consts.SNS_APP_NAME,
            metadataOnly: false,
        });
    });

    it('test instrumentation of publish to some non-existing sns', async () => {
        function publishSns() {
            const snsClient = new SNSClient({ region: consts.REGION });
            // The topic shouldn't really exist, as we only want to verify we get SNS trace.
            const params = {
                Message: consts.MESSAGE,
                TopicArn: consts.SNS_NON_EXISTING_ARN,
            };
            return snsClient.send(new PublishCommand(params));
        }
        const wrappedTestFunction = epsagon.nodeWrapper(publishSns);
        await wrappedTestFunction();
        const events = tracerObj.get().trace.getEventList();
        try {
            events.forEach((event) => {
                if (event.array[3] === '@aws-sdk') {
                    expect(event.array[2]).to.include('sns');
                    expect(event.array[2]).to.include('publish');
                }
            });
        } catch (err) {
            assert.fail();
        }
    });

    it('test instrumentation of publish batch to some non-existing sns', async () => {
        function publishSns() {
            const snsClient = new SNSClient({ region: consts.REGION });
            // The topic shouldn't really exist, as we only want to verify we get SNS trace.
            const entry = {
                Id: 'string',
                Message: consts.MESSAGE,
            };
            const params = {
                PublishBatchRequestEntries: [entry],
                TopicArn: consts.SNS_NON_EXISTING_ARN,
            };
            return snsClient.send(new PublishBatchCommand(params));
        }
        const wrappedTestFunction = epsagon.nodeWrapper(publishSns);
        await wrappedTestFunction();
        const events = tracerObj.get().trace.getEventList();
        try {
            events.forEach((event) => {
                if (event.array[3] === '@aws-sdk') {
                    expect(event.array[2]).to.include('sns');
                    expect(event.array[2]).to.include('publishBatch');
                }
            });
        } catch (err) {
            assert.fail();
        }
    });
});
