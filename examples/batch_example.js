const epsagon = require('../src/index');
const http = require('http');
const { Console } = require('console');


epsagon.init({
    token: process.env.EPSAGON_TOKEN,
    appName: 'batch-test',
    metadataOnly: false,
    sendBatch: true,
    batchSize: 5000,
    maxBatchSizeBytes: 5000000,
    maxTraceWait: 5000
});


// function timeout(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }

function doRequest(options) {
    return new Promise ((resolve, reject) => {
      let req = http.request(options);
  
      req.on('response', res => {
        resolve(res);
      });
  
      req.on('error', err => {
        resolve(err);
      });
    }); 
  }


async function testAsyncFunction() {
    const options = {
        host: 'localhost', 
        method: 'GET', 
    };
    doRequest(options)
    console.log("logging something")
}


const wrappedAsyncTestFunction = epsagon.nodeWrapper(testAsyncFunction);

async function main (){
  await wrappedAsyncTestFunction()
  await wrappedAsyncTestFunction()

  await wrappedAsyncTestFunction()

  await wrappedAsyncTestFunction()

  await wrappedAsyncTestFunction()
  await wrappedAsyncTestFunction()
  await wrappedAsyncTestFunction()
  await wrappedAsyncTestFunction()
  await wrappedAsyncTestFunction()
  await wrappedAsyncTestFunction()
  await wrappedAsyncTestFunction()
  await wrappedAsyncTestFunction()

  await Promise.all([
    wrappedAsyncTestFunction(),
    wrappedAsyncTestFunction()]
  
  )
}




main()