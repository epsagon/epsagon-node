const { expect } = require('chai');
const sinon = require('sinon');
const crypto = require('crypto');
const tracer = require('../../../src/tracer.js');
const eventInterface = require('../../../src/event.js');
const consts = require('../../../src/consts.js');
const openwhiskWrapper = require('../../../src/wrappers/openwhisk.js');
const config = require('../../../src/config.js');

const DEFAULT_TIMEOUT = 10000;
const RETURN_VALUE = {
    status: 200,
    body: 'ok',
};

function setupProcessEnv() {
    process.env['__OW_ACTIVATION_ID'] = crypto.randomBytes(16).toString('hex'); // eslint-disable-line dot-notation
    process.env['__OW_TRANSACTION_ID'] = crypto.randomBytes(16).toString('hex'); // eslint-disable-line dot-notation
    process.env['__OW_API_HOST'] = 'runtime.example.com'; // eslint-disable-line dot-notation
    process.env['__OW_NAMESPACE'] = 'test-namespace'; // eslint-disable-line dot-notation
    process.env['__OW_ACTION_NAME'] = 'test-action-name'; // eslint-disable-line dot-notation
}

describe('openwhiskWrapper tracer tests', () => {
    beforeEach(() => {
        config.setConfig({ metadataOnly: false });
        setupProcessEnv();

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

        this.postTraceStub = sinon.stub(
            tracer,
            'postTrace'
        ).returns(Promise.resolve('success'));

        this.setExceptionStub = sinon.stub(
            eventInterface,
            'setException'
        );

        this.markAsTimeoutStub = sinon.stub(
            eventInterface,
            'markAsTimeout'
        );
        this.stubFunction = sinon.stub().returns(RETURN_VALUE);
        this.wrappedStub = openwhiskWrapper.openWhiskWrapper(this.stubFunction, {
            token: 'foo',
        });

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
        this.addEventStub.restore();
        this.addExceptionStub.restore();
        this.postTraceStub.restore();
        this.restartStub.restore();
        this.addRunnerStub.restore();
        this.setExceptionStub.restore();
        this.markAsTimeoutStub.restore();
    });

    it('openwhiskWrapper: sanity', async () => {
        await this.wrappedStub({});
        expect(this.restartStub.callCount).to.equal(1);
        expect(this.addRunnerStub.callCount).to.equal(1);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.postTraceStub.callCount).to.equal(1);
        expect(this.setExceptionStub.called).to.be.false;
        expect(this.stubFunction.callCount).to.equal(1);
    });

    it('openwhiskWrapper: send 2 traces for 2 actions.', async () => {
        await this.wrappedStub({});
        expect(this.stubFunction.callCount).to.equal(1);

        this.stubFunction = sinon.stub().returns(RETURN_VALUE);
        this.wrappedStub = openwhiskWrapper.openWhiskWrapper(this.stubFunction, {
            token: 'foo',
        });
        setupProcessEnv();
        await this.wrappedStub({});
        expect(this.stubFunction.callCount).to.equal(1);

        expect(this.restartStub.callCount).to.equal(2);
        expect(this.addExceptionStub.called).to.be.false;
        expect(this.postTraceStub.callCount).to.equal(2);
        expect(this.setExceptionStub.called).to.be.false;
    });
});
