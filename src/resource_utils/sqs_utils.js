/**
 * @fileoverview SQS utility functions
 */

/**
 * If exists, gets the SNS message that triggered the SQS,
 * and generates event data out of it.
 * @param {object} messages The SQS messages object
 * @returns {object} SNS event data json
 */
function getSNSTrigger(messages) {
    let foundSnsEvent = null;
    messages.some((message) => {
        try {
            let body = null;
            if ('Body' in message) {
                body = JSON.parse(message.Body);
            } else if ('body' in message) {
                body = JSON.parse(message.body);
            } else {
                return true;
            }

            if ('Type' in body &&
                'MessageId' in body &&
                'TopicArn' in body &&
                'Message' in body &&
                'Timestamp' in body &&
                'SignatureVersion' in body &&
                'Signature' in body) {
                foundSnsEvent = body;
                return true;
            }
        } catch (ex) {
            // Continue to the next message
        }

        return true;
    });

    return foundSnsEvent;
}

module.exports.getSNSTrigger = getSNSTrigger;
