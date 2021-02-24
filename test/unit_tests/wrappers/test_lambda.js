const { expect } = require('chai');
const sinon = require('sinon');
const lolex = require('lolex');
const fs = require('fs');
const proxyquire = require('proxyquire').noPreserveCache();
const tracer = require('../../../src/tracer.js');
const eventInterface = require('../../../src/event.js');
const consts = require('../../../src/consts.js');
const awsLambdaTrigger = require('../../../src/triggers/aws_lambda.js');
const lambdaWrapper = require('../../../src/wrappers/lambda.js');
const errorCode = require('../../../src/proto/error_code_pb.js');
const config = require('../../../src/config.js');

const DEFAULT_TIMEOUT = 10000;
const RETURN_VALUE = { result: 1 };

// Helpers functions
function getRunner(addRunnerStub) {
    const calls = addRunnerStub.getCalls();
    for (let i = 0; i < calls.length; i += 1) {
        const event = calls[i].args[0];
        if (event.getOrigin && event.getOrigin() === 'runner') {
            return event;
        }
    }

    return null;
}

function getReturnValue(addRunnerStub) {
    const runnerMetadata = getRunner(addRunnerStub).getResource().getMetadataMap();
    return runnerMetadata.get('return_value');
}

function getStatusCode(addRunnerStub) {
    const runnerMetadata = getRunner(addRunnerStub).getResource().getMetadataMap();
    return runnerMetadata.get('status_code');
}

describe('lambdaWrapper tests', () => {
    beforeEach(() => {
        config.setConfig({ metadataOnly: false });
        const now = (new Date()).getTime();
        this.clock = lolex.install({
            now,
            shouldAdvanceTime: true,
        });
        this.createFromEventStub = sinon.stub(
            awsLambdaTrigger,
            'createFromEvent'
        ).returns('trigger');

        this.restartStub = sinon.stub(
            tracer,
            'restart'
        );

        this.addRunnerStub = sinon.stub(
            tracer,
            'addRunner'
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
        ).returns(Promise.resolve('success'));

        this.setExceptionStub = sinon.stub(
            eventInterface,
            'setException'
        );

        this.markAsTimeoutStub = sinon.stub(
            eventInterface,
            'markAsTimeout'
        );

        this.stubFunction = sinon.stub().callsArgWith(2, null, RETURN_VALUE);
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        this.callbackStub = sinon.stub();
        this.context = {
            getRemainingTimeInMillis() { return DEFAULT_TIMEOUT; },
            callbackWaitsForEmptyEventLoop: true,
            fail() {},
            succeed() {},
            done() {},
        };
        consts.COLD_START = true;
    });

    afterEach(() => {
        this.clock.uninstall();
        this.createFromEventStub.restore();
        this.addEventStub.restore();
        this.addExceptionStub.restore();
        this.sendTraceStub.restore();
        this.sendTraceSyncStub.restore();
        this.restartStub.restore();
        this.addRunnerStub.restore();
        this.setExceptionStub.restore();
        this.markAsTimeoutStub.restore();
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
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.equal(JSON.stringify(RETURN_VALUE));
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            done();
        }, 1);
    });

    it('lambdaWrapper: return status code', (done) => {
        const result = { statusCode: 200 };
        this.stubFunction.callsArgWith(2, null, result);
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);

            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.equal(JSON.stringify(result));
            expect(getStatusCode(this.addRunnerStub)).to.equal(200);
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
        const runnerEvent = getRunner(this.addRunnerStub);
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

    it('lambdaWrapper: create runner event with alias', () => {
        const contextData = {
            invokedFunctionArn: '0:1:2:3:4:5:6:7',
        };
        Object.assign(this.context, contextData);

        this.wrappedStub({}, this.context, this.callbackStub);
        const resource = getRunner(this.addRunnerStub).getResource();
        expect(resource.getMetadataMap().get('function_alias')).to.equal('7');
    });

    it('lambdaWrapper: trigger creation failure', (done) => {
        this.createFromEventStub.reset();
        this.createFromEventStub.throws();
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(0);
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            done();
        }, 1);
    });

    it('lambdaWrapper: wrapped function throws error', (done) => {
        this.stubFunction.reset();
        this.stubFunction.throws();
        this.wrappedStub(
            {},
            this.context,
            this.callbackStub
        );
        setTimeout(() => {
            expect(this.createFromEventStub.calledWith({}));
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.addEventStub.callCount).to.equal(1);
            expect(this.addExceptionStub.called).to.be.false;
            expect(getReturnValue(this.addRunnerStub)).to.be.undefined;
            expect(this.sendTraceStub.callCount).to.equal(0);
            expect(this.sendTraceSyncStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(0);
            expect(this.setExceptionStub.callCount).to.equal(1);
            done();
        }, 1);
    });

    it('lambdaWrapper: wrapped callback error call', (done) => {
        this.stubFunction.callsArgWith(2, new Error());
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.be.undefined;
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.callCount).to.equal(1);
            done();
        }, 1);
    });

    it('lambdaWrapper: wrapped callback string as error', (done) => {
        const errorString = 'Unauthorized';
        this.stubFunction.callsArgWith(2, errorString);
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.be.undefined;
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.callCount).to.equal(1);
            done();
        }, 1);
    });

    it('lambdaWrapper: catch unhandled rejected promise', (done) => {
        this.stubFunction = sinon.spy(() => {
            // eslint-disable-next-line prefer-promise-reject-errors,no-new
            new Promise((_, reject) => reject('Unauthorized'));
            return 'success';
        });
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        expect(this.wrappedStub({}, null, this.callbackStub)).to.equal('success');
        setTimeout(() => {
            expect(this.setExceptionStub.called).to.be.true;
            expect(this.sendTraceSyncStub.callCount).to.equal(1);
        }, 1);
        done();
    });

    it('lambdaWrapper: catch unhandled exception', (done) => {
        this.stubFunction = sinon.spy(() => {
            fs.writeFile('/inv/a/lid/path', 'Hello content!', (err) => {
                if (err) throw err;
                console.log('Saved!');
            });
            return 'success';
        });
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        expect(this.wrappedStub({}, null, this.callbackStub)).to.equal('success');
        setTimeout(() => {
            expect(this.setExceptionStub.called).to.be.true;
            expect(this.sendTraceSyncStub.callCount).to.equal(1);
        }, 1);
        done();
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

    it('lambdaWrapper: callback doesn\'t wait for empty event loop', (done) => {
        this.context.callbackWaitsForEmptyEventLoop = false;
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.equal(JSON.stringify(RETURN_VALUE));
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
        this.stubFunction = sinon.spy(() => { });
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
        done();
    });

    it('lambdaWrapper: return called', (done) => {
        this.stubFunction = sinon.spy(() => {
            done();
            return 42;
        });
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

    it('lambdaWrapper: non-jsonable result', (done) => {
        // Creating circular object (which is'nt JSON serializable)
        const x = {};
        x.b = x;
        this.stubFunction = sinon.stub().callsArgWith(2, null, x);
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.include(
                lambdaWrapper.FAILED_TO_SERIALIZE_MESSAGE
            );
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            done();
        }, 1);
    });

    it('lambdaWrapper: return called', (done) => {
        this.stubFunction = sinon.spy(() => 42);
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
        done();
    });

    it('lambdaWrapper: sanity with timeout being called', (done) => {
        this.stubFunction = sinon.spy(() => {
            this.clock.tick(DEFAULT_TIMEOUT - lambdaWrapper.TIMEOUT_WINDOW);
            return 17;
        });
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        expect(this.wrappedStub({}, this.context, this.callbackStub)).to.equal(17);
        expect(this.markAsTimeoutStub.callCount).to.equal(1);
        setTimeout(() => {
            expect(this.sendTraceSyncStub.callCount).to.equal(1);
            expect(this.sendTraceStub.callCount).to.equal(0);
        }, 1);
        done();
    });

    it('lambdaWrapper: sanity without timeout being called', (done) => {
        this.stubFunction = sinon.spy(() => {
            this.clock.tick((DEFAULT_TIMEOUT - lambdaWrapper.TIMEOUT_WINDOW) / 2);
            return 17;
        });
        this.wrappedStub = lambdaWrapper.lambdaWrapper(this.stubFunction);
        expect(this.wrappedStub({}, this.context, this.callbackStub)).to.equal(17);
        expect(this.markAsTimeoutStub.callCount).to.equal(0);
        setTimeout(() => {
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.sendTraceSyncStub.callCount).to.equal(0);
        }, 1);
        done();
    });

    it('lambdaWrapper: avoid double wrapping', (done) => {
        expect(this.wrappedStub[lambdaWrapper.epsagonWrapped]).to.be.true;
        const newWrapped = lambdaWrapper.lambdaWrapper(this.wrappedStub);

        expect(this.wrappedStub).to.equal(newWrapped);
        done();
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

        this.addRunnerStub = sinon.stub(
            tracer,
            'addRunner'
        );

        this.sendTraceStub = sinon.stub(
            tracer,
            'sendTrace'
        ).returns(Promise.resolve('success'));

        this.sendTraceSyncStub = sinon.stub(
            tracer,
            'sendTraceSync'
        ).returns(Promise.resolve('success'));

        this.setExceptionStub = sinon.stub(
            eventInterface,
            'setException'
        );

        this.uuid4Stub = sinon.stub().returns(1);
        this.lambdaWithPatchedDeps = proxyquire(
            '../../../src/wrappers/lambda.js',
            {
                uuid4: this.uuid4Stub,
                '../../tracer.js': tracer,
                '../../event.js': eventInterface,
                '../../triggers/aws_lambda.js': awsLambdaTrigger,
            }
        );

        this.stubFunction = sinon.stub().callsArgWith(2, null, { result: 1 });
        this.wrappedStub = this.lambdaWithPatchedDeps.stepLambdaWrapper(this.stubFunction);
        this.callbackStub = sinon.stub();
        this.context = {
            getRemainingTimeInMillis() { return DEFAULT_TIMEOUT; },
            callbackWaitsForEmptyEventLoop: true,
            fail() {},
            succeed() {},
            done() {},
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
        this.addRunnerStub.restore();
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
            expect(this.addEventStub.callCount).to.equal(1);
            const returnValue = JSON.parse(getReturnValue(this.addRunnerStub));
            expect(returnValue).to.contain.key('Epsagon');
            expect(returnValue).to.contain.key('result');
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            expect(this.uuid4Stub.calledOnce).to.be.true;
            done();
        }, 1);
    });

    it('stepLambdaWrapper: return status code', (done) => {
        const output = { statusCode: 200 };
        this.stubFunction.callsArgWith(2, null, output);
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            const result = this.callbackStub.getCall(0).args[1];
            expect(result).to.contain.key('Epsagon');
            expect(result).to.contain.key('statusCode');
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            const returnValue = JSON.parse(getReturnValue(this.addRunnerStub));
            expect(returnValue).to.contain.key('Epsagon');
            expect(returnValue).to.contain.key('statusCode');
            expect(getStatusCode(this.addRunnerStub)).to.equal(output.statusCode);
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
            expect(this.addEventStub.callCount).to.equal(1);
            const returnValue = JSON.parse(getReturnValue(this.addRunnerStub));
            expect(returnValue).to.contain.key('Epsagon');
            expect(returnValue).to.contain.key('result');
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
        const runnerEvent = this.addRunnerStub.getCall(0).args[0];
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
            expect(this.addEventStub.callCount).to.equal(1);
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            expect(this.uuid4Stub.called).to.be.false;
            done();
        }, 1);
    });

    it('stepLambdaWrapper: trigger creation failure', (done) => {
        this.createFromEventStub.reset();
        this.createFromEventStub.throws();
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(0);
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            done();
        }, 1);
    });

    it('stepLambdaWrapper: wrapped function throws error', (done) => {
        this.stubFunction.reset();
        this.stubFunction.throws();
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.be.undefined;
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.called).to.be.false;
            expect(this.sendTraceSyncStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(0);
            expect(this.setExceptionStub.callCount).to.equal(1);
            expect(this.uuid4Stub.called).to.be.false;
            done();
        }, 1);
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
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.be.undefined;
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

    it('stepLambdaWrapper: null context', () => {
        this.stubFunction = sinon.spy(() => 'success');
        this.wrappedStub = this.lambdaWithPatchedDeps.stepLambdaWrapper(this.stubFunction);
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

    it('stepLambdaWrapper: non-jsonable result', (done) => {
        // Creating circular object (which is'nt JSON serializable)
        const x = {};
        x.b = x;
        this.stubFunction = sinon.stub().callsArgWith(2, null, x);
        this.wrappedStub = lambdaWrapper.stepLambdaWrapper(this.stubFunction);
        this.wrappedStub({}, this.context, this.callbackStub);
        setTimeout(() => {
            expect(this.createFromEventStub.callCount).to.equal(1);
            expect(this.restartStub.callCount).to.equal(1);
            expect(this.createFromEventStub.calledWith({}));
            expect(this.addEventStub.callCount).to.equal(1);
            expect(getReturnValue(this.addRunnerStub)).to.include(
                lambdaWrapper.FAILED_TO_SERIALIZE_MESSAGE
            );
            expect(this.addExceptionStub.called).to.be.false;
            expect(this.sendTraceStub.callCount).to.equal(1);
            expect(this.stubFunction.callCount).to.equal(1);
            expect(this.callbackStub.callCount).to.equal(1);
            expect(this.setExceptionStub.called).to.be.false;
            done();
        }, 1);
    });
});
