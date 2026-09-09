const http = require('node:http');
const {configuration} = require('./lib/config');
const {createRepository} = require('./lib/repository');
const {createSessionService} = require('./lib/sessions');
const {createLobbyService} = require('./lib/lobbies');
const {createHttpApp} = require('./lib/http');
const {connectTransport} = require('./lib/transport');

async function createApplication(options = {}) {
    const config = configuration(options);
    const repository = options.repository || await createRepository(config.databasePath, options.repositoryHooks);
    try { await repository.recover(); } catch (error) { await repository.close(); throw error; }
    const sessions = createSessionService(repository, config);
    const lobbies = createLobbyService(repository, config);
    lobbies.events.on('failure', error => console.error('Table command failed; will retry:', error.message));
    const app = createHttpApp(repository, sessions, lobbies, config);
    const server = http.createServer(app);
    const transport = connectTransport(server, sessions, lobbies, config);
    let closed = false;
    return {app, server, repository, sessions, lobbies, config,
        async listen(port = config.port, host = config.host) {
            await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => {server.off('error', reject); resolve();}); });
            return server.address();
        },
        async close() {
            if (closed) return; closed = true;
            const drained = server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
            await transport.close(); await drained;
            await sessions.close(); await lobbies.close(); await repository.close();
        }
    };
}
if (require.main === module) {
    require('dotenv').config();
    createApplication().then(async application => {
        const address = await application.listen();
        console.log(`Server listening at http://${address.address}:${address.port}`);
        for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => application.close().catch(error => {console.error(error); process.exitCode = 1;}));
    }).catch(error => {console.error(error.message); process.exitCode = 1;});
}
module.exports = {createApplication};
