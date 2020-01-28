const { expect } = require('chai');
const consts = require('../../src/consts.js');
const config = require('../../src/config.js');


describe('tracer config tests', () => {
    const DEFAULT_CONFIG = {
        token: '',
        appName: 'Application',
        metadataOnly: true,
        useSSL: true,
        traceCollectorURL: consts.TRACE_COLLECTOR_URL,
        ignoredKeys: [],
        sendTimeout: 200,
    };


    function resetConfig() {
        Object.assign(config.getConfig(), DEFAULT_CONFIG);
    }

    beforeEach(() => {
        resetConfig();
    });

    it('setConfig: empty config', () => {
        config.setConfig({});
        expect(config.getConfig()).to.contain(DEFAULT_CONFIG);
    });

    it('setConfig: undefined config', () => {
        config.setConfig();
        expect(config.getConfig()).to.contain(DEFAULT_CONFIG);
    });

    it('setConfig: empty config on non default config', () => {
        const token = 'notdefault';
        config.setConfig({ token });
        const updatedConfig = DEFAULT_CONFIG;
        updatedConfig.token = token;
        expect(config.getConfig()).to.contain(updatedConfig);
    });

    it('setConfig: update no ssl traces url', () => {
        const useSSL = false;
        config.setConfig({ useSSL });
        const updatedConfig = DEFAULT_CONFIG;
        updatedConfig.useSSL = useSSL;
        updatedConfig.traceCollectorURL = 'http://us-east-1.tc.epsagon.com';
        expect(config.getConfig()).to.contain(updatedConfig);
    });

    it('setConfig: custom traces url', () => {
        const traceCollectorURL = 'https://custom.tc.epsagon.com';
        config.setConfig({ traceCollectorURL });
        const updatedConfig = DEFAULT_CONFIG;
        updatedConfig.traceCollectorURL = traceCollectorURL;
        expect(config.getConfig()).to.contain(updatedConfig);
    });

    it('setConfig: custom traces url without SSL', () => {
        const traceCollectorURL = 'https://custom.tc.epsagon.com';
        const useSSL = false;
        config.setConfig({ traceCollectorURL, useSSL });
        const updatedConfig = DEFAULT_CONFIG;
        updatedConfig.useSSL = useSSL;
        updatedConfig.traceCollectorURL = traceCollectorURL.replace(
            'https://',
            'http://'
        );
        expect(config.getConfig()).to.contain(updatedConfig);
    });

    it('setConfig: set custom HTTP error code', () => {
        const httpErrorStatusCode = 42;
        config.setConfig({ httpErrorStatusCode });
        expect(config.HTTP_ERR_CODE).to.be.equal(httpErrorStatusCode);
    });

    it('setConfig: set custom sendTimeout', () => {
        const sendTimeout = 1000;
        config.setConfig({ sendTimeout });
        expect(config.getConfig().sendTimeout).to.be.equal(sendTimeout);
    });
});
