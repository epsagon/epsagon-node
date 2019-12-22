const uuid4 = require('uuid4');
const dns = require('dns');
const shimmer = require('shimmer');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const { isBlacklistURL } = require('.././helpers/events');

const URL_BLACKLIST = {
    'tc.epsagon.com': 'endsWith',
};

// Resouece records types
const rrtypesMethods = {
    resolveAny: 'ANY',
    resolve6: 'AAAA',
    resolve4: 'A',
    resolveCname: 'CNAME',
    resolveMx: 'MX',
    resolveNaptr: 'NAPTR',
    resolveNs: 'NS',
    resolvePtr: 'PTR',
    resolveSoa: 'SOA',
    resolveSrv: 'SRV',
    resolveTxt: 'TXT',
};

/**
 * Initial Dns event.
 * @param {string} name Operation name
 * @returns {Object} Object with dnsEvent and event start time.
 */
const initialDnsEvent = (name) => {
    const startTime = Date.now();
    const resource = new serverlessEvent.Resource([
        'dns',
        'dns',
        name,
    ]);
    const dnsEvent = new serverlessEvent.Event([
        `dns-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'dns',
        0,
        errorCode.ErrorCode.OK,
    ]);
    dnsEvent.setResource(resource);
    return { dnsEvent, startTime };
};

/**
 * Adding callback data/error to event, and finalize event.
 * @param {serverlessEvent.Event} dnsEvent Dns event.
 * @param {number} startTime Event start time.
 * @param {Error} err Callback error.
 * @param {string[] | Object[] | Object} metadata Callback metadata.
 */
const finalizeEvent = (dnsEvent, startTime, err, metadata) => {
    if (err) {
        eventInterface.setException(dnsEvent, err);
    } else {
        eventInterface.addToMetadata(dnsEvent, metadata);
    }
    dnsEvent.setDuration(utils.createDurationTimestamp(startTime));
};

/**
 * Checking resource record type by resolve function name (default resolve4 - 'A').
 * @param {*} arg1 function first argument.
 * @param {*} arg2 function second argument
 * @param {*} arg3 function third argument
 * @param {*} functionName function resolve name.
 * @returns {Object} Object of Hostname to resolve, Resource record type, and callback.
 */
const getRrtypeArguments = (arg1, arg2, arg3, functionName) => {
    const hostname = arg1;
    let rrtype = arg2;
    let callback = arg3;
    // in case of arg3 doesnt exist or arg2 is options.
    if (!arg3 || typeof arg2 === 'object') {
        if (functionName) {
            rrtype = Object.values(rrtypesMethods).find(type => functionName.toLocaleLowerCase().includes((`query${type}`.toLocaleLowerCase())));
        }
        if (!rrtype) {
            rrtype = rrtypesMethods.resolve4;
        }
        if (!arg3) {
            callback = arg2;
        }
    }
    return { hostname, rrtype, callback };
};

/**
 * Gettign lookup arguments with options.
 * @param {*} arg1 function first argument.
 * @param {*} arg2 function second argument
 * @param {*} arg3 function third argument
 * @returns {Object} Object of Hostname, options (if doesnt exist- undifiend) and callback.
 */
const getLookupArguments = (arg1, arg2, arg3) => {
    const hostname = arg1;
    let options = arg2;
    let callback = arg3;
    if (!arg3) {
        options = undefined;
        callback = arg2;
    }
    return { hostname, options, callback };
};

/**
 * Gettinng callback object of dns resolve.
 * @param {*} arg callback argument
 * @param {string} rrtype resouece record type
 * @returns {Object} Returns the callback object with the appropriate key compared to rrtype,
 * (if doesnt exist - records).
 */
const getCallbackResolveArgument = (arg, rrtype) => {
    if (!arg) return undefined;
    let callbackArg;
    if (!rrtype || rrtype === rrtypesMethods.resolveTxt) {
        callbackArg = { records: arg };
    } else if (rrtype === rrtypesMethods.resolveAny) {
        callbackArg = { ret: arg };
    } else if (rrtype === rrtypesMethods.resolveSoa) {
        callbackArg = { address: arg };
    } else {
        callbackArg = { addresses: arg };
    }
    return callbackArg;
};

/**
 * Calling to the dns function without callback, And record the error if thrown.
 * @param {Function} original dns function.
 * @param {number} startTime Event start time.
 * @param {serverlessEvent.Event} dnsEvent Dns event.
 * @param {Array} args Array of function arguments.
 * @returns {Object} original function response.
 */
function handleFunctionWithoutCallback(original, startTime, dnsEvent, args) {
    let clientRequest;
    try {
        clientRequest = original.apply(this, args);
    } catch (err) {
        dnsEvent.setDuration(utils.createDurationTimestamp(startTime));
        eventInterface.setException(dnsEvent, err);
        tracer.addEvent(dnsEvent);
        throw err;
    }
    return clientRequest;
}

/**
 *  Wrap dns resolve requset
 * @param {Function} original The dns function.
 * @returns {Function} The wrapped function
 */
function wrapDnsResolveFunction(original) {
    return function internalWrapDnsResolveFunction(arg1, arg2, arg3) {
        let patchedCallback;
        let clientRequest;
        let options;
        const { hostname, rrtype, callback } = getRrtypeArguments(arg1, arg2, arg3, original.name);
        if (typeof arg2 === 'object') {
            options = arg2;
        }
        const { dnsEvent, startTime } = initialDnsEvent(original.name);
        if (!callback) {
            clientRequest = handleFunctionWithoutCallback(
                original, startTime, dnsEvent, [arg1, arg2, arg3]
            );
        } else {
            try {
                const requestData = {};
                if (options) {
                    requestData.options = options;
                }
                if (rrtype) {
                    requestData.rrtype = rrtype;
                }
                eventInterface.addToMetadata(dnsEvent, { hostname, ...requestData });
                const responsePromise = new Promise((resolve) => {
                    patchedCallback = (err, records) => {
                        const callbackArgument = getCallbackResolveArgument(records, rrtype);
                        finalizeEvent(dnsEvent, startTime, err, { ...callbackArgument });
                        resolve();
                        if (callback) {
                            callback(err, records);
                        }
                    };
                });
                clientRequest = original.apply(this, [hostname, rrtype, patchedCallback]);
                tracer.addEvent(dnsEvent, responsePromise);
            } catch (err) {
                tracer.addException(err);
            }
        }
        if (!clientRequest) {
            clientRequest = original.apply(this, [arg1, arg2, arg3]);
        }
        return clientRequest;
    };
}
/**
 *  Wrap dns lookup service requset
 * @param {Function} original The dns function.
 * @returns {Function} The wrapped function
 */
function wrapDnsLookupServiceFunction(original) {
    return function internalWrapDnsLookupServiceFunction(address, port, callback) {
        let patchedCallback;
        let clientRequest;
        const { dnsEvent, startTime } = initialDnsEvent(original.name);
        if (!callback) {
            clientRequest = handleFunctionWithoutCallback(
                original, startTime, dnsEvent, [address, port, callback]
            );
        } else {
            try {
                eventInterface.addToMetadata(dnsEvent, { address, port });
                const responsePromise = new Promise((resolve) => {
                    patchedCallback = (err, hostname, service) => {
                        finalizeEvent(dnsEvent, startTime, err, { hostname, service });
                        resolve();
                        if (callback) {
                            callback(err, hostname, service);
                        }
                    };
                });
                clientRequest = original.apply(this, [address, port, patchedCallback]);
                tracer.addEvent(dnsEvent, responsePromise);
            } catch (err) {
                tracer.addException(err);
            }
        }
        if (!clientRequest) {
            clientRequest = original.apply(this, [address, port, callback]);
        }
        return clientRequest;
    };
}

/**
 *  Wrap dns reverse requset
 * @param {Function} original The dns function.
 * @returns {Function} The wrapped function
 */
function wrapDnsReverseFunction(original) {
    return function internalWrapDnsReverseFunction(ip, callback) {
        let patchedCallback;
        let clientRequest;
        const { dnsEvent, startTime } = initialDnsEvent(original.name);
        if (!callback) {
            clientRequest = handleFunctionWithoutCallback(
                original, startTime, dnsEvent, [ip, callback]
            );
        } else {
            try {
                eventInterface.addToMetadata(dnsEvent, { ip });
                const responsePromise = new Promise((resolve) => {
                    patchedCallback = (err, hostnames) => {
                        finalizeEvent(dnsEvent, startTime, err, { hostnames });
                        resolve();
                        if (callback) {
                            callback(err, hostnames);
                        }
                    };
                });
                clientRequest = original.apply(this, [ip, patchedCallback]);
                tracer.addEvent(dnsEvent, responsePromise);
            } catch (err) {
                tracer.addException(err);
            }
        }
        if (!clientRequest) {
            clientRequest = original.apply(this, [ip, callback]);
        }
        return clientRequest;
    };
}

/**
 *  Wrap dns lookup requset
 * @param {Function} original The dns function.
 * @returns {Function} The wrapped function
 */
function wrapDnsLookupFunction(original) {
    return function internalWrapDnsLookupFunction(arg1, arg2, arg3) {
        let patchedCallback;
        let clientRequest;
        const { hostname, options, callback } = getLookupArguments(arg1, arg2, arg3);
        if (isBlacklistURL(hostname, URL_BLACKLIST)) {
            utils.debugLog(`filtered blacklist hostname ${hostname}`);
            return original.apply(this, [arg1, arg2, arg3]);
        }
        const { dnsEvent, startTime } = initialDnsEvent(original.name);
        if (!callback) {
            clientRequest = handleFunctionWithoutCallback(
                original, startTime, dnsEvent, [arg1, arg2, arg3]
            );
        } else {
            try {
                eventInterface.addToMetadata(dnsEvent, { hostname });
                if (options) {
                    eventInterface.addToMetadata(dnsEvent, { options });
                }
                const responsePromise = new Promise((resolve) => {
                    patchedCallback = (err, address, family) => {
                        finalizeEvent(dnsEvent, startTime, err, { address, family });
                        resolve();
                        if (callback) {
                            callback(err, address, family);
                        }
                    };
                });
                const arrayOfArgs = [hostname, patchedCallback];
                // adding options if exist to function arguments array.
                if (options) {
                    arrayOfArgs.splice(1, 0, options);
                }
                clientRequest = original.apply(this, arrayOfArgs);
                tracer.addEvent(dnsEvent, responsePromise);
            } catch (err) {
                tracer.addException(err);
            }
        }
        if (!clientRequest) {
            clientRequest = original.apply(this, [arg1, arg2, arg3]);
        }
        return clientRequest;
    };
}

module.exports = {
    /**
     * Initializes the dns tracer.
     * process.env.EPSAGON_DNS_INSTRUMENTATION=true is requird.
     */
    init() {
        if ((process.env.EPSAGON_DNS_INSTRUMENTATION || '').toUpperCase() === 'TRUE') {
            const dnsExportedFunctions = Object.keys(dns);
            Object.keys(rrtypesMethods).forEach((functionToTrace) => {
                if (dnsExportedFunctions.includes(functionToTrace)) {
                    shimmer.wrap(dns, functionToTrace, wrapDnsResolveFunction);
                }
            });
            shimmer.wrap(dns, 'resolve', () => wrapDnsResolveFunction(dns.resolve));
            shimmer.wrap(dns, 'reverse', () => wrapDnsReverseFunction(dns.reverse));
            shimmer.wrap(dns, 'lookup', () => wrapDnsLookupFunction(dns.lookup));
            shimmer.wrap(dns, 'lookupService', () => wrapDnsLookupServiceFunction(dns.lookupService));
        }
    },
};
