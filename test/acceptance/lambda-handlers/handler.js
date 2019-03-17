// vim: ts=4 sw=4 expandtab
const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

module.exports.sanity = epsagon.lambdaWrapper((event, context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };

    callback(null, response);
});

module.exports.labels = epsagon.lambdaWrapper((event, context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    epsagon.label('label-key', 'label-value');
    epsagon.label(null, null);
    epsagon.label('label-key', 12);
    epsagon.label(12, 12);
    epsagon.label(12, null);
    epsagon.label('12', null);

    callback(null, response);
});
