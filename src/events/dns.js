const uuid4 = require('uuid4');
const dns = require('dns');
const shimmer = require('shimmer');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

// BLACKLIST
const URL_BLACKLIST = {
    'tc.epsagon.com': 'endsWith',
};
/**
 * Checks if a URL is in the blacklist
 * @param {string} url The URL to check
 * @param {string} path The Path to check (optional)
 * @returns {boolean} True if it is in the blacklist, False otherwise
 */
function isBlacklistURL(url, path) {
    return Object.keys(URL_BLACKLIST).some((key) => {
        if (typeof URL_BLACKLIST[key] === typeof (() => {})) {
            return URL_BLACKLIST[key](url, key, path);
        }
        return url[URL_BLACKLIST[key]](key);
    });
}

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

const endDurationAndAddCallbackMetadata = (dnsEvent, startTime, err, metadata) => {
    dnsEvent.setDuration(utils.createDurationTimestamp(startTime));
    if (err) {
        eventInterface.setException(dnsEvent, err);
    } else {
        eventInterface.addToMetadata(dnsEvent, { ...metadata });
    }
};

const getRrtypeArguments = (arg1, arg2, arg3, functionName) => {
    const hostname = arg1;
    let rrtype = arg2;
    let callback = arg3;
    if (!arg3) {
        if (functionName) {
            rrtype = Object.values(rrtypesMethods).find(type => functionName.toLocaleLowerCase().includes((`query${type}`.toLocaleLowerCase())));
        } else {
            rrtype = rrtypesMethods.resolve4;
        }
        callback = arg2;
    }
    return { hostname, rrtype, callback };
};

const getArguments = (arg1, arg2, arg3) => {
    const hostname = arg1;
    let options = arg2;
    let callback = arg3;
    if (!arg3) {
        options = undefined;
        callback = arg2;
    }
    return { hostname, options, callback };
};

const buildParams = (arg1, arg2, arg3) => {
    if (!arg3) {
        return [arg1, arg2];
    }
    return [arg1, arg2, arg3];
};

const wrapDnsResolveFunction = original => (arg1, arg2, arg3) => {
    let patchedCallback;
    let clientRequest;
    let options;
    const { hostname, rrtype, callback } = getRrtypeArguments(arg1, arg2, arg3, original.name);
    if (!callback) return original.apply(this, buildParams(arg1, arg2, arg3));
    if (typeof arg2 === 'object') options = arg2;
    try {
        const { dnsEvent, startTime } = initialDnsEvent(original.name);
        let requestArg2;
        if (options) {
            requestArg2 = { options };
        } else {
            requestArg2 = { 'Resource record type': rrtype };
        }
        eventInterface.addToMetadata(dnsEvent, { hostname, ...requestArg2 });
        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, arg) => {
                let callbackArg;
                if (options) {
                    callbackArg = { addresses: arg };
                } else {
                    callbackArg = { records: arg };
                }
                endDurationAndAddCallbackMetadata(dnsEvent, startTime, err, { ...callbackArg });
                resolve();
                if (callback) callback(err, arg);
            };
        });
        clientRequest = original.apply(this, [hostname, rrtype, patchedCallback]);
        tracer.addEvent(dnsEvent, responsePromise);
    } catch (err) {
        tracer.addException(err);
    }
    if (!clientRequest) {
        clientRequest = original.apply(this, buildParams(arg1, arg2, arg3));
    }
    return clientRequest;
};

const wrapDnsLookupServiceFunction = original => (address, port, callback) => {
    let patchedCallback;
    let clientRequest;
    if (!callback) return original.apply(this, buildParams(address, port, callback));
    try {
        const { dnsEvent, startTime } = initialDnsEvent(original.name);
        eventInterface.addToMetadata(dnsEvent, { address, port });
        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, hostname, service) => {
                endDurationAndAddCallbackMetadata(dnsEvent, startTime, err, { hostname, service });
                resolve();
                if (callback) callback(err, hostname, service);
            };
        });
        clientRequest = original.apply(this, [address, port, patchedCallback]);
        tracer.addEvent(dnsEvent, responsePromise);
    } catch (err) {
        tracer.addException(err);
    }
    if (!clientRequest) {
        clientRequest = original.apply(this, buildParams(address, port, callback));
    }
    return clientRequest;
};

const wrapDnsReverseFunction = original => (ip, callback) => {
    let patchedCallback;
    let clientRequest;
    try {
        const { dnsEvent, startTime } = initialDnsEvent(original.name);
        eventInterface.addToMetadata(dnsEvent, { ip });
        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, hostnames) => {
                endDurationAndAddCallbackMetadata(dnsEvent, startTime, err, { hostnames });
                resolve();
                if (callback) callback(err, hostnames);
            };
        });
        clientRequest = original.apply(this, [ip, patchedCallback]);
        tracer.addEvent(dnsEvent, responsePromise);
    } catch (err) {
        tracer.addException(err);
    }
    if (!clientRequest) {
        clientRequest = original.apply(this, [ip, callback]);
    }
    return clientRequest;
};

const wrapDnsLookupFunction = original => (arg1, arg2, arg3) => {
    let patchedCallback;
    let clientRequest;
    const { hostname, options, callback } = getArguments(arg1, arg2, arg3);
    if (isBlacklistURL(hostname)) {
        utils.debugLog(`filtered blacklist hostname ${hostname}`);
        return original.apply(this, buildParams(arg1, arg2, arg3));
    }
    try {
        const { dnsEvent, startTime } = initialDnsEvent(original.name);
        eventInterface.addToMetadata(dnsEvent, { hostname });
        if (options) eventInterface.addToMetadata(dnsEvent, { options });
        const responsePromise = new Promise((resolve) => {
            patchedCallback = (err, address, family) => {
                endDurationAndAddCallbackMetadata(dnsEvent, startTime, err, { address, family });
                resolve();
                if (callback) callback(err, address, family);
            };
        });
        clientRequest = original.apply(this, buildParams(hostname, options, patchedCallback));
        tracer.addEvent(dnsEvent, responsePromise);
    } catch (err) {
        tracer.addException(err);
    }
    if (!clientRequest) {
        clientRequest = original.apply(this, buildParams(arg1, arg2, arg3));
    }
    return clientRequest;
};

module.exports = {
    /**
     * Initializes the dns tracer
     */
    init() {
        Object.keys(rrtypesMethods).forEach((functionToTrace) => {
            shimmer.wrap(dns, functionToTrace, wrapDnsResolveFunction);
        });
        shimmer.wrap(dns, 'resolve', () => wrapDnsResolveFunction(dns.resolve));
        shimmer.wrap(dns, 'reverse', () => wrapDnsReverseFunction(dns.reverse));
        shimmer.wrap(dns, 'lookup', () => wrapDnsLookupFunction(dns.lookup));
        shimmer.wrap(dns, 'lookupService', () => wrapDnsLookupServiceFunction(dns.lookupService));
    },
};
