const {test,expect} = require('@playwright/test');
const {fork} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createRepository} = require('../lib/repository');
test('a killed process leaves durable escrow that the next owner refunds once',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gambling-crash-'));
    const filename=path.join(directory,'test.sqlite');
    const child=fork(path.join(__dirname,'crash-fixture.js'),[filename],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
    try {
        const [message]=await once(child,'message');
        expect(message.totals).toEqual({users:350,escrow:50});
        const exited=once(child,'exit'); child.kill('SIGKILL'); await exited;
        const repository=await createRepository(filename);
        try {await repository.recover();await repository.recover();expect(await repository.totals()).toEqual({users:400,escrow:0});}
        finally {await repository.close();}
    } finally {
        if(child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
        const relative=path.relative(os.tmpdir(),directory);
        if(relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(directory).startsWith('gambling-crash-')) throw new Error('Unsafe cleanup path');
        await fs.rm(directory,{recursive:true,force:true});
    }
});
