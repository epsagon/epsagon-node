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
});