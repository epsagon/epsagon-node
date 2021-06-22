

const tracer = require('../tracer.js');
const traceObject = require('../trace_object.js');


// type Mutable<T> = {
//     -readonly [ key in keyof T ]: Mutable<T[key]>
// };

module.exports.singletonFunctionPropsWrapper = function singletonFunctionPropsWrapper(propsToWrap) {
    // let mutableProps: Mutable<any> = propsToWrap;

    let { handler, layers, environment } = propsToWrap;
    environment = environment || {}

    const currTracer = traceObject.get();

    console.log(handler, layers, environment);
    environment.EPSAGON_TOKEN = tracer.trace
    // tracer.getTrace = traceObject.get;
};


module.exports.singletonFunctionPropsWrapper(
    {
        uuid: 'random-uuid',
        code: 'i-am-code',
        layers: ['arn:layer:layer'],
        runtime: 'i-am-python-36',
        handler: 'index.handler',
        lambdaPurpose: 'Custom::CDKBucketDeployment',
        timeout: '15minutes',
        role: 'thismyrole',
        memorySize: 'thismymemory',
        vpc: 'thismyvpc',
        vpcSubnets: 'thismysubnet',
    }
);
