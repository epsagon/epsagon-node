var ldap = require('ldapjs');
const dotenv = require('dotenv').config()
var epsagon = require('../../../src/index')
const { spawn } = require('child_process');




describe('ldap.js client events tests', function () {
  let server;

  before(function (done) {
    server = spawn('node', ['node_modules/ldap-server-mock/server.js', '--conf=./test/unit_tests/events/ldap-server-mock/ldap-server-mock-conf.json', '--database=./test/unit_tests/events/ldap-server-mock/users.json'], {
      stdio: ['ipc']
    });
    server.on('message', (message) => {
      if (message.status === 'started') {
        done();
      }
    })
    epsagon.init({
      token: 'my-secret-token',
      appName: 'my-app-name',
      metadataOnly: false,
    });
    done();

  });

  after(function (done) {
      server.kill('SIGKILL');
      done();
  });

  describe('tests without cache', () => {
 

    it('bind', function (done) {

      function testFunction(){
        const client = ldap.createClient({
          url: "ldap://localhost:4389"
        });        
        return client
      }

      const wrappedTestFunction = epsagon.nodeWrapper(testFunction);
      wrappedTestFunction(() => {});
      done()

      // client.bind("ou=users,dc=myorg,dc=com", "secret", function(err) {
      //   if(err){
      //     console.log(err)
      //   }
      //   else{
      //     done()
      //   }
      // })
      
    });
  });
});


