const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const directories = ['lib','public','scripts','test','e2e'];
const files = ['gambling.js','swagger.js','playwright.config.js', ...directories.flatMap(directory => fs.readdirSync(directory).filter(file=>file.endsWith('.js')).map(file=>path.join(directory,file)))];
for (const filename of files) new vm.Script(fs.readFileSync(filename,'utf8'),{filename});
console.log(`Syntax checked ${files.length} JavaScript files`);
