const {createApplication} = require('../gambling');
(async () => {
    const app = await createApplication({secret:'browser-test-secret-with-thirty-two-characters',databasePath:':memory:',bcryptRounds:4,port:42170,intermissionMs:1200,turnMs:30000,disconnectMs:8000});
    await app.listen();
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.close());
})().catch(error=>{console.error(error);process.exitCode=1;});
