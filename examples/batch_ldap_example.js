const epsagon = require('../src/index');
const ldap = require('ldapjs');


const client = ldap.createClient({
    url: 'ldap://localhost:4389',
});
epsagon.init({
    token: process.env.EPSAGON_TOKEN,
    appName: 'ldap-test',
    metadataOnly: false,
    sendBatch: true,
    batchSize: 4,
    maxBatchSizeBytes: 5000000
});



async function testFunction() {
    client.bind('ou=users,dc=myorg,dc=com', 'secret', () => {});
}

const wrappedTestFunction = epsagon.nodeWrapper(testFunction);
wrappedTestFunction();
wrappedTestFunction();
wrappedTestFunction();
wrappedTestFunction();





client.destroy();
