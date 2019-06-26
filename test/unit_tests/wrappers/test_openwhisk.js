/* eslint-disable func-names */
const request = require('request-promise-native');
const { expect } = require('chai');
const epsagon = require('../../../src/index');

const owsimple = () => ({
    hello: 'world',
});

const owpromise = () => Promise.resolve({
    hello: 'world',
});

const owrequest = () => request.get('http://www.example.com').then(response => ({
    body: response,
}));

describe('openwhiskWrapper tests', () => {
    it('openwhiskWrapper: return a function', () => {
        const wrapped = epsagon.openWhiskWrapper(owsimple);
        expect(wrapped).to.be.a('function');
    });

    it('openwhiskWrapper: wrapped function returns values', () => {
        const wrapped = epsagon.openWhiskWrapper(owsimple);
        const retval = wrapped();
        expect(retval).to.deep.equal({
            hello: 'world',
        });
    });

    it('openwhiskWrapper: wrapped function returns promises', async () => {
        const wrapped = epsagon.openWhiskWrapper(owpromise);
        const retval = await wrapped();
        expect(retval).to.deep.equal({
            hello: 'world',
        });
    });

    it('openwhiskWrapper: wrapped function returns async values', async () => {
        const wrapped = epsagon.openWhiskWrapper(owrequest);
        const retval = await wrapped();
        expect(retval.body).to.contain('Example Domain');
    });

    it('openwhiskWrapper: can pass token into wrapper function', async () => {
        const wrapped = epsagon.openWhiskWrapper(owrequest, { token: 'foobar' });

        let foundtoken;
        const oldinit = epsagon.tracer.initTrace;

        epsagon.tracer.initTrace = function (options) {
            foundtoken = options.token;
            oldinit(options);
        };

        const retval = await wrapped();
        expect(retval.body).to.contain('Example Domain');

        epsagon.tracer.initTrace = oldinit;
        expect(foundtoken).to.equal('foobar');
    });

    it('openwhiskWrapper: can indirectly pass token into wrapper function', async () => {
        const wrapped = epsagon.openWhiskWrapper(owrequest, { token_param: 'EPSAGON_TOKEN' });

        let foundtoken;
        const oldinit = epsagon.tracer.initTrace;

        epsagon.tracer.initTrace = function (options) {
            foundtoken = options.token;
            oldinit(options);
        };

        const retval = await wrapped({ EPSAGON_TOKEN: 'barbaz' });
        expect(retval.body).to.contain('Example Domain');

        epsagon.tracer.initTrace = oldinit;
        expect(foundtoken).to.equal('barbaz');
    });

    it('openwhiskWrapper: wrapper will not fail when called without params', async () => {
        const wrapped = epsagon.openWhiskWrapper(owrequest, { token_param: 'EPSAGON_TOKEN' });

        let foundtoken;
        const oldinit = epsagon.tracer.initTrace;

        epsagon.tracer.initTrace = function (options) {
            foundtoken = options.token;
            oldinit(options);
        };

        const retval = await wrapped();
        expect(retval.body).to.contain('Example Domain');

        epsagon.tracer.initTrace = oldinit;
        expect(foundtoken).to.be.undefined;
    });

    it('openwhiskWrapper: hard coded token overrides variable token', async () => {
        const wrapped = epsagon.openWhiskWrapper(owrequest, { token_param: 'EPSAGON_TOKEN', token: 'fooboo' });

        let foundtoken;
        const oldinit = epsagon.tracer.initTrace;

        epsagon.tracer.initTrace = function (options) {
            foundtoken = options.token;
            oldinit(options);
        };

        const retval = await wrapped({ EPSAGON_TOKEN: 'barbaz' });
        expect(retval.body).to.contain('Example Domain');

        epsagon.tracer.initTrace = oldinit;
        expect(foundtoken).to.equal('fooboo');
    });
});
