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
}

const testFunction = epsagon.nodeWrapper(test);

testFunction(() => {});
