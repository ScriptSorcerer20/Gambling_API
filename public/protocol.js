(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Protocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const string = {type: 'string', minLength: 1, maxLength: 128};
    const lobbyId = {type: 'string', pattern: '^[a-f0-9]{16}$'};
    const requestId = {type: 'string', pattern: '^[a-zA-Z0-9_-]{8,128}$'};
    const schemas = {
        'lobby:create': {type: 'object', required: ['type', 'requestId'], properties: {type: {const: 'lobby:create'}, requestId, private: {type: 'boolean'}}, additionalProperties: false},
        'lobby:join': command('lobby:join'), 'lobby:leave': command('lobby:leave'), 'poker:start': command('poker:start'),
        'poker:join': {type: 'object', required: ['type', 'lobbyId'], properties: {type: {const: 'poker:join'}, lobbyId}, additionalProperties: false},
        'poker:action': {type: 'object', required: ['type', 'lobbyId', 'requestId', 'action'], properties: {
            type: {const: 'poker:action'}, lobbyId, requestId, action: {enum: ['hit', 'fold', 'bet']},
            payload: {type: 'object', properties: {amount: {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER}}, additionalProperties: false}
        }, additionalProperties: false},
        credentials: {type: 'object', required: ['username', 'password'], properties: {
            username: {type: 'string', minLength: 1, maxLength: 40, pattern: '^[^\\u0000-\\u001f\\u007f]+$'},
            password: {type: 'string', minLength: 1, maxLength: 72}
        }, additionalProperties: false}
    };
    function command(type) { return {type: 'object', required: ['type', 'lobbyId', 'requestId'], properties: {type: {const: type}, lobbyId, requestId}, additionalProperties: false}; }
    function matches(value, schema) {
        if (schema.const !== undefined && value !== schema.const) return false;
        if (schema.enum && !schema.enum.includes(value)) return false;
        if (schema.type === 'object') {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
            return Object.keys(value).every(key => Object.hasOwn(schema.properties, key) ? matches(value[key], schema.properties[key]) : schema.additionalProperties !== false);
        }
        if (schema.type === 'string') return typeof value === 'string' && (!schema.minLength || value.length >= schema.minLength) && (!schema.maxLength || value.length <= schema.maxLength) && (!schema.pattern || new RegExp(schema.pattern).test(value));
        if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
        if (schema.type === 'boolean') return typeof value === 'boolean';
        return true;
    }
    function validate(message) {
        if (!message || !Object.hasOwn(schemas, message.type) || message.type === 'credentials' || !matches(message, schemas[message.type])) return 'Invalid message shape or fields';
        if (message.type === 'poker:action' && message.action === 'bet' && !Object.hasOwn(message.payload || {}, 'amount')) return 'Bet amount is required';
        return null;
    }
    return {schemas, matches, validate, string};
});
