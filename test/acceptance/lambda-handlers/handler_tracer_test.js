// vim: ts=4 sw=4 expandtab
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
const epsagon = require('epsagon');
const http = require('http');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

// Calling event before tracer initialized
http.get('http://dummy.restapiexample.com/api/v1/employees', (resp) => {
  resp.on('end', () => {
    console.log('end');
  });
}).on("error", (err) => {
  console.log("Error: " + err.message);
});

module.exports.failsafe_no_tracer_init = epsagon.lambdaWrapper((event, context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };

    callback(null, response);
});
