const fs = require('node:fs');
const {schemas} = require('./public/protocol');
const object = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const string = {type: 'string'};
const integer = {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const nullableString = {type: ['string', 'null']};
const numberMap = {type: 'object', additionalProperties: integer};
const array = items => ({type: 'array', items});
const user = object({username: string, money: integer});
const error = object({code: string, error: string});
const security = [{bearerAuth: []}, {cookieAuth: []}];
const response = schema => ({description: 'Success', content: {'application/json': {schema}}});
const responses = schema => ({200: response(schema), ...Object.fromEntries([400,401,403,404,409,429,500].map(status => [status, {description: `Error ${status}`, content: {'application/json': {schema: error}}}]))});
const paths = {};
function route(path, method, summary, output, body, auth = true) {
    const entry = {summary, responses: responses(output), ...(auth ? {security} : {}), ...(body ? {requestBody: {required: true, content: {'application/json': {schema: body}}}} : {})};
    paths[path] ||= {}; paths[path][method] = entry; return entry;
}
const session = object({username: string, token: string});
route('/register','post','Create a 200-chip account and session',session,schemas.credentials,false);
route('/login','post','Replace the current session',session,schemas.credentials,false);
route('/verify','post','Verify a cookie or bearer session',object({valid:{const:true},user:object({username:string,exp:integer})}));
route('/logout','delete','Fold/leave the lobby, revoke the session, and clear the cookie',object({message:string}));
route('/balance','get','Current spendable chips (excludes escrow)',object({balance:integer}));
route('/leaderboard','get','Rank spendable balances; username breaks ties',object({leaderboard:array(user),self:object({username:string,money:integer,position:integer})}));
const ack = object({lobbyId:string,username:string,type:string,requestId:string});
for (const [path,type] of [['/lobby/create','lobby:create'],['/lobby/join','lobby:join'],['/lobby/leave','lobby:leave'],['/poker/start','poker:start'],['/poker/action','poker:action']]) {
    const body = structuredClone(schemas[type]); delete body.properties.type; body.required = body.required.filter(key => key !== 'type');
    route(path,'post',`${type}; retry the identical body/requestId after a lost response`,ack,body);
    paths[path].get = {summary:'Deprecated mutation method',responses:{405:{description:'Use POST',content:{'application/json':{schema:error}}}}};
}
route('/lobby/public','get','List public lobbies',object({lobbies:array(object({lobbyId:string,host:nullableString,players:integer,gameStarted:{type:'boolean'}}))}));
route('/lobby/players','get','List members of your lobby',object({players:array(string)})).parameters=[{in:'query',name:'lobbyId',required:true,schema:schemas['lobby:join'].properties.lobbyId}];
const doc = {openapi:'3.1.0',info:{title:'Gambling API',version:'2.0.0',description:'Virtual chips. Account balances exclude active-hand escrow. See docs/PROTOCOL.md and docs/RULES.md.'},servers:[{url:'/'}],paths,
    components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'},cookieAuth:{type:'apiKey',in:'cookie',name:'authorization'}}}};
const card = object({rank:{enum:['A','K','Q','J','10','9','8','7','6','5','4','3','2']},suit:{enum:['S','H','D','C']}});
const result = object({rank:integer,name:string,score:array(integer),comboCards:array(card)});
const outputSchemas = {
    'auth:success':object({type:{const:'auth:success'},username:string}),
    'command:ack':object({type:{const:'command:ack'},commandType:string,lobbyId:string,username:string,requestId:string}),
    error:object({type:{const:'error'},code:string,message:string,requestId:string},['type','code','message']),
    'lobby:left':object({type:{const:'lobby:left'},lobbyId:string}),
    'lobby:state':object({type:{const:'lobby:state'},lobbyId:string,host:nullableString,players:array(string),isPublic:{type:'boolean'},canStart:{type:'boolean'},gameStarted:{type:'boolean'},gameUrl:string}),
    'poker:state':object({type:{const:'poker:state'},lobbyId:string,username:string,players:array(string),round:integer,pot:integer,currentBet:integer,bet:integer,
        communityCards:array(card),hand:array(card),currentPlayer:nullableString,isYourTurn:{type:'boolean'},queue:array(string),folded:{type:'object',additionalProperties:{type:'boolean'}},
        street:{enum:['intermission','preflop','flop','turn','river']},phase:{enum:['intermission','waiting','betting']},lastAction:string,yourContribution:integer,yourStack:integer,
        isSpectator:{type:'boolean'},callAmount:integer,minimumStake:integer,minimumRaise:integer,canRaise:{type:'boolean'},
        nextRoundStartsAt:{type:['integer','null']},turnEndsAt:{type:['integer','null']},winner:nullableString,
        showdown:{anyOf:[{type:'null'},array(object({player:string,hand:array(card),result}))]},payouts:numberMap})
};
const websocket = {$schema:'https://json-schema.org/draft/2020-12/schema',title:'WebSocket protocol',oneOf:Object.entries(schemas).filter(([key])=>key!=='credentials').map(([,value])=>value),$defs:outputSchemas};
const artifacts = [['swagger.json',doc],['docs/websocket.schema.json',websocket]];
for (const [filename, data] of artifacts) {
    const text = JSON.stringify(data,null,2)+'\n';
    if (process.argv.includes('--check')) {if (fs.readFileSync(filename,'utf8') !== text) throw new Error(`${filename} is stale; run npm run docs`);}
    else fs.writeFileSync(filename,text);
}
