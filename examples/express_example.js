const express = require('express');
const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

const app = express()

app.get('/', (req, res) => res.send('Hello World!'))

app.listen(3000)