// vim: ts=4 sw=4 expandtab
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { expect } = require('chai');
const AWS = require('aws-sdk');

chai.use(chaiAsPromised);

const SERVICE_PREFIX = `acceptance-node-${process.env.TRAVIS_BUILD_NUMBER}-dev-`;
const RUNTIME = process.env.RUNTIME || 'nodejs8.10'

/**
 * invokes a lambda
 * @param {string} name
 * @param {object} payload
 * @returns {hash} The functions output
 */
function invoke(name, payload) {
    const lambda = new AWS.Lambda({ region: 'us-east-1' });
    const params = {
        FunctionName: SERVICE_PREFIX + name,
        Payload: JSON.stringify(payload),
    };
    return lambda.invoke(params).promise();
}

/**
 * testSameOutput tests that the output of both normal and instrumented lambdas is the same
 * instrumented lambdas are identified by having a '_e' suffix to the name
 *
 * @param {string} lambdaName
 * @param {object} input
 * @returns {undefined}
 */
async function testSameOutput(lambdaName, input) {
    const responseOriginal = await invoke(lambdaName, input);
    const responseInstrumented = await invoke(`${lambdaName}_e`, input);
    expect(responseOriginal).to.eql(responseInstrumented);
}

/**
 * basicTestNoInput - invokes a lambda and expects to get the input back
 *
 * @param {string} lambdaName
 * @param {object} input
 * @returns {undefined}
 */
async function basicTestNoInput(lambdaName, input) {
    const response = await invoke(lambdaName, input);
    expect(response.StatusCode).to.equal(200);
    const content = JSON.parse(response.Payload);
    expect(content.statusCode).to.equal(200);
    const body = JSON.parse(content.body);
    expect(body.message).to.eql('It Worked');
}

/**
 * basicTest - invokes a lambda and expects to get the input back
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

/**
 * basicNoReturn
 *
 * @param {string} lambdaName
 * @param {object} input
 * @returns {undefined}
 */
async function basicNoReturn(lambdaName, input) {
    const response = await invoke(lambdaName, input);
    expect(response.StatusCode).to.equal(200);
}

/**
 * failTest
 *
 * @param {string} lambdaName
 * @param {object} input
 * @returns {undefined}
 */
async function failTest(lambdaName, input) {
    const response = await invoke(lambdaName, input);
    expect(response.StatusCode).to.equal(200);
    const content = JSON.parse(response.Payload);
    expect(content.errorMessage).to.equal(input);
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
            await basicTest('labels', input);
        });
    });

    const syncOptions = ['sync'];
    const paramOptions = ['no', '1', '2', '3'];
    const returnOptions = [
        'simple_return', 'no_return',
        'succeed', 'fail', 'done',
        'callback', 'callback_error', 'callback_then_fail'];
    if (RUNTIME === 'nodejs8.10') {
        returnOptions.push('promise');
    }
    const testMatrix = {
        sync: {
            no: {
                promise: basicTestNoInput,
                simple_return: basicNoReturn,
                no_return: basicNoReturn,
            },
            1: {
                promise: basicTest,
                simple_return: basicNoReturn,
                no_return: basicNoReturn,
            },
            2: {
                promise: basicTest,
                simple_return: basicNoReturn,
                no_return: basicNoReturn,
                succeed: basicTest,
                done: basicTest,
                fail: failTest,
            },
            3: {
                promise: basicTest,
                simple_return: basicNoReturn,
                no_return: basicNoReturn,
                succeed: basicTest,
                done: basicTest,
                fail: failTest,
                callback: basicTest,
                callback_error: failTest,
                // callback_then_fail: basicTest,
            },
        },
        async: {
            no: { },
            1: { },
            2: { },
            3: { },
        },
    };

    syncOptions.forEach((syncOpt) => {
        paramOptions.forEach((paramOpt) => {
            returnOptions.forEach((returnOpt) => {
                const funcName = `${syncOpt}_${paramOpt}_param_${returnOpt}`;
                if (testMatrix[syncOpt][paramOpt][returnOpt]) {
                    it(`behaves correctly on ${funcName}`, async () => {
                        await testSameOutput(funcName, 'hello world');
                        await testMatrix[syncOpt][paramOpt][returnOpt](
                            `${funcName}_e`, 'hello world'
                        );
                    });
                }
            });
        });
    });
});
