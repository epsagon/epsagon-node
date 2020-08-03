const ldap = require('ldapjs');
const epsagon = require('../../../src/index');


describe('ldap.js client events tests', () => {
    before((done) => {
        epsagon.init({
            token: 'my-secret-token',
            appName: 'my-app-name',
            metadataOnly: false,
        });
        done();
    });

    after((done) => {
        done();
    });

    describe('tests without cache', () => {
        it('bind', async (done) => {
            function testFunction() {
                const client = ldap.createClient({
                    url: 'ldap://localhost:4389',
                });
                return client;
            }

            const wrappedTestFunction = epsagon.nodeWrapper(testFunction);
            const client = wrappedTestFunction();

            try {
                await client.bind('ou=users,dc=myorg,dc=com', 'secret');
                done();
            } catch (e) {
                done();
            }
        });
    });
});
