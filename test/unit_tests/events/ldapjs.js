const ldap = require('ldapjs');
const epsagon = require('../../../src/index');
const utils = require('../../../src/utils.js');


describe('ldap.js client events tests', () => {
    before((done) => {
        epsagon.init({
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
            function testFunction(dn, password, cb) {
                const client = ldap.createClient({
                    url: 'ldap://localhost:4389',
                });
                client.bind(dn, password, (err) => {
                    client.unbind();
                    cb(err === null, err);
                });

                return client;
            }
            function output(res, err) {
                if (res) {
                    utils.debugLog('success');
                } else {
                    utils.debugLog(err);
                }
            }
            const wrappedTestFunction = epsagon.nodeWrapper(testFunction);
            wrappedTestFunction('ou=users,dc=myorg,dc=com', 'secret', output);
            done();
        });
    });
});
