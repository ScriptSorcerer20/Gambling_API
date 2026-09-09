const path = require('node:path');
const {defineConfig} = require('@playwright/test');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(__dirname,'.playwright-browsers');
module.exports = defineConfig({
    testDir:'./e2e', timeout:45000, workers:1, retries:0,
    use:{baseURL:'http://127.0.0.1:42170',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
    webServer:{command:'node e2e/server.js',url:'http://127.0.0.1:42170/login',reuseExistingServer:false,timeout:15000}
});
