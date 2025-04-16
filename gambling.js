const express = require("express");
const app = express();
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger.json");

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv").config();
const jwt = require("jsonwebtoken");
const port = 3000;

app.use(express.json());
app.use("/swagger-ui", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function get_data() {
    const dataPath = path.join(__dirname, "data.json");
    if (!fs.existsSync(dataPath)) {
        fs.writeFileSync(dataPath, JSON.stringify([]));
    }
    const data = fs.readFileSync(dataPath);
    return JSON.parse(data);
}

function save_data(data) {
    fs.writeFileSync(path.join(__dirname, "data.json"), JSON.stringify(data, null, 2));
}

function saveUser(user) {
    const users = get_data();
    users.push(user);
    save_data(users);
}

function generateAccessToken(user) {
    return jwt.sign(user, process.env.TOKEN_SECRET, { expiresIn: "1800s" });
}

function authenticateToken(request, response, next) {
    const authHeader = request.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (token == null) return response.sendStatus(401);

    jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
        if (err) return response.sendStatus(403);

        const users = get_data();
        const foundUser = users.find(u => u.username === user.username);
        if (!foundUser || foundUser.token !== token) {
            return response.status(403).json({ error: "Token has been revoked or is invalid" });
        }

        request.user = user;
        next();
    });
}

app.post("/register", (request, response) => {
    const { username } = request.body;
    if (!username)
        return response.status(400).json({ error: "Username is required" });

    const users = get_data();
    if (users.some(u => u.username === username)) {
        return response.status(400).json({ error: "Username already exists" });
    }

    const token = generateAccessToken({ username });
    saveUser({ username, token });

    response.json({ username, token });
});

app.post("/login", (request, response) => {
    const { username } = request.body;
    if (!username)
        return response.status(400).json({ error: "Username is required" });

    const users = get_data();
    const user = users.find(u => u.username === username);
    if (!user) return response.status(401).json({ error: "Invalid credentials" });


    const token = generateAccessToken({ username });
    user.token = token;
    save_data(users);

    response.json({ username, token });
});

app.get("/", authenticateToken, (request, response) => {
    response.sendFile(path.join(__dirname, "structure.png"));
});

app.post("/verify", authenticateToken, (request, response) => {
    response.json({ valid: true, user: request.user });
});

app.delete("/logout", authenticateToken, (request, response) => {
    const username = request.user.username;
    const users = get_data();
    const user = users.find(u => u.username === username);
    if (user) {
        delete user.token;
        save_data(users);
    }
    response.json({ message: "Logged out successfully." });
});

app.listen(port, () => {
    console.log("Server is running on port " + port);
});
