const crypto = require('node:crypto');
const {createRepository} = require('../lib/repository');
const {createLobbyService} = require('../lib/lobbies');
(async () => {
    const repo = await createRepository(process.argv[2]);
    for (const username of ['a','b']) await repo.register(username,'unused-test-hash',null);
    let now=1;
    const lobbies=createLobbyService(repo,{ante:10,now:()=>now,intermissionMs:60000,turnMs:30000});
    const command=(username,type,fields={})=>lobbies.command(username,{type,requestId:crypto.randomUUID(),...fields});
    const {lobbyId}=await command('a','lobby:create');
    await command('b','lobby:join',{lobbyId}); await command('a','poker:start',{lobbyId});
    const game=lobbies.get(lobbyId).game; now=game.nextRoundStartsAt;
    await command(null,'timer',{lobbyId,handId:game.id,phase:'intermission',deadline:now});
    await command('b','poker:action',{lobbyId,action:'bet',payload:{amount:30}});
    process.send({ready:true,totals:await repo.totals()});
})().catch(error=>{console.error(error);process.exit(1);});
