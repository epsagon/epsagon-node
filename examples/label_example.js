const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

module.exports.test = epsagon.lambdaWrapper((event, context, callback) => { // eslint-disable-line no-unused-vars
    epsagon.label('myFirstLabel', 'customValue1');
    epsagon.label('mySecondLabel', 'customValue2');

    // eslint-disable-next-line no-console
    console.log('hello world from node function');
});
