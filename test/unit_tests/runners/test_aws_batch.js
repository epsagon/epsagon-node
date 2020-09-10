const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const batchRunner = require('../../../src/runners/aws_batch.js');
const errorCode = require('../../../src/proto/error_code_pb.js');
const tracer = require('../../../src/tracer.js');
const config = require('../../../src/config.js');

describe('AWS Batch createRunner tests', () => {
    before(() => {
        this.baseConfig = config.getConfig();
    });
    beforeEach(() => {
        this.getStub = sinon.stub(axios, 'get').returns(Promise.resolve({ data: JSON.stringify({ region: 'test-reg' }) }));
        this.addExceptionStub = sinon.stub(tracer, 'addException');
        this.getConfigStub = sinon.stub(config, 'getConfig').returns(
            Object.assign(
                {},
                this.baseConfig,
                { metadataOnly: false }
            )
        );
    });
    afterEach(() => {
        this.getStub.restore();
        this.addExceptionStub.restore();
        this.getConfigStub.restore();
    });
    it('createRunner: create correct runner event', (done) => {
        const env = {
            AWS_BATCH_JOB_ID: 'test-id',
            AWS_BATCH_JQ_NAME: 'jq',
            AWS_BATCH_CE_NAME: 'ce',
            AWS_BATCH_JOB_ATTEMPT: '1',
            HOSTNAME: 'a',
            PATH: 'a',
        };

        Object.assign(process.env, env);
        const { runner: runnerEvent, runnerPromise } = batchRunner.createRunner();
        expect(runnerEvent.getId()).to.equal(env.AWS_BATCH_JOB_ID);
        expect(runnerEvent.getStartTime()).to.be.a('number');
        expect(runnerEvent.getDuration()).to.be.a('number');
        expect(runnerEvent.getOrigin()).to.equal('runner');
        expect(runnerEvent.getErrorCode()).to.equal(errorCode.ErrorCode.OK);
        expect(runnerEvent.getException()).to.be.undefined;
        const resource = runnerEvent.getResource();
        expect(resource.getName()).to.equal(env.AWS_BATCH_JOB_ID);
        expect(resource.getType()).to.equal('batch');
        expect(resource.getOperation()).to.equal('invoke');
        expect(resource.getMetadataMap().get('Job ID')).to.equal(env.AWS_BATCH_JOB_ID);
        expect(resource.getMetadataMap().get('Job Queue Name')).to.equal(env.AWS_BATCH_JQ_NAME);
        expect(resource.getMetadataMap().get('Compute Environment Name')).to.equal(
            env.AWS_BATCH_CE_NAME
        );
        expect(resource.getMetadataMap().get('Job Attempt')).to.equal(env.AWS_BATCH_JOB_ATTEMPT);
        expect(resource.getMetadataMap().get('Hostname')).to.equal(process.env.HOSTNAME);
        expect(resource.getMetadataMap().get('Home')).to.equal(process.env.HOME);
        expect(resource.getMetadataMap().get('Path')).to.equal(process.env.PATH);
        expect(resource.getMetadataMap().get('Arguments')).to.equal(JSON.stringify(process.argv));
        runnerPromise.then(() => {
            expect(resource.getMetadataMap().get('Region')).to.equal('test-reg');
            expect(this.addExceptionStub.called).to.be.false;
            done();
        });
    });

    it('createRunner: get region fails', (done) => {
        this.getStub.returns(Promise.reject(new Error('test')));
        const env = {
            AWS_BATCH_JOB_ID: 'test-id',
            AWS_BATCH_JQ_NAME: 'jq',
            AWS_BATCH_CE_NAME: 'ce',
            AWS_BATCH_JOB_ATTEMPT: '1',
            HOSTNAME: 'a',
            PATH: 'a',
        };

        Object.assign(process.env, env);
        const { runner: runnerEvent, runnerPromise } = batchRunner.createRunner();
        expect(runnerEvent.getId()).to.equal(env.AWS_BATCH_JOB_ID);
        expect(runnerEvent.getStartTime()).to.be.a('number');
        expect(runnerEvent.getDuration()).to.be.a('number');
        expect(runnerEvent.getOrigin()).to.equal('runner');
        expect(runnerEvent.getErrorCode()).to.equal(errorCode.ErrorCode.OK);
        expect(runnerEvent.getException()).to.be.undefined;
        const resource = runnerEvent.getResource();
        expect(resource.getName()).to.equal(env.AWS_BATCH_JOB_ID);
        expect(resource.getType()).to.equal('batch');
        expect(resource.getOperation()).to.equal('invoke');
        expect(resource.getMetadataMap().get('Job ID')).to.equal(env.AWS_BATCH_JOB_ID);
        expect(resource.getMetadataMap().get('Job Queue Name')).to.equal(env.AWS_BATCH_JQ_NAME);
        expect(resource.getMetadataMap().get('Compute Environment Name')).to.equal(
            env.AWS_BATCH_CE_NAME
        );
        expect(resource.getMetadataMap().get('Job Attempt')).to.equal(env.AWS_BATCH_JOB_ATTEMPT);
        expect(resource.getMetadataMap().get('Hostname')).to.equal(process.env.HOSTNAME);
        expect(resource.getMetadataMap().get('Home')).to.equal(process.env.HOME);
        expect(resource.getMetadataMap().get('Path')).to.equal(process.env.PATH);
        expect(resource.getMetadataMap().get('Arguments')).to.equal(JSON.stringify(process.argv));
        runnerPromise.catch((err) => {
            expect(err.message).to.equal('test');
            expect(resource.getMetadataMap().get('Region')).to.be.undefined;
            expect(this.addExceptionStub.calledOnce).to.be.true;
            done();
        });
    });

    it('createRunner: get region invalid JSON', (done) => {
        this.getStub.returns(Promise.resolve({ data: '{invalid json' }));
        const env = {
            AWS_BATCH_JOB_ID: 'test-id',
            AWS_BATCH_JQ_NAME: 'jq',
            AWS_BATCH_CE_NAME: 'ce',
            AWS_BATCH_JOB_ATTEMPT: '1',
            HOSTNAME: 'a',
            PATH: 'a',
        };

        Object.assign(process.env, env);
        const { runner: runnerEvent, runnerPromise } = batchRunner.createRunner();
        expect(runnerEvent.getId()).to.equal(env.AWS_BATCH_JOB_ID);
        expect(runnerEvent.getStartTime()).to.be.a('number');
        expect(runnerEvent.getDuration()).to.be.a('number');
        expect(runnerEvent.getOrigin()).to.equal('runner');
        expect(runnerEvent.getErrorCode()).to.equal(errorCode.ErrorCode.OK);
        expect(runnerEvent.getException()).to.be.undefined;
        const resource = runnerEvent.getResource();
        expect(resource.getName()).to.equal(env.AWS_BATCH_JOB_ID);
        expect(resource.getType()).to.equal('batch');
        expect(resource.getOperation()).to.equal('invoke');
        expect(resource.getMetadataMap().get('Job ID')).to.equal(env.AWS_BATCH_JOB_ID);
        expect(resource.getMetadataMap().get('Job Queue Name')).to.equal(env.AWS_BATCH_JQ_NAME);
        expect(resource.getMetadataMap().get('Compute Environment Name')).to.equal(
            env.AWS_BATCH_CE_NAME
        );
        expect(resource.getMetadataMap().get('Job Attempt')).to.equal(env.AWS_BATCH_JOB_ATTEMPT);
        expect(resource.getMetadataMap().get('Hostname')).to.equal(process.env.HOSTNAME);
        expect(resource.getMetadataMap().get('Home')).to.equal(process.env.HOME);
        expect(resource.getMetadataMap().get('Path')).to.equal(process.env.PATH);
        expect(resource.getMetadataMap().get('Arguments')).to.equal(JSON.stringify(process.argv));
        runnerPromise.then(() => {
            expect(resource.getMetadataMap().get('Region')).to.be.undefined;
            done();
        });
    });
});
