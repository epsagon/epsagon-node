const ldap = require('ldapjs');
const epsagon = require('../../../src/index');
const utils = require('../../../src/utils.js');


describe('ldap.js client events tests', () => {
    before((done) => {
        epsagon.init({
            token: process.env.EPSAGON_TOKEN,
            appName: 'itay-ldap-test',
            metadataOnly: false,
        });
        done();
    });

    after((done) => {
        done();
    });

    describe('tests without cache', () => {
        it('bind', (done) => {
            function testFunction() {
                const client = ldap.createClient({
                    url: 'ldap://localhost:4389',
                });
                client.bind('ou=users,dc=myorg,dc=com', 'secret', (err) => {
                    if (err) {
                        utils.debugLog(err);
                    }
                });
            }

            const wrappedTestFunction = epsagon.nodeWrapper(testFunction);
            wrappedTestFunction();
            done();
        });
    });
});
