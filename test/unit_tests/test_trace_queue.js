/* eslint-disable no-console */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { expect } = require('chai');
const TraceQueue = require('../../src/trace_queue.js');
// const config = require('../../src/config.js');
// const consts = require('../../src/consts.js');

chai.use(chaiAsPromised);

const traceQueue = TraceQueue.getInstance();

describe('trace queue tests', () => {
    // const DEFAULT_CONFIG = {
    //     token: '',
    //     appName: 'Application',
    //     metadataOnly: true,
    //     useSSL: true,
    //     traceCollectorURL: consts.TRACE_COLLECTOR_URL,
    //     ignoredKeys: [],
    //     sendTimeout: 200,
    //     sendBatch: false,
    // };


    // function resetConfig() {
    //     Object.assign(config.getConfig(), DEFAULT_CONFIG);
    // }

    beforeEach(() => {
        // resetConfig();
        traceQueue.initQueue();
        traceQueue.batchSender = function batchSender(batch) {
            console.log(`Sending batch: ${batch.map(trace => trace)}`);
            return batch;
        };
    });

    it('push single trace', () => {
        traceQueue.batchSize = 5;
        const traces = ['trace_1'];
        traceQueue.push(traces[0]);
        expect(traceQueue.currentSize).to.equal(1);
    });
    it('push traces without reaching maximum', () => {
        traceQueue.batchSize = 5;
        const traces = ['trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        expect(traceQueue.currentSize).to.equal(4);
        expect(traceQueue.queue.map(trace => trace.json)).to.eql(traces);
    });

    it('push traces with reaching batch size', () => {
        traceQueue.batchSize = 5;
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
        expect(traceQueue.currentSize).to.equal(0);
    });
    it('release batch on reaching batch size', (done) => {
        traceQueue.batchSize = 5;
        // console.log(traceQueue.maxBatchSizeBytes);
        console.log(traceQueue.maxQueueSizeBytes);
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.on('batchReleased', (batch) => {
            expect(traceQueue.currentSize).to.equal(0);
            expect(batch.map(trace => trace.json)).to.eql(traces);
            done();
        });

        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
    });
    it('sending batch on reaching batch size', (done) => {
        traceQueue.batchSize = 5;
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.on('batchReleased', (batch) => {
            expect(traceQueue.currentSize).to.equal(0);
            expect(batch.map(trace => trace.json)).to.eql(traces);
            done();
        });
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
    });
    it('push traces while not reaching byte size limit', () => {
        traceQueue.batchSize = 5;
        traceQueue.maxBatchSizeBytes = 32;
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.push(traces[0]);
        expect(traceQueue.currentSize).to.equal(1);
        expect(traceQueue.queue[0].json).to.eql('trace_1');
    });
    it('push traces while reaching more than byte size limit', () => {
        traceQueue.batchSize = 5;
        traceQueue.maxBatchSizeBytes = 32;
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5', 'trace_6'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
        traceQueue.push(traces[5]);
        expect(traceQueue.currentSize).to.equal(3);
        expect(traceQueue.queue.map(trace => trace.json)).to.eql(['trace_4', 'trace_5', 'trace_6']);
    });
    it('push traces while reaching no more than byte size limit', () => {
        traceQueue.batchSize = 5;
        traceQueue.maxBatchSizeBytes = 20;
        const traces = ['trace_1', 'trace_2', 'trace_3'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        expect(traceQueue.currentSize).to.equal(1);
        expect(traceQueue.queue[0].json).to.eql('trace_3');
    });
    it('push big trace larger than batch size limit', () => {
        traceQueue.batchSize = 5;
        traceQueue.maxBatchSizeBytes = 5;
        const traces = ['trace_1'];
        traceQueue.push(traces[0]);
        expect(traceQueue.currentSize).to.equal(0);
    });
    it('push big trace larger than queue size limit', () => {
        traceQueue.batchSize = 5;
        traceQueue.maxQueueSizeBytes = 8;
        traceQueue.maxBatchSizeBytes = 100;

        console.log(traceQueue.queue);
        const traces = ['trace_1', 'trace_2'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        expect(traceQueue.currentSize).to.equal(1);
    });
});
