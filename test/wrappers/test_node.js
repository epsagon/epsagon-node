const { expect } = require('chai');
const sinon = require('sinon');
const tracer = require('../../src/tracer.js');
const eventInterface = require('../../src/event.js');
const consts = require('../../src/consts.js');
const nodeWrapper = require('../../src/wrappers/node.js');
const errorCode = require('../../src/proto/error_code_pb.js');

describe('nodeWrapper tests', () => {
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

        this.stubFunction = sinon.stub();
        this.wrappedStub = nodeWrapper.nodeWrapper(this.stubFunction);
        consts.COLD_START = true;
    });

    afterEach(() => {
        this.addEventStub.restore();
        this.addExceptionStub.restore();
        this.sendTraceStub.restore();
        this.sendTraceSyncStub.restore();
        this.restartStub.restore();
        this.setExceptionStub.restore();
    });

    it('nodeWrapper: return a function', () => {
        expect(this.wrappedStub).to.be.a('function');
    });

    it('nodeWrapper: sanity', () => {
        this.wrappedStub(1, 2, 3);
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.addEventStub.callCount).to.equal(1);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.callCount).to.equal(1);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.setExceptionStub.called).to.be.false;
    });

    it('nodeWrapper: create correct runner event', () => {
        const wrappedFunction = function name() {};
        this.wrappedStub = nodeWrapper.nodeWrapper(wrappedFunction);
        this.wrappedStub(1, 2, 3);
        expect(this.addEventStub.callCount).to.equal(1);
        const runnerEvent = this.addEventStub.getCall(0).args[0];
        expect(runnerEvent.getId()).to.be.a('string');
        expect(runnerEvent.getStartTime()).to.be.a('number');
        expect(runnerEvent.getDuration()).to.be.a('number');
        expect(runnerEvent.getOrigin()).to.equal('runner');
        expect(runnerEvent.getErrorCode()).to.equal(errorCode.ErrorCode.OK);
        expect(runnerEvent.getException()).to.be.undefined;
        const resource = runnerEvent.getResource();
        expect(resource.getName()).to.equal('name');
        expect(resource.getType()).to.equal('node_function');
        expect(resource.getOperation()).to.equal('invoke');
        expect(resource.getMetadataMap().get('args_length')).to.equal(3);
    });

    it('nodeWrapper: wrapped function throws error', () => {
        this.stubFunction.throws();
        expect(() => this.wrappedStub(1, 2, 3)).to.throw();
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.addEventStub.callCount).to.equal(1);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.called).to.be.false;
        expect(this.sendTraceSyncStub.callCount).to.equal(1);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.setExceptionStub.callCount).to.equal(1);
    });

    it('nodeWrapper: update COLD_START value', () => {
        consts.COLD_START = true;
        this.wrappedStub(1, 2, 3);
        expect(consts.COLD_START).to.be.false;
    });

    it('nodeWrapper: COLD_START value should be false after more then 1 call', () => {
        consts.COLD_START = true;

        this.wrappedStub(1, 2, 3);
        expect(consts.COLD_START).to.be.false;

        this.wrappedStub(1, 2, 3);
        expect(consts.COLD_START).to.be.false;
    });
});
