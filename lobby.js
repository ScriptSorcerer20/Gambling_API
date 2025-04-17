const express = require("express");
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
    res.send(lobbyId);
})

app.get("/lobby/join", async (req, res) => {
    let lobbyId = req.query.lobbyId;
    let name = req.query.name;

    await joinLobby(lobbyId, name);

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

app.listen(port, () => {
    console.log("Server is running on port " + port);
});
