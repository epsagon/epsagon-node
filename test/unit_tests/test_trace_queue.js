/* eslint-disable no-console */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { expect } = require('chai');
const TraceQueue = require('../../src/trace_queue.js');

chai.use(chaiAsPromised);

const traceQueue = TraceQueue.getInstance();

describe('trace queue tests', () => {
    beforeEach(() => {
        traceQueue.initQueue();
        traceQueue.batchSender = function batchSender(batch) {
            console.log(`Sending batch: ${batch}`);
            return batch;
        };
        traceQueue.batchSize = 5;
    });

    it('push single trace', () => {
        const traces = ['trace_1'];
        traceQueue.push(traces[0]);
        expect(traceQueue.currentSize).to.equal(1);
    });
    it('push traces without reaching maximum', () => {
        const traces = ['trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        expect(traceQueue.currentSize).to.equal(4);
        expect(traceQueue.traces.map(trace => trace.trace)).to.eql(traces);
    });

    it('push traces with reaching batch size', () => {
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
        expect(traceQueue.currentSize).to.equal(0);
    });
    it('release batch on reaching batch size', (done) => {
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.on('batchReleased', (batch) => {
            expect(traceQueue.currentSize).to.equal(0);
            expect(batch).to.eql(traces);
            done();
        });

        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
    });
    it('sending batch on reaching batch size', (done) => {
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];

        traceQueue.on('batchSent', (batch) => {
            expect(traceQueue.currentSize).to.equal(0);
            expect(batch).to.eql(traces);
            done();
        });
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
    });
    it('push traces while not reaching byte size limit', () => {
        traceQueue.batchBytesLimit = 21;
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.push(traces[0]);
        expect(traceQueue.currentSize).to.equal(1);
    });
    it('push traces while reaching more than byte size limit', () => {
        traceQueue.batchBytesLimit = 21;
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
        expect(traceQueue.currentSize).to.equal(2);
    });
    it('push traces while reaching no more than byte size limit', () => {
        traceQueue.batchBytesLimit = 21;
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        expect(traceQueue.currentSize).to.equal(0);
    });
});
