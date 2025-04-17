const express = require("express");
const path = require("path");
const fs = require("fs");
const app = express();
const port = 3000;

const playerMap = {};

async function createLobby() {
    let response = await fetch("https://www.deckofcardsapi.com/api/deck/new/shuffle/?deck_count=1")
    let data = await response.json();
    let lobbyId = data.deck_id
    await fetch(`https://www.deckofcardsapi.com/api/deck/${lobbyId}/pile/players/add/?cards=`)
    console.log(lobbyId);
    return lobbyId;
}

async function joinLobby(lobbyId, player_name) {
    let response = await fetch(`https://www.deckofcardsapi.com/api/deck/${lobbyId}/pile/${player_name}/add/?cards=`)
    console.log(response);
}

app.get("/lobby/create", async (req, res) => {
    let lobbyId = await createLobby();
    res.send(lobbyId).redirect("/lobby/join");
})

app.get("/lobby/join", async (req, res) => {
    let lobbyId = req.query.lobbyId;
    let name = req.body.username;

    const users = get_data();
    const user = (users.find(u => u.username === name))
    if (!user) {
        res.sendStatus(401).json({ error: "User doesnt exist are required" });
    }

    await joinLobby(lobbyId, user.username);

    if (!playerMap[lobbyId]) {
        playerMap[lobbyId] = [];
    }

    playerMap[lobbyId].push(name);

    res.send(lobbyId + "" + name);
});

app.get("/lobby/players", async (req, res) => {
    let lobbyId = req.query.lobbyId;
    let players = playerMap[lobbyId] || [];
    res.json({ players });
});

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

app.listen(port, () => {
    console.log("Server is running on port " + port);
});
