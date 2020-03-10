const { expect } = require('chai');
const { getMessageData, handlePublishMethod, getMessagesFromResponse } = require('../../../src/events/google_cloud');

describe('Google cloud events tests', () => {
    it('Getting message data from array should return a js object on a valid request', () => {
        // Arrange
        const expectedOutput = { a: 'test' };
        const mockReqOptsMessages = [{ data: JSON.stringify(expectedOutput) }];
        // Act
        const messageDataResponse = getMessageData(mockReqOptsMessages, 0);
        // Assert
        expect(messageDataResponse).to.deep.equal(expectedOutput);
    });

    it('Getting message data from array should return null when req param is not an array', () => {
        [undefined, [], [{}], null, [{ data: 'test' }]].forEach((input) => {
            // Arrange
            const expectedOutput = null;
            const mockReqOptsMessages = input;
            // Act
            const messageDataResponse = getMessageData(mockReqOptsMessages, 0);
            // Assert
            expect(messageDataResponse).to.equal(expectedOutput);
        });
    });

    it('Handle publish method should return array of messasges and array of ids on valid input', () => {
        // Arrange
        const mockMessages = { messageIds: ['1027170925339701'] };
        const mockConfig = {
            reqOpts: {
                messages: [{
                    attributes: {},
                    data: Buffer.from(
                        // eslint-disable-next-line max-len
                        [123, 34, 109, 101, 115, 115, 97, 103, 101, 34, 58, 34, 116, 101, 115, 116, 34, 125]
                    ),
                }],
            },
        };
        const expectedOutput = { messages: [{ id: '1027170925339701', message: 'test' }], messageIdsArray: ['1027170925339701'] };
        // Act
        const messageDataResponse = handlePublishMethod(mockMessages, mockConfig);
        // Assert
        expect(messageDataResponse).to.deep.equal(expectedOutput);
    });
    it('Handle publish method should return empty object when messages is not array', () => {
        [undefined, null, {}].forEach(
            (input) => {
                // Arrange
                const expectedOutput = {};
                const mockMessages = input;
                // Act
                const messageDataResponse = handlePublishMethod(mockMessages, 'not-relveant-for-test');
                // Assert
                expect(messageDataResponse).to.deep.equal(expectedOutput);
            }
        );
    });
    it('Getting messages from pull response should return array of messages and array of ids when messages arg is valid', () => {
        // Arrange
        const mockRes = {
            receivedMessages: [{
                ackId: 'ackId',
                message: {
                    data: Buffer.from(
                    // eslint-disable-next-line max-len
                        [123, 34, 109, 101, 115, 115, 97, 103, 101, 34, 58, 34, 116, 101, 115, 116, 34, 125]
                    ),
                    messageId: '1027170925339701',
                },
            },
            {
                ackId: 'ackId',
                message: {
                    data: null,
                    messageId: '1027170925339702',
                },
            }],
        };


        const expectedOutput = {
            messages: [{ message: 'test', messageId: '1027170925339701' }, { messageId: '1027170925339702' }],
            messageIdsArray: ['1027170925339701', '1027170925339702'],
        };
        // Act
        const messageDataResponse = getMessagesFromResponse(mockRes);
        // Assert
        expect(messageDataResponse).to.deep.equal(expectedOutput);
    });
    it('Getting messages from pull response should return empty object when res is not valid', () => {
        [undefined, [], [{}], null, { receivedMessages: null }].forEach(
            (input) => {
                // Arrange
                const expectedOutput = {};
                const mockReqOptsMessages = input;
                // Act
                const messageDataResponse = getMessagesFromResponse(mockReqOptsMessages);
                // Assert
                expect(messageDataResponse).to.deep.equal(expectedOutput);
            }
        );
    });
});
