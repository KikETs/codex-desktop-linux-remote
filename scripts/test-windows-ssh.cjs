'use strict';
// Explicit live test: creates an isolated folder and one archived test conversation.
const {Client}=require('../test/ssh-rpc-client.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const host=process.argv[2];
if(!host)throw new Error('Usage: node scripts/test-windows-ssh.cjs SSH_DESTINATION [CODEX_EXE]');
const settings=process.argv[3]?{codexPath:process.argv[3]}:{};
let client, folder, thread;
const results=[];
async function measured(name, fn){const t=performance.now();const r=await fn();results.push({name,ms:Math.round(performance.now()-t),passed:true});console.log(name,'PASS');return r}
(async()=>{
  client=new Client({sshHost:host},settings);
  const init=await measured('Windows SSH initialization',()=>client.initialize());
  assert.equal(init.platformFamily,'windows');
  const home=path.win32.dirname(init.codexHome);
  folder=path.win32.join(home,'AppData','Local','Temp','codex-ssh-test-'+crypto.randomUUID());
  await measured('Create isolated test folder',()=>client.request('fs/createDirectory',{path:folder,recursive:true}));
  const file=path.win32.join(folder,"\uD55C\uAE00 space ' $ test.txt");
  const content='Windows SSH Unicode round trip: \uD55C\uAE00\n';
  await measured('Write Unicode filename',()=>client.request('fs/writeFile',{path:file,dataBase64:Buffer.from(content).toString('base64')}));
  const read=await measured('Read Unicode file',()=>client.request('fs/readFile',{path:file}));
  assert.equal(Buffer.from(read.dataBase64,'base64').toString(),content);
  const listing=await measured('List remote folder',()=>client.request('fs/readDirectory',{path:folder}));
  assert(JSON.stringify(listing).includes("\uD55C\uAE00 space ' $ test.txt"));
  const cmd=await measured('Run command in test folder',()=>client.request('command/exec',{command:['cmd.exe','/d','/c','echo WINDOWS_SSH_COMMAND_OK'],cwd:folder,timeoutMs:10000}));
  assert.equal(cmd.exitCode,0);
  assert(cmd.stdout.includes('WINDOWS_SSH_COMMAND_OK'));
  await measured('Model list',()=>client.request('model/list',{limit:1}));
  const start=await measured('Create test conversation',()=>client.request('thread/start',{cwd:folder,approvalPolicy:'on-request',sandbox:'read-only',ephemeral:false}));
  thread=start.thread.id;
  await client.request('thread/name/set',{threadId:thread,name:'Windows SSH integration test (temporary)'});
  const events=[];
  client.on('notification',m=>events.push(m));
  client.on('approval',m=>{client.send({id:m.id,error:{code:-32000,message:'Unexpected approval in no-tools integration test'}})});
  const turn=await measured('Submit minimal test turn',()=>client.request('turn/start',{threadId:thread,input:[{type:'text',text:'Reply exactly WINDOWS_SSH_TEST_OK. Do not call tools.',text_elements:[]}]}));
  const waitStart=performance.now();
  while(!events.some(m=>m.method==='turn/completed'&&m.params?.turn?.id===turn.turn.id)){
    if(performance.now()-waitStart>120000)throw new Error('Timed out waiting for test turn');
    await new Promise(r=>setTimeout(r,250));
  }
  assert(events.some(m=>m.method==='item/agentMessage/delta'||m.method==='item/completed'));
  results.push({name:'Streamed test response completed',passed:true,ms:Math.round(performance.now()-waitStart)});
  console.log('Streamed test response completed PASS');
  await client.close();
  client=new Client({sshHost:host},settings);await client.initialize();
  await measured('Resume conversation after reconnect',()=>client.request('thread/resume',{threadId:thread,cwd:folder}));
  const reread=await measured('Read file after reconnect',()=>client.request('fs/readFile',{path:file}));
  assert.equal(Buffer.from(reread.dataBase64,'base64').toString(),content);
})().catch(e=>{console.error(e.message);if(client?.stderr)console.error(client.stderr.slice(-1000));results.push({name:'Live integration',passed:false,error:e.message});process.exitCode=1}).finally(async()=>{
  if(client&&!client.closed){
    if(thread)try{await client.request('thread/archive',{threadId:thread})}catch(e){console.error('Archive cleanup:',e.message)}
    if(folder)try{await client.request('fs/remove',{path:folder,recursive:true,force:true})}catch(e){console.error('Folder cleanup:',e.message)}
    await client.close();
  }
  const output=path.join(__dirname,'../build/windows-ssh-live-results.json');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
});
