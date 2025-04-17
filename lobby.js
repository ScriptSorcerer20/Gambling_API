const express = require("express");
const app = express();
const port = 3000;

async function createLobby() {
    let response = await fetch("https://www.deckofcardsapi.com/api/deck/new/shuffle/?deck_count=1")
    let data = await response.json();
    let lobbyId = data.deck_id
    console.log(lobbyId);
    return lobbyId;
}

app.get("/lobby/create", async (req, res) => {
    let lobbyId = await createLobby();
    res.send("Lobby ID: " + lobbyId);
})

app.listen(port, () => {
    console.log("Server is running on port " + port);
});
