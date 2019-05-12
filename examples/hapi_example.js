const Hapi = require('hapi');
const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

const init = async () => {

    const server = Hapi.server({
        port: 3000,
        host: 'localhost'
    });

    server.route({
        method: 'GET',
        path:'/',
        handler: (request, h) => {
            return 'Hello World!';
        }
    });

    server.route({
        method: 'GET',
        path:'/label_example',
        handler: (request, h) => {
            request.epsagon.label('myFirstLabel', 'customValue1');
            return 'Hello World!';
        }
    });

    await server.start();
    console.log('Server running on %ss', server.info.uri);
};

init();