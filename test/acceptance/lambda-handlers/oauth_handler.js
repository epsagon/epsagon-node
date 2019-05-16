// vim: ts=4 sw=4 expandtab
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
const epsagon = require('epsagon');
const Wreck = require('wreck');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: true,
});

module.exports.echo = (event, context, callback) => {
    const response = {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            echo: event.queryStringParameters.echo,
            message: 'echo',
        }),
    };
    callback(null, response);
};

async function testWreckHelper(domain, stage) {
    const options = {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    };
    const response = await Wreck.post(`https://${domain}/${stage}/echo?echo=hello`, options);
    return response.payload;
}

module.exports.wreck_test = epsagon.lambdaWrapper(async (event, context, callback) => {
    const domain = event.requestContext.domainName || `${process.env.DOMAIN_CODE}.execute-api.us-east-1.amazonaws.com`;
    const { stage } = event.requestContext || 'dev';
    const response = await testWreckHelper(domain, stage);

    const myResponse = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'test_wreck',
            output: JSON.parse(response.toString()).echo,
        }),
    };
    callback(null, myResponse);
});
