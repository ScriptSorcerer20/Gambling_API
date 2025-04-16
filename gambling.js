const express = require("express");
const app = express();
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const path = require("path");
const port = 3000;

app.use('/swagger-ui', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get("/", (request, respond) => {
    respond.sendFile(path.join(__dirname, 'structure.png'));
});

app.listen(port, () => {
    console.log("Server is running on port " + port);
})