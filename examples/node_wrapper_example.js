const epsagon = require('../src/index.js');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

/**
 * Node wrapper test function
 * @param {function} callback: callback function
 */
function test(callback) { // eslint-disable-line no-unused-vars
    // eslint-disable-next-line no-console
    console.log('hello world from node function');

    return {
        body2: { value2: 'hi', value: 'bye' },
        body: "\"{\\\"name\\\":\\\"sss\\\",\\\"value\\\":\\\"-----BEGIN OPENSSH PRIVATE KEY-----\\\\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\\\\nQyNTUxOQAAACDvlDzkfsP/8QSJ4Y9VQxUcVJdCTXlW3nf9uSsd5HAM2AAAAKB4V4OreFeD\\\\nqwAAAAtzc2gtZWQyNTUxOQAAACDvlDzkfsP/8QSJ4Y9VQxUcVJdCTXlW3nf9uSsd5HAM2A\\\\nAAAEAgaxPrylcL/9LU9O34rv7rK7PebEd6CpmWf1+ETR2Q4O+UPOR+w//xBInhj1VDFRxU\\\\nl0JNeVbed/25Kx3kcAzYAAAAFnJvbmkuZnJhbnRjaGlAZW52MC5jb20BAgMEBQYH\\\\n-----END OPENSSH PRIVATE KEY-----\\\\n\\\",\\\"organizationId\\\":\\\"76091a0f-d877-4574-b2f5-5378a2be98d2\\\"}\"",
    }
}

const testFunction = epsagon.nodeWrapper(test);

testFunction(() => {});
