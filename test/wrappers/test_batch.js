const { expect } = require('chai');
const sinon = require('sinon');
const tracer = require('../../src/tracer.js');
const eventInterface = require('../../src/event.js');
const batchWrapper = require('../../src/wrappers/batch.js');
const batchRunner = require('../../src/runners/aws_batch.js');
const serverlessEvent = require('../../src/proto/event_pb.js');

describe('batchWrapper tests', () => {
    beforeEach(() => {
        this.restartStub = sinon.stub(
            tracer,
            'restart'
        );

        this.addEventStub = sinon.stub(
            tracer,
            'addEvent'
        );

        this.addExceptionStub = sinon.stub(
            tracer,
            'addException'
        );

        this.sendTraceStub = sinon.stub(
            tracer,
            'sendTrace'
        );

        this.sendTraceSyncStub = sinon.stub(
            tracer,
            'sendTraceSync'
        );

        this.setExceptionStub = sinon.stub(
            eventInterface,
            'setException'
        );

        this.processOnStub = sinon.stub(
            process,
            'on'
        );

        this.createRunnerStub = sinon.stub(
            batchRunner,
            'createRunner'
        );

        const resource = new serverlessEvent.Resource();
        const event = new serverlessEvent.Event();
        event.setResource(resource);
        this.createRunnerStub.returns({
            runner: event,
            runnerPromise: Promise.resolve(1),
        });
    });

    afterEach(() => {
        this.addEventStub.restore();
        this.addExceptionStub.restore();
        this.sendTraceStub.restore();
        this.sendTraceSyncStub.restore();
        this.restartStub.restore();
        this.setExceptionStub.restore();
        this.processOnStub.restore();
        this.createRunnerStub.restore();
    });

    it('wrapBatchJob: sanity', () => {
        batchWrapper.wrapBatchJob();
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.addEventStub.callCount).to.equal(1);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.callCount).to.equal(0);
        expect(this.sendTraceSyncStub.callCount).to.equal(0);
        expect(this.processOnStub.callCount).to.equal(2);
        this.processOnStub.getCall(1).args[1]();
        expect(this.sendTraceStub.callCount).to.equal(1);
    });

    it('wrapBatchJob: raised Error', () => {
        batchWrapper.wrapBatchJob();
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.addEventStub.callCount).to.equal(1);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.callCount).to.equal(0);
        expect(this.sendTraceSyncStub.callCount).to.equal(0);
        expect(this.processOnStub.callCount).to.equal(2);
        // simulate raising an error
        const err = new Error('err');
        this.processOnStub.getCall(0).args[1](err);
        expect(this.setExceptionStub.callCount).to.equal(1);
        this.processOnStub.getCall(1).args[1]();
        expect(this.sendTraceStub.callCount).to.equal(1);
    });
});
