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
const port = 25565;

app.use(express.json());
app.use("/swagger-ui", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(cookieParser());

/*
    Here are Helper function  -----------------------------------------------------------------------------------------------
 */

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

/*
    Here is the the Login logic -----------------------------------------------------------------------------------------------
 */

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
    response.sendFile(path.join(__dirname, "./public/login.html"));
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
        return response.status(401).json({error: "Invalid password"});
    }
    const token = generateAccessToken({username});
    user.token = token;
    save_data(users);
    response.json({username, token});
});

app.get("/", (req, res) => {
    const token =
        req.headers.authorization?.split(" ")[1] ||
        req.cookies.authorization;
    if (!token) {
        return res.sendFile(path.join(__dirname, "./public/unauthorized.html"));
    }
    jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
        if (err) {
            return res.sendFile(path.join(__dirname, "./public/unauthorized.html"));
        }
        const users = get_data();
        const foundUser = users.find(u => u.username === user.username);
        if (!foundUser || foundUser.token !== token) {
            return res.sendFile(path.join(__dirname, "./public/unauthorized.html"));
        }
        req.user = user;
        res.sendFile(path.join(__dirname, "./public/home.html"));
    });
});

app.get("/balance", authenticateToken, (request, response) => {
    /* #swagger.security = [{
            "bearerAuth": []
    }] */
    const username = request.user.username;
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
    const username = request.user.username;
    const users = get_data();
    const user = users.find(u => u.username === username);
    if (!user) return response.status(404).json({ error: "User not found" });
    const lobbyId = user.lobbyId;
    if (lobbyId && playerMap[lobbyId]) {
        playerMap[lobbyId] = playerMap[lobbyId].filter(player => player !== username);
        if (playerMap[lobbyId].length === 0) {
            delete playerMap[lobbyId];
        }
        delete user.lobbyId;
    }
    delete user.token;
    save_data(users);
    response.clearCookie("authorization", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict"
    });
    response.json({ message: "Logged out successfully." });
});



/*
    Here will be the Game logic -----------------------------------------------------------------------------------------------
 */


const playerMap = {};

async function createLobby() {
    let response = await fetch("https://www.deckofcardsapi.com/api/deck/new/shuffle/?deck_count=1")
    let data = await response.json();
    let lobbyId = data.deck_id
    await fetch(`https://www.deckofcardsapi.com/api/deck/${lobbyId}/pile/players/add/?cards=`)
    return lobbyId;
}

async function joinLobby(lobbyId, player_name) {
    let response = await fetch(`https://www.deckofcardsapi.com/api/deck/${lobbyId}/pile/${player_name}/add/?cards=`)

}

app.get("/lobby/create", authenticateToken, async (req, res) => {
    const username = req.query.username;
    if (!username) {
        return res.status(400).send("Username is required");
    }
    let lobbyId = await createLobby();
    if (!playerMap[lobbyId]) {
        playerMap[lobbyId] = [];
    }
    if (!playerMap[lobbyId].includes(username)) {
        playerMap[lobbyId].push(username);
    }
    const users = get_data();
    const user = users.find(u => u.username === username);
    if (user) {
        user.lobbyId = lobbyId;
        save_data(users);
    }
    res.redirect(`/lobby/join?lobbyId=${lobbyId}&username=${username}`);
})

app.get("/lobby/join", authenticateToken, async (req, res) => {
    let lobbyId = req.query.lobbyId;
    let username = req.query.username;

    const users = get_data();
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ error: "User doesn't exist" });
    }

    if (lobbyId in playerMap) {
        await joinLobby(lobbyId, user.username);
        if (!playerMap[lobbyId].includes(username)) {
            playerMap[lobbyId].push(username);
        }
        user.lobbyId = lobbyId;
        save_data(users);
        res.json({ lobbyId, username });
    } else {
        console.log("Lobby with " + lobbyId + " not found.");
        return res.status(404).json({ error: "Lobby not found" });
    }
});

app.delete("/lobby/leave", authenticateToken, async (req, res) => {
    const lobbyId = req.query.lobbyId;
    const username = req.query.username;

    if (!lobbyId || !username) {
        return res.status(400).json({ error: "Missing lobbyId or username" });
    }

    if (lobbyId in playerMap) {
        const index = playerMap[lobbyId].indexOf(username);
        if (index > -1) {
            playerMap[lobbyId].splice(index, 1);
            return res.json({ message: "Successfully left lobby" });
        } else {
            return res.status(404).json({ error: "User not in lobby" });
        }
    }

    res.status(404).json({ error: "Lobby not found" });
});


app.get("/lobby/players", authenticateToken, async (req, res) => {
    let lobbyId = req.query.lobbyId;
    let players = playerMap[lobbyId] || [];
    res.json({players});
});


app.listen(port, () => {
    console.log("Server is running on port " + port);
});
