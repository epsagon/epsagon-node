const epsagon = require('../src/index');
const http = require('http');


epsagon.init({
    token: process.env.EPSAGON_TOKEN,
    appName: 'batch-test',
    metadataOnly: false,
    sendBatch: true,
    batchSize: 1,
    maxBatchSizeBytes: 5000000
});


function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function doRequest(options) {
    return new Promise ((resolve, reject) => {
      let req = http.request(options);
  
      req.on('response', res => {
        resolve(res);
      });
  
      req.on('error', err => {
        reject(err);
      });
    }); 
  }


async function testAsyncFunction() {
    const options = {
        host: '127.0.0.1', 
        port: 3000, 
        method: 'GET', 
    };
    doRequest(options)
    console.log("logging something")
}

function testSyncFunction() {
    console.log("logging something")
}

const wrappedAsyncTestFunction = epsagon.nodeWrapper(testAsyncFunction);
const wrappedSyncTestFunction = epsagon.nodeWrapper(testSyncFunction);

async function main (){
    await wrappedAsyncTestFunction()
    // await wrappedAsyncTestFunction()


}

main()
