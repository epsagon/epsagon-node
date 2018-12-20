const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

module.exports.test = epsagon.lambdaWrapper(() => {
    epsagon.label('myFirstLabel', 'customValue1');
    epsagon.label('mySecondLabel', 'customValue2');

    return 'success';
});
