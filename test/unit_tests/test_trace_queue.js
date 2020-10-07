/* eslint-disable no-console */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { expect } = require('chai');
const traceQueue = require('../../src/trace_queue.js');

// queue.on('traceQueued', (trace) => {});
// queue.on('batchReady', (queueSize) => {});
// queue.on('sendingBatch', (batch) => {});
// queue.on('batchSent', (batch) => {});

chai.use(chaiAsPromised);


describe('trace queue push test', () => {
    beforeEach(() => {
        traceQueue.flush();
        traceQueue.removeAllListeners();
    });

    it('push single trace', () => {
        const traces = ['trace_1'];

        traceQueue.on('traceQueued', (trace) => { expect(trace).to.equal(traces[0]); });

        traceQueue.push(traces[0]);
        expect(traceQueue.length).to.equal(1);
    });
    it('push traces without reaching maximum', () => {
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4'];
        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        expect(traceQueue.length).to.equal(4);
        expect(traceQueue.traces.map(trace => trace.trace)).to.eql(traces);
    });
    it('push traces with reaching batch size', (done) => {
        const traces = ['trace_1', 'trace_2', 'trace_3', 'trace_4', 'trace_5'];

        traceQueue.on('sendingBatch', (batch) => {
            expect(batch.length).to.equal(5);
            expect(batch).to.eql(traces);
        });

        traceQueue.on('batchSent', (batch) => {
            expect(batch.length).to.equal(5);
            expect(batch).to.eql(traces);
            done();
        });

        traceQueue.push(traces[0]);
        traceQueue.push(traces[1]);
        traceQueue.push(traces[2]);
        traceQueue.push(traces[3]);
        traceQueue.push(traces[4]);
        expect(traceQueue.length).to.equal(0);
    }).timeout(10000);
});
