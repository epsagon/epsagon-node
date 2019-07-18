const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { expect } = require('chai');
const sinon = require('sinon');
const serverlessEvent = require('../../src/proto/event_pb.js');
const consts = require('../../src/consts.js');
const tracer = require('../../src/tracer.js');
const tracerObj = require('../../src/trace_object.js');
const config = require('../../src/config.js');
const maxtrace = require('../../src/consts').MAX_TRACE_SIZE_BYTES;
const bigtrace = require('./fixtures/bigtrace.json');

chai.use(chaiAsPromised);

describe('tracer restart tests - if these fail the others will too', () => {
    it('restart: restart when trace is empty', () => {
        tracer.getTrace = tracerObj.get;
        tracer.restart();
        const runnerToAdd = new serverlessEvent.Event();
        tracer.addRunner(runnerToAdd);
        expect(tracerObj.get().trace.getEventList().length).to.equal(1);
        expect(tracerObj.get().trace.getExceptionList()).to.be.empty;
    });

    it('restart: restart when trace is not empty', () => {
        tracer.getTrace = tracerObj.get;
        tracer.initTrace({ token: 'token', appName: 'app' });
        tracer.addEvent(new serverlessEvent.Event());
        tracer.addException(new Error('test error'));
        tracer.restart();
        tracer.addRunner(new serverlessEvent.Event());
        expect(tracerObj.get().trace.getEventList().length).to.equal(1);
        expect(tracerObj.get().trace.getExceptionList()).to.be.empty;
        expect(tracerObj.get().trace.getAppName()).to.equal('app');
        expect(tracerObj.get().trace.getToken()).to.equal('token');
    });
});

describe('filter keys function', () => {
    it('filterTrace: filter from metadata', () => {
        const traceObject = {
            events: [{
                resource: {
                    metadata: {
                        studentId: 'personal',
                        message: 'not-personal',
                    },
                },
            }],
        };
        const ignoredKeys = ['studentid'];
        const filtered = tracer.filterTrace(traceObject, ignoredKeys);
        const expected = {
            events: [{
                resource: {
                    metadata: { message: 'not-personal' },
                },
            }],
        };

        expect(filtered).to.deep.equal(expected);
    });

    it('filterTrace: filter event without metadata', () => {
        const traceObject = {
            events: [{
                resource: {
                    something: 'bla',
                },
            }],
        };
        const ignoredKeys = ['studentid'];
        const filtered = tracer.filterTrace(traceObject, ignoredKeys);
        expect(filtered).to.deep.equal(traceObject);
    });

    it('filterTrace: filter recursively', () => {
        const traceObject = {
            events: [{
                resource: {
                    metadata: {
                        field: {
                            studentId: 'personal',
                            message: 'not-personal',
                        },
                    },
                },
            }],
        };
        const ignoredKeys = ['studentid'];
        const filtered = tracer.filterTrace(traceObject, ignoredKeys);
        const expected = {
            events: [{
                resource: {
                    metadata: { field: { message: 'not-personal' } },
                },
            }],
        };

        expect(filtered).to.deep.equal(expected);
    });
});

describe('tracer module tests', () => {
    beforeEach(() => {
        const runnerResource = new serverlessEvent.Resource([
            'mock-func',
            'lambda',
            'invoke',
            {},
        ]);

        const runner = new serverlessEvent.Event([
            'id_123',
            0,
            null,
            'runner',
            0,
            0,
        ]);
        runner.setResource(runnerResource);

        tracer.restart();
        tracer.addRunner(runner);
        this.postStub = sinon.stub(
            tracer,
            'postTrace'
        ).returns(Promise.resolve(true));
        this.setConfigStub = sinon.stub(
            config,
            'setConfig'
        );
        this.baseConfig = config.getConfig();
        this.getConfigStub = sinon.stub(
            config,
            'getConfig'
        ).returns(this.baseConfig);
    });

    afterEach(() => {
        if (this.postStub) this.postStub.restore();
        this.setConfigStub.restore();
        this.getConfigStub.restore();
    });

    function validateTrace(token, appName) {
        expect(tracerObj.get().trace.getToken()).to.equal(token);
        expect(tracerObj.get().trace.getAppName()).to.equal(appName);
        expect(tracerObj.get().trace.getEventList().length).to.equal(1);
        expect(tracerObj.get().trace.getExceptionList()).to.be.empty;
        expect(tracerObj.get().trace.getVersion()).to.equal(consts.VERSION);
        expect(tracerObj.get().trace.getPlatform()).to.equal(
            `node ${process.versions.node}`
        );
    }

    it('initTrace: initialize the tracer', () => {
        tracer.initTrace();
        expect(this.setConfigStub.calledOnce).to.be.true;
    });

    it('initTrace: don\'t update COLD_START value', () => {
        consts.COLD_START = true;
        tracer.initTrace();
        expect(consts.COLD_START).to.be.true;
    });

    it('initTrace: keep COLD_START true after more then 1 call', () => {
        consts.COLD_START = true;
        tracer.initTrace();
        expect(consts.COLD_START).to.be.true;

        tracer.initTrace();
        expect(consts.COLD_START).to.be.true;
    });

    it('initTrace: accept token and appName config', () => {
        const params = { token: 'token1', appName: 'app1' };
        tracer.initTrace(params);
        this.setConfigStub.calledOn(params);
    });

    it('restart: accept token and appName on tracer', () => {
        this.baseConfig.token = 'token1';
        this.baseConfig.appName = 'app1';
        this.getConfigStub.returns(this.baseConfig);
        tracer.restart();
        tracer.addRunner(new serverlessEvent.Event());
        validateTrace('token1', 'app1');
    });

    it('addEvent: add the event to the tracer', () => {
        tracer.getTrace = tracerObj.get;
        const eventToAdd = new serverlessEvent.Event();
        tracer.addEvent(eventToAdd);
        expect(tracerObj.get().trace.getEventList()[1]).to.equal(eventToAdd);
    });

    it('addEvent: add more then one event', () => {
        tracer.getTrace = tracerObj.get;
        const firstEventToAdd = new serverlessEvent.Event();
        tracer.addEvent(firstEventToAdd);
        expect(tracerObj.get().trace.getEventList()[1]).to.equal(firstEventToAdd);

        const secondEventToAdd = new serverlessEvent.Event();
        tracer.addEvent(secondEventToAdd);
        expect(tracerObj.get().trace.getEventList()[1]).to.equal(firstEventToAdd);
        expect(tracerObj.get().trace.getEventList()[2]).to.equal(secondEventToAdd);
    });

    it('addEvent: add an event and a result promise to the tracer', () => {
        tracer.getTrace = tracerObj.get;
        const eventToAdd = new serverlessEvent.Event();
        let shouldPromiseResolve = false;
        const stubPromise = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseResolve) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd, stubPromise);
        expect(tracerObj.get().trace.getEventList()[1]).to.equal(eventToAdd);
        const sendTracePromise = tracer.sendTrace(() => {}).then(() => {
            expect(this.postStub.called).to.be.true;
        });
        expect(this.postStub.called).to.be.false;
        shouldPromiseResolve = true;
        return sendTracePromise;
    });

    it('addLabel: Add a label to the trace', () => {
        tracer.getTrace = tracerObj.get;
        tracer.label('label1', 'value1');
        const labels = JSON.parse(tracerObj.get().trace.getEventList()[0].getResource().getMetadataMap().get('labels'));
        expect(labels.label1).to.equal('value1');
    });

    it('addLabel: Override existing label', () => {
        tracer.getTrace = tracerObj.get;
        tracer.label('label1', 'value1');
        tracer.label('label1', 'value2');
        const labels = JSON.parse(tracerObj.get().trace.getEventList()[0].getResource().getMetadataMap().get('labels'));
        expect(labels.label1).to.equal('value2');
    });

    it('addLabel: Labels too big - 1 label', () => {
        tracer.getTrace = tracerObj.get;
        const bigString = 'x'.repeat(100 * 1024);
        tracer.label('label1', bigString);
        const labels = tracerObj.get().trace.getEventList()[0].getResource().getMetadataMap().get('labels');
        expect(labels).to.equal(undefined);
    });

    it('addLabel: Labels too big - multiple labels', () => {
        tracer.getTrace = tracerObj.get;
        const expectedLabel1 = 'x'.repeat(70 * 1024);

        tracer.label('label1', expectedLabel1);
        tracer.label('label2', 'x'.repeat(40 * 1024));

        const labels = JSON.parse(tracerObj.get().trace.getEventList()[0].getResource().getMetadataMap().get('labels'));
        expect(labels.label1).to.equal(expectedLabel1);
        expect(labels.label2).to.equal(undefined);
    });

    function checkException(storedException, originalException, additionalData) {
        expect(storedException.getType()).to.equal(originalException.name);
        expect(storedException.getMessage()).to.equal(originalException.message);
        expect(storedException.getTraceback()).to.equal(originalException.stack);
        expect(storedException.getTime()).to.be.ok;

        if (typeof additionalData === 'object') {
            Object.keys(additionalData).forEach((key) => {
                expect(storedException.getAdditionalDataMap().get(key)).to.equal(
                    additionalData[key]
                );
            });
            expect(Object.keys(additionalData).length).to.equal(
                storedException.getAdditionalDataMap().getLength()
            );
        }
    }

    it('addException: adds an exception to the tracer', () => {
        tracer.getTrace = tracerObj.get;
        const error = Error('this is an error');
        tracer.addException(error);
        checkException(tracerObj.get().trace.getExceptionList()[0], error);
    });

    it('addException: adds an exception to the tracer with additional data', () => {
        tracer.getTrace = tracerObj.get;
        const error = Error('this is an error');
        const additionalData = { key: 'value', key2: 'value2' };
        tracer.addException(error, additionalData);
        checkException(tracerObj.get().trace.getExceptionList()[0], error, additionalData);
    });
    it('addException: adds an exception to the tracer with additional data undefined', () => {
        tracer.getTrace = tracerObj.get;
        const error = Error('this is an error');
        const additionalData = { key: 'value', key2: undefined };
        tracer.addException(error, additionalData);
        checkException(
            tracerObj.get().trace.getExceptionList()[0],
            error,
            { key: 'value', key2: 'undefined' }
        );
    });

    it('addException: add more then one exception', () => {
        tracer.getTrace = tracerObj.get;
        const firstError = Error('this is an error');
        tracer.addException(firstError);
        checkException(tracerObj.get().trace.getExceptionList()[0], firstError);

        const secondError = Error('this is an error');
        tracer.addException(secondError);
        checkException(tracerObj.get().trace.getExceptionList()[1], secondError);
    });

    it('setError: setting an error to runner', () => {
        tracer.getTrace = tracerObj.get;
        const firstError = Error('this is an error');
        tracer.setError(firstError);
        checkException(tracerObj.get().trace.getEventList()[0].getException(), firstError);
    });

    it('sendTrace: post when no events pending', () => {
        let sendPromise = tracer.sendTrace(() => {});
        expect(sendPromise).to.be.a('promise');
        sendPromise = sendPromise.then(() => {
            expect(this.postStub.called).to.be.true;
        });

        expect(this.postStub.called).to.be.false;
        return sendPromise;
    });

    it('sendTrace: post after all events resolved', () => {
        const eventToAdd = new serverlessEvent.Event();
        let shouldPromiseResolve = false;
        const stubPromise = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseResolve) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd, stubPromise);

        let sendPromise = tracer.sendTrace(() => {});
        expect(sendPromise).to.be.a('promise');
        sendPromise = sendPromise.then(() => {
            expect(this.postStub.called).to.be.true;
        });

        expect(this.postStub.called).to.be.false;
        shouldPromiseResolve = true;
        return sendPromise;
    });

    it('sendTrace: post even if event rejected', () => {
        const eventToAdd = new serverlessEvent.Event();
        let shouldPromiseEnd = false;
        const stubPromise = new Promise((resolve, reject) => {
            function checkFlag() {
                if (!shouldPromiseEnd) {
                    setTimeout(checkFlag, 10);
                } else {
                    reject();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd, stubPromise);

        let sendPromise = tracer.sendTrace(() => {});
        expect(sendPromise).to.be.a('promise');
        sendPromise = sendPromise.then(() => {
            expect(this.postStub.called).to.be.true;
        });

        expect(this.postStub.called).to.be.false;
        shouldPromiseEnd = true;
        return sendPromise;
    });

    it('sendTrace: wait for more then 1 event', () => {
        const eventToAdd1 = new serverlessEvent.Event();
        let shouldPromiseEnd1 = false;
        const stubPromise1 = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd1) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd1, stubPromise1);

        const eventToAdd2 = new serverlessEvent.Event();
        let shouldPromiseEnd2 = false;
        const stubPromise2 = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd2) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd2, stubPromise2);

        let sendPromise = tracer.sendTrace(() => {});
        expect(sendPromise).to.be.a('promise');
        sendPromise = sendPromise.then(() => {
            expect(this.postStub.called).to.be.true;
        });

        expect(this.postStub.called).to.be.false;
        shouldPromiseEnd1 = true;
        expect(this.postStub.called).to.be.false;
        shouldPromiseEnd2 = true;
        return sendPromise;
    });

    it('sendTrace: wait for more then 1 event even if some rejects', () => {
        const eventToAdd1 = new serverlessEvent.Event();
        let shouldPromiseEnd1 = false;
        const stubPromise1 = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd1) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd1, stubPromise1);

        const eventToAdd2 = new serverlessEvent.Event();
        let shouldPromiseEnd2 = false;
        const stubPromise2 = new Promise((resolve, reject) => {
            function checkFlag() {
                if (!shouldPromiseEnd2) {
                    setTimeout(checkFlag, 10);
                } else {
                    reject();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd2, stubPromise2);

        let sendPromise = tracer.sendTrace(() => {});
        expect(sendPromise).to.be.a('promise');
        sendPromise = sendPromise.then(() => {
            expect(this.postStub.called).to.be.true;
        });

        expect(this.postStub.called).to.be.false;
        shouldPromiseEnd1 = true;
        expect(this.postStub.called).to.be.false;
        shouldPromiseEnd2 = true;
        return sendPromise;
    });

    it('sendTrace: calling set runner duration function', () => {
        const callback = sinon.stub();

        const sendPromise = tracer.sendTrace(callback).then(() => {
            expect(callback.called).to.be.true;
        });

        expect(callback.called).to.be.false;
        return sendPromise;
    });
});

describe('sendTraceSync function tests', () => {
    beforeEach(() => {
        tracer.restart();
        tracer.addRunner(new serverlessEvent.Event());
        this.setConfigStub = sinon.stub(
            config,
            'setConfig'
        );
        this.postStub = sinon.stub(
            tracer,
            'postTrace'
        ).returns(Promise.resolve(true));
    });

    afterEach(() => {
        this.setConfigStub.restore();
        this.postStub.restore();
    });

    it('sendTraceSync: post when no events pending', () => {
        tracer.sendTraceSync();
        expect(this.postStub.calledOnce).to.be.true;
    });

    it('sendTraceSync: post event if not all events resolved', () => {
        const eventToAdd = new serverlessEvent.Event();
        let shouldPromiseEnd = false;
        const stubPromise = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd, stubPromise);
        tracer.sendTraceSync();

        expect(this.postStub.calledOnce).to.be.true;
        shouldPromiseEnd = true;
    });

    it('sendTraceSync: post even if event rejected', () => {
        const eventToAdd = new serverlessEvent.Event();
        const stubPromise = Promise.reject(new Error('failed'));
        tracer.addEvent(eventToAdd, stubPromise);

        tracer.sendTraceSync();
        expect(this.postStub.calledOnce).to.be.true;
    });

    it('sendTraceSync: send even with for more then 1 event pending', () => {
        const eventToAdd1 = new serverlessEvent.Event();
        let shouldPromiseEnd1 = false;
        const stubPromise1 = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd1) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd1, stubPromise1);

        const eventToAdd2 = new serverlessEvent.Event();
        let shouldPromiseEnd2 = false;
        const stubPromise2 = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd2) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd2, stubPromise2);
        tracer.sendTraceSync();
        expect(this.postStub.calledOnce).to.be.true;
        shouldPromiseEnd1 = true;
        shouldPromiseEnd2 = true;
    });

    it('sendTraceSync: there is more then 1 event and some rejects', () => {
        const eventToAdd1 = new serverlessEvent.Event();
        let shouldPromiseEnd1 = false;
        const stubPromise1 = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd1) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd1, stubPromise1);

        const eventToAdd2 = new serverlessEvent.Event();
        const stubPromise2 = Promise.reject();

        tracer.addEvent(eventToAdd2, stubPromise2);

        tracer.sendTraceSync();

        expect(this.postStub.calledOnce).to.be.true;
        shouldPromiseEnd1 = true;
    });

    it('sendTraceSync: send too big trace', () => {
        const eventToAdd1 = new serverlessEvent.Event([
            'x'.repeat(100 * 1024),
            0,
            null,
            'operation',
            0,
            0,
        ]);

        let shouldPromiseEnd1 = false;
        const stubPromise1 = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd1) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd1, stubPromise1);

        const eventToAdd2 = new serverlessEvent.Event([
            'id_123',
            0,
            null,
            'runner',
            0,
            0,
        ]);

        let shouldPromiseEnd2 = false;
        const stubPromise2 = new Promise((resolve) => {
            function checkFlag() {
                if (!shouldPromiseEnd2) {
                    setTimeout(checkFlag, 10);
                } else {
                    resolve();
                }
            }
            checkFlag();
        });

        tracer.addEvent(eventToAdd2, stubPromise2);

        tracer.sendTraceSync();
        expect(this.postStub.calledOnce).to.be.true;
        shouldPromiseEnd1 = true;
        shouldPromiseEnd2 = true;
    });

    it('stripOperations: decreases trace size', () => {
        let smallertrace = tracer.stripOperations(bigtrace, 0);

        let big = JSON.stringify(bigtrace).length;
        let small = JSON.stringify(smallertrace).length;

        expect(big).to.be.greaterThan(small);
        expect(smallertrace).to.be.a('array');

        // second iteration
        smallertrace = tracer.stripOperations({ events: smallertrace }, 1);
        big = JSON.stringify(bigtrace).length;
        small = JSON.stringify(smallertrace).length;
        expect(big).to.be.greaterThan(small);

        // third iteration
        smallertrace = tracer.stripOperations({ events: smallertrace }, 2);
        big = JSON.stringify(bigtrace).length;
        small = JSON.stringify(smallertrace).length;
        expect(big).to.be.greaterThan(small);


        expect(small).to.be.lessThan(maxtrace);
    });
});
