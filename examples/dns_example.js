const epsagon = require('../src/index.js');
const dns = require('dns')
const axios = require('axios')
epsagon.init({
    token: '57986555-4114-403f-b341-47e27385406a',
    appName: 'dns-instrumention-test2',
    metadataOnly: false,
  });

/**
 * Node wrapper test function
 * @param {function} callback: callback function
 */
function test(callback) { // eslint-disable-line no-unused-vars

    // const { Resolver } = require('dns');
    // const resolver = new Resolver();
    // resolver.setServers(['4.4.4.4']);
    
    // // This request will use the server at 4.4.4.4, independent of global settings.
    // resolver.resolve4('example.org', (err, addresses) => {
    //   // ...
    // });

  //WORK


  // //DNS RESOLVE NS
  // dns.resolveNs('example.com', function(err, names) {
  //   console.log(names)
  // });

  //   //DNS RESOLVE MX
  //   dns.resolveMx('encryptic.io', (err, result) => {
  //     if (err) {
  //       console.error(`error: ${err}`)
  //     } else {
  //       console.log(`result:  ${JSON.stringify(result)}`)
  //     }
  //   })


//   //   //DNS RESOLVE ANY
//     dns.resolveAny('www.amagicshop.com.tw', (err, result) => {
//       if (err) {
//         console.error(`error: ${err}`)
//       } else {
//         console.log(`result:  ${JSON.stringify(result)}`)
//       }
//     })

  //   //DNS CNAME
  //     dns.resolveCname('www.highcloud.com.', function(err, res) {
  //       console.log(res)
  //     })

  // const options = {
  //   family: 0,
  //   hints: dns.ADDRCONFIG | dns.V4MAPPED,
  // };

  //  // DNS LOOKUP

  // dns.lookup('google.com', options, (err, address, family) => console.log('address: %j family: IPv%s', address, family));
  // dns.lookup('google.com', (err, address, family) => console.log('address: %j family: IPv%s', address, family));

  // //DNS LOOKUP SERVICE
  //   dns.lookupService('127.0.0.1', 22, (err, hostname, service) => {
  //   console.log(hostname, service);
  //   // Prints: localhost ssh
  // });

    // // DNS RESOLVE4
    // dns.resolve4('www.google.com', function (err, addresses) {
    //   if (err) throw err;
    //   console.log('addresses v4: ' + JSON.stringify(addresses));
    // });
  //   dns.resolve4('www.google.com', options, function (err, addresses) {
  //     if (err) throw err;
  //     console.log('addresses v4 with options: ' + JSON.stringify(addresses));
  //   });
    // // DNS RESOLVE6
    // dns.resolve6('www.google.com', function (err, addresses) {
    //   if (err) throw err;
    //   console.log('addresses v4: ' + JSON.stringify(addresses));
    // });
  //   dns.resolve6('www.google.com', options, function (err, addresses) {
  //     if (err) throw err;
  //     console.log('addresses v4 with options: ' + JSON.stringify(addresses));
  //   });

    // DNS RESOLVE
    dns.resolve('google.com', (error, addresses) => { console.error(error); console.log(addresses); });
    // // DNS RESOLVE V6
    // dns.resolve('google.com','AAAA', (error, addresses) => { console.error(error); console.log(addresses); });

  //   // AXIOS GET
  //       axios.get('https://www.google.com/').then((response) => {
  //       console.log('axios response');
  //     });

    //DNS REVERSE
      dns.reverse('172.217.21.228', function(err, names) {
        console.log(names)
      });
    

  //   // *** RESOLVER
  //     const { Resolver } = dns;
  //     const resolver = new Resolver();
  //     // resolver.setServers(['4.4.4.4']);
  //     resolver.resolve4('example.org', (err, addresses) => {
  //       console.log(addresses)
  //     });
  //   console.log(dns.getServers());

}

const testFunction = epsagon.nodeWrapper(test);

testFunction(() => {});

