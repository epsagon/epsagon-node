const { expect } = require('chai');
const semver = require('semver');
const app = require('./oauth2-server-mock/server');
const epsagon = require('../../../src/index');


const PORT = 8083;


describe('simple-oauth2 tests', () => {
    it('sanity', async () => {
        if (semver.lt(process.version, '12.0.0')) return
        const SimpleOAuth2 = require('simple-oauth2');
        epsagon.init();
        const server = app.app.listen(PORT);
        const oauth2Client = new SimpleOAuth2.AuthorizationCode({
            client: {
                id: 'dummy-client-id',
                secret: 'dummy-client-secret',
            },
            auth: {
                tokenHost: 'http://localhost:8083',
                tokenPath: '/oauth2/v4/token',
                authorizePath: '/o/oauth2/v2/auth',
            },
        });
        let accessToken;
        try {
            accessToken = await oauth2Client.getToken({
                scope: '<scope>',
                client_id: 'dummy-client-id',
                client_secret: 'dummy-client-secret',
                code: 'test',
            });
        } catch (err) {
            console.log(err); // eslint-disable-line no-console
        } finally {
            server.close();
            expect(accessToken.token.access_token).to.equal('test');
        }
    });
});
