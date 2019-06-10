const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

/**
 * OpenWhisk wrapper test function
 * @param {function} callback: callback function
 */
function main(params) { // eslint-disable-line no-unused-vars
    // eslint-disable-next-line no-console
    console.log('hello world from node function');
}

exports.main = epsagon.openWhiskWrapper(main);
