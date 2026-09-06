'use strict';
// Explicit live test: all Git changes stay inside a newly created temporary folder.
const {Client}=require('../test/ssh-rpc-client.cjs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const host=process.argv[2];if(!host)throw new Error('Pass SSH destination');
let client,folder;
const results=[];
(async()=>{
  client=new Client({sshHost:host},{});const init=await client.initialize();
  folder=path.win32.join(path.win32.dirname(init.codexHome),'AppData','Local','Temp','codex-ssh-git-'+crypto.randomUUID());
  await client.request('fs/createDirectory',{path:folder,recursive:true});
  async function git(args){const r=await client.request('command/exec',{command:['git',...args],cwd:folder,timeoutMs:10000});assert.equal(r.exitCode,0,r.stderr);return r.stdout}
  await git(['init']);
  const file=path.win32.join(folder,'sample.txt');
  await client.request('fs/writeFile',{path:file,dataBase64:Buffer.from('before\n').toString('base64')});
  await git(['add','sample.txt']);
  await client.request('fs/writeFile',{path:file,dataBase64:Buffer.from('after\n').toString('base64')});
  const diff=await git(['diff','--','sample.txt']);
  assert(diff.includes('-before')&&diff.includes('+after'));
  const root=(await git(['rev-parse','--show-toplevel'])).trim();
  assert.equal(root.replaceAll('\\','/').toLowerCase(),folder.replaceAll('\\','/').toLowerCase());
  results.push({name:'Windows repository cwd and Git diff through app-server',passed:true});
  console.log('Windows repository cwd and Git diff PASS');
})().catch(e=>{results.push({name:'Project protocol',passed:false,error:e.message});console.error(e.message);process.exitCode=1}).finally(async()=>{
  if(client&&!client.closed){if(folder)await client.request('fs/remove',{path:folder,recursive:true,force:true}).catch(()=>{});await client.close()}
  const output=path.join(__dirname,'../build/windows-ssh-project-results.json');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
});
