require('dotenv').config();
const ldap = require('ldapjs');
// const { spawn } = require('child_process');
const epsagon = require('../../../src/index');


describe('ldap.js client events tests', () => {
    // let server;

    before((done) => {
        // server = spawn('node', ['node_modules/ldap-server-mock/server.js',
        //  '--conf=./test/unit_tests/events/ldap-server-mock/ldap-server-mock-conf.json',
        //   '--database=./test/unit_tests/events/ldap-server-mock/users.json'], {
        //     stdio: ['ipc'],
        // });
        // server.on('message', (message) => {
        //     if (message.status === 'started') {
        //         done();
        //     }
        // });
        epsagon.init({
            token: 'my-secret-token',
            appName: 'my-app-name',
            metadataOnly: false,
        });
        done();
    });

    after((done) => {
        // server.kill('SIGKILL');
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
                console.log('Bind failed');
                done();
            }
        });
    });
});
