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

    it('setConfig: set decodeHTTP to false', () => {
        config.setConfig({ decodeHTTP: false });
        expect(config.getConfig()).to.contain({ decodeHTTP: false });
    });

    it('setConfig: set custom sendTimeout', () => {
        const sendTimeout = 1000;
        config.setConfig({ sendTimeout });
        expect(config.getConfig().sendTimeout).to.be.equal(sendTimeout);

        const sendTimeoutString = '1000';
        config.setConfig({ sendTimeout: sendTimeoutString });
        expect(config.getConfig().sendTimeout).to.be.equal(Number(sendTimeoutString));

        const invalidSendTimeoutStrings = ['1200.1.1', 'affewfew', '4.4.a', '234a', '', null, undefined, 0];
        invalidSendTimeoutStrings.forEach((invalidSendTimeoutString) => {
            config.setConfig({ sendTimeout: invalidSendTimeoutString });
            // checking the old value did not change
            expect(config.getConfig().sendTimeout).to.be.equal(Number(sendTimeoutString));
        });
    });


    it('setConfig: set custom maxBatchSizeBytes', () => {
        const maxBatchSizeBytes = 10;
        config.setConfig({ maxBatchSizeBytes });
        expect(config.getConfig().maxBatchSizeBytes).to.be.equal(maxBatchSizeBytes);

        const maxBatchSizeBytesString = '10';
        config.setConfig({ maxBatchSizeBytes: maxBatchSizeBytesString });
        expect(config.getConfig().maxBatchSizeBytes).to.be.equal(Number(maxBatchSizeBytesString));

        const invalidmaxBatchSizeBytesStrings = ['1200.1.1', 'affewfew', '4.4.a', '234a', '', null, undefined, 0];
        invalidmaxBatchSizeBytesStrings.forEach((invalidmaxBatchSizeBytesString) => {
            config.setConfig({ maxBatchSizeBytes: invalidmaxBatchSizeBytesString });
            // checking the old value did not change
            expect(config.getConfig().maxBatchSizeBytes)
                .to.be.equal(Number(maxBatchSizeBytesString));
        });
    });

    it('setConfig: set custom maxQueueSizeBytes', () => {
        const maxQueueSizeBytes = 10;
        config.setConfig({ maxQueueSizeBytes });
        expect(config.getConfig().maxQueueSizeBytes).to.be.equal(maxQueueSizeBytes);

        const maxQueueSizeBytesString = '10';
        config.setConfig({ maxQueueSizeBytes: maxQueueSizeBytesString });
        expect(config.getConfig().maxQueueSizeBytes).to.be.equal(Number(maxQueueSizeBytesString));

        const invalidmaxQueueSizeBytesStrings = ['1200.1.1', 'affewfew', '4.4.a', '234a', '', null, undefined, 0];
        invalidmaxQueueSizeBytesStrings.forEach((invalidmaxQueueSizeBytesString) => {
            config.setConfig({ maxQueueSizeBytes: invalidmaxQueueSizeBytesString });
            // checking the old value did not change
            expect(config.getConfig().maxQueueSizeBytes)
                .to.be.equal(Number(maxQueueSizeBytesString));
        });
    });

    it('setConfig: set custom maxTraceWait', () => {
        const maxTraceWait = 1000;
        config.setConfig({ maxTraceWait });
        expect(config.getConfig().maxTraceWait).to.be.equal(maxTraceWait);

        const maxTraceWaitString = '1000';
        config.setConfig({ maxTraceWait: maxTraceWaitString });
        expect(config.getConfig().maxTraceWait).to.be.equal(Number(maxTraceWaitString));

        const invalidMaxTraceWaitStrings = ['1200.1.1', 'affewfew', '4.4.a', '234a', '', null, undefined, 0];
        invalidMaxTraceWaitStrings.forEach((invalidMaxTraceWaitString) => {
            config.setConfig({ maxTraceWait: invalidMaxTraceWaitString });
            // checking the old value did not change
            expect(config.getConfig().maxTraceWait).to.be.equal(Number(maxTraceWaitString));
        });
    });

    it('setConfig: set custom batchSize', () => {
        const batchSize = 10;
        config.setConfig({ batchSize });
        expect(config.getConfig().batchSize).to.be.equal(batchSize);

        const batchSizeString = '10';
        config.setConfig({ batchSize: batchSizeString });
        expect(config.getConfig().batchSize).to.be.equal(Number(batchSizeString));

        const invalidbatchSizeStrings = ['1200.1.1', 'affewfew', '4.4.a', '234a', '', null, undefined, 0];
        invalidbatchSizeStrings.forEach((invalidbatchSizeString) => {
            config.setConfig({ batchSize: invalidbatchSizeString });
            // checking the old value did not change
            expect(config.getConfig().batchSize).to.be.equal(Number(batchSizeString));
        });
    });


    it('setConfig: set custom batch send', () => {
        const sendBatch = true;
        config.setConfig({ sendBatch });
        expect(config.getConfig().sendBatch).to.be.equal(true);
    });
});
