// vim: ts=4 sw=4 expandtab
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});
const matrixFunctions = {};

matrixFunctions.sanity = epsagon.lambdaWrapper((event, context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };

    callback(null, response);
});

matrixFunctions.labels = epsagon.lambdaWrapper((event, context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    epsagon.label('label-key', 'label-value');
    epsagon.label(null, null);
    epsagon.label('label-key', 12);
    epsagon.label(12, 12);
    epsagon.label(12, null);
    epsagon.label('12', null);

    callback(null, response);
});

// No parameters
//   call callback
//      // No function
//   context.succeed()
//      // No function
//   context.fail()
//      // No function
//   context.done()
//      // No Function
//   return promise
matrixFunctions.sync_no_param_promise = () => new Promise(
    (resolve, _reject) => {
        resolve({
            statusCode: 200,
            body: JSON.stringify({
                message: 'It Worked',
            }),
        });
    }
);
//   callback and then context.fail()
//      // No Function
//   normal
matrixFunctions.sync_no_param_simple_return = () => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
        }),
    };
    return response;
};

matrixFunctions.sync_no_param_no_return = () => {};

// event
//   call callback
//      // No function
//   context.succeed()
//      // No function
//   context.fail()
//      // No function
//   context.done()
//      // No Function
//   return promise
matrixFunctions.sync_1_param_promise = event => new Promise(
    (resolve, _reject) => {
        resolve({
            statusCode: 200,
            body: JSON.stringify({
                message: 'It Worked',
                input: event,
            }),
        });
    }
);
//   callback and then context.fail()
//     // No function
//   normal
matrixFunctions.sync_1_param_simple_return = (event) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    return response;
};
matrixFunctions.sync_1_param_no_return = (_event) => {};

// event + context
//   call callback
//      // No function
//   context.succeed()
matrixFunctions.sync_2_param_succeed = (event, context) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    context.succeed(response);
};
//   context.fail()
matrixFunctions.sync_2_param_fail = (event, context) => {
    context.fail(event);
};
//   context.done()
matrixFunctions.sync_2_param_done = (event, context) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    context.done(null, response);
};
//   return promise
matrixFunctions.sync_2_param_promise = (event, _context) => new Promise(
    (resolve, _reject) => {
        resolve({
            statusCode: 200,
            body: JSON.stringify({
                message: 'It Worked',
                input: event,
            }),
        });
    }
);

matrixFunctions.sync_2_param_simple_return = (event, _context) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    return response;
};
matrixFunctions.sync_2_param_no_return = (_event, _context) => {};

//   callback and then context.fail()
//     // normal
// event + context + callback
matrixFunctions.sync_3_param_succeed = (event, context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: '',
        }),
    };
    callback(null, response);
};

// event + context + callback
//   call callback
//      // No function
//   context.succeed()
matrixFunctions.sync_3_param_succeed = (event, context, _callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    context.succeed(response);
};
//   context.fail()
matrixFunctions.sync_3_param_fail = (event, context, _callback) => {
    context.fail(event);
};
//   context.done()
matrixFunctions.sync_3_param_done = (event, context, _callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    context.done(null, response);
};
//   return promise
matrixFunctions.sync_3_param_promise = (event, _context, _callback) => new Promise(
    (resolve, _reject) => {
        resolve({
            statusCode: 200,
            body: JSON.stringify({
                message: 'It Worked',
                input: event,
            }),
        });
    }
);

matrixFunctions.sync_3_param_simple_return = (event, _context, _callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    return response;
};
matrixFunctions.sync_3_param_no_return = (_event, _context, _callback) => {};
matrixFunctions.sync_3_param_callback = (event, _context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    callback(null, response);
};
matrixFunctions.sync_3_param_callback_error = (event, _context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    callback(event, response);
};
matrixFunctions.sync_3_param_callback_then_fail = (event, _context, callback) => {
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: 'It Worked!',
            input: event,
        }),
    };
    callback(null, response);
    context.fail(event);
};

Object.keys(matrixFunctions).forEach((funcName, _index) => {
    module.exports[funcName] = matrixFunctions[funcName];
    module.exports[`${funcName}_e`] = epsagon.lambdaWrapper(matrixFunctions[funcName]);
});
