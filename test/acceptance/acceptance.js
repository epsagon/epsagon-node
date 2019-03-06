// vim: ts=4 sw=4 expandtab
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { expect } = require('chai');
const AWS = require('aws-sdk');

chai.use(chaiAsPromised);

const SERVICE_PREFIX = `epsagon-acceptance-node-${process.env.TRAVIS_BUILD_NUMBER}-dev-`;

/**
 * invokes a lambda
 * @param {string} name
 * @param {object} payload
 * @returns {hash} The functions output
 */
async function invoke(name, payload) {
    const lambda = new AWS.Lambda({ region: 'us-east-1' });
    const params = {
        FunctionName: SERVICE_PREFIX + name,
        Payload: JSON.stringify(payload),
    };
    return lambda.invoke(params).promise();
}

/**
 * basicTest
 *
 * @param {string} lambdaName
 * @param {object} input
 * @returns {undefined}
 */
async function basicTest(lambdaName, input) {
    const response = await invoke(lambdaName, input);
    expect(response.StatusCode).to.equal(200);
    const content = JSON.parse(response.Payload);
    expect(content.statusCode).to.equal(200);
    const body = JSON.parse(content.body);
    expect(body.input).to.eql(input);
}

describe('Lambda Wrapper', () => {
    const sanityTests = [
        '',
        '{afwe',
        [],
        [1, 2, 3],
        {},
        { test: 'test' },
        { test: 'test', more: [1, 2, '3'] },
    ];

    sanityTests.forEach((input) => {
        it('works with sanity example', async () => {
            await basicTest('sanity', input);
        });
        it('works with epsagon labels', async () => {
            await basicTest('sanity', input);
        });
    });
});
