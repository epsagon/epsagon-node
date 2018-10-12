const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noPreserveCache();
const tracer = require('../../src/tracer.js');
const eventInterface = require('../../src/event.js');
const consts = require('../../src/consts.js');
const awsLambdaTrigger = require('../../src/triggers/aws_lambda.js');
const lambdaWrapper = require('../../src/wrappers/lambda.js');
const errorCode = require('../../src/proto/error_code_pb.js');

describe('lambdaWrapper tests', () => {
    beforeEach(() => {
        this.createFromEventStub = sinon.stub(
            awsLambdaTrigger,
            'createFromEvent'
        ).returns('trigger');

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
        ).returns(Promise.resolve('success'));

        this.sendTraceSyncStub = sinon.stub(
            tracer,
            'sendTraceSync'
        );

        this.setExceptionStub = sinon.stub(
            eventInterface,
            'setException'
        );

        this.stubFunction = sinon.stub().callsArgWith(2, null, 'success');
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        this.callbackStub = sinon.stub();
        this.context = {
            callbackWaitsForEmptyEventLoop: true,
        };
        consts.COLD_START = true;
    });

    afterEach(() => {
        this.createFromEventStub.restore();
        this.addEventStub.restore();
        this.addExceptionStub.restore();
        this.sendTraceStub.restore();
        this.sendTraceSyncStub.restore();
        this.restartStub.restore();
        this.setExceptionStub.restore();
    });

    it('lambdaWrapper: return a function', () => {
        expect(this.wrappedStub).to.be.a('function');
    });

    it('lambdaWrapper: sanity', (done) => {
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(2);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            done();
        }, 1);
    });

    it('lambdaWrapper: create correct runner event', () => {
        const contextData = {
            functionName: 'functionName',
            awsRequestId: 'awsRequestId',
            logStreamName: 'logStreamName',
            logGroupName: 'logGroupName',
            functionVersion: 'functionVersion',
            memoryLimitInMB: 'memoryLimitInMB',
            invokedFunctionArn: '0:1:2:3:4:5:6',
        };
        Object.assign(this.context, contextData);

        this.wrappedStub({}, this.context, this.callbackStub);
        const runnerEvent = this.addEventStub.getCall(0).args[0];
        expect(runnerEvent.getId()).to.equal('awsRequestId');
        expect(runnerEvent.getStartTime()).to.be.ok;
        expect(runnerEvent.getOrigin()).to.equal('runner');
        expect(runnerEvent.getErrorCode()).to.equal(errorCode.ErrorCode.OK);
        expect(runnerEvent.getException()).to.be.undefined;
        const resource = runnerEvent.getResource();
        expect(resource.getName()).to.equal('functionName');
        expect(resource.getType()).to.equal('lambda');
        expect(resource.getOperation()).to.equal('invoke');
        expect(resource.getMetadataMap().get('log_stream_name')).to.equal('logStreamName');
        expect(resource.getMetadataMap().get('log_group_name')).to.equal('logGroupName');
        expect(resource.getMetadataMap().get('function_version')).to.equal('functionVersion');
        expect(resource.getMetadataMap().get('cold_start')).to.equal('true');
        expect(resource.getMetadataMap().get('memory')).to.equal('memoryLimitInMB');
        expect(resource.getMetadataMap().get('region')).to.equal(consts.REGION);
        expect(resource.getMetadataMap().get('aws_account')).to.equal('4');
    });

    it('lambdaWrapper: trigger creation failure', (done) => {
        this.createFromEventStub.reset();
        this.createFromEventStub.throws();
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            expect(this.addExceptionStub.callCount).to.equal(1);
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            done();
        }, 1);
    });

    it('lambdaWrapper: wrapped function throws error', () => {
        this.stubFunction.reset();
        this.stubFunction.throws();
        expect(() => this.wrappedStub(
            {},
            this.context,
            this.callbackStub
        )).to.throw();
        expect(this.createFromEventStub.callCount).to.equal(1);
        expect(this.createFromEventStub.calledWith({}));
        expect(this.addEventStub.callCount).to.equal(2);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.callCount).to.equal(0);
        expect(this.sendTraceSyncStub.callCount).to.equal(1);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.callbackStub.called).to.be.false;
        expect(this.setExceptionStub.callCount).to.equal(1);
    });

    it('lambdaWrapper: wrapped callback error call', (done) => {
        this.stubFunction.callsArgWith(2, new Error());
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(2);
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.callCount).to.equal(1);
            done();
        }, 1);
    });

    it('lambdaWrapper: update COLD_START value', () => {
        consts.COLD_START = true;
        this.wrappedStub({}, this.context, this.callbackStub);
        expect(consts.COLD_START).to.be.false;
    });

    it('lambdaWrapper: COLD_START value should be false after more then 1 call', () => {
        consts.COLD_START = true;

        this.wrappedStub({}, this.context, this.callbackStub);
        expect(consts.COLD_START).to.be.false;

        this.wrappedStub({}, this.context, this.callbackStub);
        expect(consts.COLD_START).to.be.false;
    });

    it('lambdaWrapper: null context', () => {
        this.stubFunction = sinon.spy(() => 'success');
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        expect(this.wrappedStub({}, null, this.callbackStub)).to.equal('success');
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.createFromEventStub.callCount).to.equal(0);
        expect(this.addEventStub.callCount).to.equal(0);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.callCount).to.equal(0);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.callbackStub.called).to.be.false;
        expect(this.setExceptionStub.called).to.be.false;
    });

    it('lambdaWrapper: callback doesnt wait for empty event loop', (done) => {
        this.context.callbackWaitsForEmptyEventLoop = false;
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(2);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceSyncStub.callCount).to.equal(1);
            expect(this.sendTraceStub.callCount).to.equal(0);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            done();
        }, 1);
    });

    it('lambdaWrapper: callback not called', (done) => {
        this.stubFunction = sinon.spy(() => { done(); });
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        expect(this.wrappedStub({}, null, this.callbackStub)).to.equal(undefined);
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.createFromEventStub.callCount).to.equal(0);
        expect(this.addEventStub.callCount).to.equal(0);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.callCount).to.equal(0);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.callbackStub.called).to.be.false;
        expect(this.setExceptionStub.called).to.be.false;
    });

    it('lambdaWrapper: return called', (done) => {
        this.stubFunction = sinon.spy(() => { done(); return 42; });
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        expect(this.wrappedStub({}, null, this.callbackStub)).to.equal(42);
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.createFromEventStub.callCount).to.equal(0);
        expect(this.addEventStub.callCount).to.equal(0);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.callCount).to.equal(0);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.callbackStub.called).to.be.false;
        expect(this.setExceptionStub.called).to.be.false;
    });
});

describe('stepLambdaWrapper tests', () => {
    beforeEach(() => {
        this.createFromEventStub = sinon.stub(
            awsLambdaTrigger,
            'createFromEvent'
        ).returns('trigger');

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
        ).returns(Promise.resolve('success'));

        this.sendTraceSyncStub = sinon.stub(
            tracer,
            'sendTraceSync'
        );

        this.setExceptionStub = sinon.stub(
            eventInterface,
            'setException'
        );

        this.uuid4Stub = sinon.stub().returns(1);
        this.lambdaWithPatchedDeps = proxyquire(
            '../../src/wrappers/lambda.js',
            {
                uuid4: this.uuid4Stub,
                '../tracer.js': tracer,
                '../event.js': eventInterface,
                '../triggers/aws_lambda.js': awsLambdaTrigger,
            }
        );

        this.stubFunction = sinon.stub().callsArgWith(2, null, { result: 1 });
        this.wrappedStub = this.lambdaWithPatchedDeps.stepLambdaWrapper(this.stubFunction);
        this.callbackStub = sinon.stub();
        this.context = {
            callbackWaitsForEmptyEventLoop: true,
        };
        consts.COLD_START = true;
    });

    afterEach(() => {
        this.createFromEventStub.restore();
        this.addEventStub.restore();
        this.addExceptionStub.restore();
        this.sendTraceStub.restore();
        this.sendTraceSyncStub.restore();
        this.restartStub.restore();
        this.setExceptionStub.restore();
    });

    it('stepLambdaWrapper: return a function', () => {
        expect(this.wrappedStub).to.be.a('function');
    });

    it('stepLambdaWrapper: sanity first step', (done) => {
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            const result = this.callbackStub.getCall(0).args[1];
            expect(result).to.contain.key('Epsagon');
            expect(result).to.contain.key('result');
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(2);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            expect(this.uuid4Stub.calledOnce).to.be.true;
            done();
        }, 1);
    });

    it('stepLambdaWrapper: sanity not first step', (done) => {
        this.wrappedStub(
            { Epsagon: { id: 1, step_num: 2 } },
            this.context,
            this.callbackStub
        );
        setTimeout(() => {
            const result = this.callbackStub.getCall(0).args[1];
            expect(result).to.contain.key('Epsagon');
            expect(result.Epsagon.step_num).to.equal(3);
            expect(result).to.contain.key('result');
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(2);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            expect(this.uuid4Stub.called).to.be.false;
            done();
        }, 1);
    });

    it('stepLambdaWrapper: create correct runner event', () => {
        const contextData = {
            functionName: 'functionName',
            awsRequestId: 'awsRequestId',
            logStreamName: 'logStreamName',
            logGroupName: 'logGroupName',
            functionVersion: 'functionVersion',
            memoryLimitInMB: 'memoryLimitInMB',
            invokedFunctionArn: '0:1:2:3:4:5:6',
        };

        Object.assign(this.context, contextData);

        this.wrappedStub({}, this.context, this.callbackStub);
        const runnerEvent = this.addEventStub.getCall(0).args[0];
        expect(runnerEvent.getId()).to.equal('awsRequestId');
        expect(runnerEvent.getStartTime()).to.be.ok;
        expect(runnerEvent.getOrigin()).to.equal('runner');
        expect(runnerEvent.getErrorCode()).to.equal(errorCode.ErrorCode.OK);
        expect(runnerEvent.getException()).to.be.undefined;
        const resource = runnerEvent.getResource();
        expect(resource.getName()).to.equal('functionName');
        expect(resource.getType()).to.equal('step_function_lambda');
        expect(resource.getOperation()).to.equal('invoke');
        expect(resource.getMetadataMap().get('log_stream_name')).to.equal('logStreamName');
        expect(resource.getMetadataMap().get('log_group_name')).to.equal('logGroupName');
        expect(resource.getMetadataMap().get('function_version')).to.equal('functionVersion');
        expect(resource.getMetadataMap().get('cold_start')).to.equal('true');
        expect(resource.getMetadataMap().get('memory')).to.equal('memoryLimitInMB');
        expect(resource.getMetadataMap().get('region')).to.equal(consts.REGION);
        expect(resource.getMetadataMap().get('aws_account')).to.equal('4');
    });

    it('stepLambdaWrapper: wrapped function dont return object', (done) => {
        this.stubFunction.callsArgWith(2, null, 3);
        this.wrappedStub({}, this.context, this.callbackStub);

        // we are not handling this case yet, return value should be unchanged
        setTimeout(() => {
            const result = this.callbackStub.getCall(0).args[1];
            expect(result).to.not.contain.key('Epsagon');
            expect(result).to.equal(3);
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(2);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            expect(this.uuid4Stub.called).to.be.false;
            done();
        }, 1);
    });

    it('stepLambdaWrapper: trigger creation failure', () => {
        this.createFromEventStub.reset();
        this.createFromEventStub.throws();
        this.wrappedStub({}, this.context, this.callbackStub);
        expect(this.createFromEventStub.callCount).to.equal(1);
        expect(this.createFromEventStub.calledWith({}));
        expect(this.addEventStub.callCount).to.equal(1);
        expect(this.addExceptionStub.callCount).to.equal(1);
        expect(this.sendTraceStub.callCount).to.equal(1);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.callbackStub.callCount).to.be.equal(1);
        expect(this.setExceptionStub.called).to.be.false;
        expect(this.uuid4Stub.calledOnce).to.be.true;
    });

    it('stepLambdaWrapper: wrapped function throws error', () => {
        this.stubFunction.reset();
        this.stubFunction.throws();
        expect(() => this.wrappedStub({}, this.context, this.callbackStub)).to.throw();
        expect(this.createFromEventStub.callCount).to.equal(1);
        expect(this.createFromEventStub.calledWith({}));
        expect(this.addEventStub.callCount).to.equal(2);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.called).to.be.false;
        expect(this.sendTraceSyncStub.callCount).to.equal(1);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.callbackStub.called).to.be.false;
        expect(this.setExceptionStub.callCount).to.equal(1);
        expect(this.uuid4Stub.called).to.be.false;
    });

    it('stepLambdaWrapper: wrapped callback error call', (done) => {
        this.stubFunction.callsArgWith(2, new Error('fail'), { result: 1 });
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            const error = this.callbackStub.getCall(0).args[0];
            expect(error.message).to.equal('fail');
            const result = this.callbackStub.getCall(0).args[1];
            expect(result).to.not.contain.key('Epsagon');
            expect(result).to.contain.key('result');
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(2);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.callCount).to.equal(1);
            expect(this.uuid4Stub.called).to.be.false;
            done();
        }, 1);
    });

    it('stepLambdaWrapper: update COLD_START value', () => {
        consts.COLD_START = true;
        this.wrappedStub({}, this.context, this.callbackStub);
        expect(consts.COLD_START).to.be.false;
    });

    it('stepLambdaWrapper: COLD_START value should be false after more then 1 call', () => {
        consts.COLD_START = true;

        this.wrappedStub({}, this.context, this.callbackStub);
        expect(consts.COLD_START).to.be.false;

        this.wrappedStub({}, this.context, this.callbackStub);
        expect(consts.COLD_START).to.be.false;
    });

    it('lambdaWrapper: null context', () => {
        this.stubFunction = sinon.spy(() => 'success');
        this.wrappedStub = this.lambdaWithPatchedDeps.lambdaWrapper(this.stubFunction);
        expect(this.wrappedStub({}, null, this.callbackStub)).to.equal('success');
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.createFromEventStub.callCount).to.equal(0);
        expect(this.addEventStub.callCount).to.equal(0);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.sendTraceStub.callCount).to.equal(0);
        expect(this.stubFunction.callCount).to.equal(1);
        expect(this.callbackStub.called).to.be.false;
        expect(this.setExceptionStub.called).to.be.false;
    });
});
