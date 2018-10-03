const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

module.exports.hello = epsagon.lambdaWrapper((event, context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };

    callback(null, response);
});
