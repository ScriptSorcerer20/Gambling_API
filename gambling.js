const express = require("express");
const app = express();
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger.json");
const path = require("path");
app.use(express.static(path.join(__dirname, "public")));
const fs = require("fs");
const dotenv = require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const port = 3000;

app.use(express.json());
app.use("/swagger-ui", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(cookieParser());

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
    return jwt.sign(user, process.env.TOKEN_SECRET, {expiresIn: "1800s"});
}

function authenticateToken(request, response, next) {
    /* #swagger.security = [{
        "bearerAuth": []
}] */
    const token =
        request.headers.authorization?.split(" ")[1] ||
        request.cookies.authorization;

    if (token == null) return response.sendStatus(401);

    jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
        if (err) return response.sendStatus(403);

        const users = get_data();
        const foundUser = users.find(u => u.username === user.username);
        if (!foundUser || foundUser.token !== token) {
            return response.status(403).json({error: "Token has been revoked or is invalid"});
        }

        request.user = user;
        next();
    });
}

app.post("/register", (request, response) => {
    let {username, password} = request.body;
    let lower_username = username.toLowerCase();

    if (!username || !password)
        return response.status(400).json({error: "Username and password are required"});

    const users = get_data();
    if (users.some(u => u.username === username)) {
        return response.status(400).json({error: "Username already exists"});
    }

    const token = generateAccessToken({username});
    saveUser({username, password, token, "money": 200});

    response.json({lower_username, token});
});

app.get("/login", (request, response) => {
    response.sendFile(path.join(__dirname, ".\\public\\login.html"));
})
app.post("/login", (request, response) => {
    let {username, password} = request.body;
    username = username.toLowerCase();
    if (!username || !password)
        return response.status(400).json({error: "Username and password are required"});

    const users = get_data();
    const user = users.find(u => u.username === username);
    if (!user) return response.status(401).json({error: "Invalid credentials"});

    if (user.password !== password) {
        response.status(401).json({error: "Invalid password"});
    }

    const token = generateAccessToken({username});
    user.token = token;
    save_data(users);

    response.json({username, token});
});

app.get("/", authenticateToken, (request, response) => {
    /* #swagger.security = [{
            "bearerAuth": []
    }] */
    response.sendFile(path.join(__dirname, ".\\public\\home.html"));
});

app.get("/balance", authenticateToken, (request, response) => {
    /* #swagger.security = [{
            "bearerAuth": []
    }] */
    const username = request.user.username;
    console.log(username);
    const allUsers = get_data();
    const me = allUsers.find(u => u.username === username);

    if (!me) {
        return response.status(404).json({error: "User not found"});
    }

    response.json({balance: me.money}).status(200);
});

app.post("/verify", authenticateToken, (request, response) => {
    response.json({valid: true, user: request.user});
});

app.delete("/logout", authenticateToken, (request, response) => {
    /* #swagger.security = [{
            "bearerAuth": []
    }] */
    const username = request.user.username;
    const users = get_data();
    const user = users.find(u => u.username === username);

    // 1) Clear the HttpOnly cookie in the browser
    response.clearCookie("authorization", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict"
    });

    // 2) Delete the token from your JSON store
    if (user) {
        delete user.token;
        save_data(users);
    }

    // 3) Send final response
    response.json({message: "Logged out successfully."});
});

app.listen(port, () => {
    console.log("Server is running on port " + port);
});
