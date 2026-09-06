'use strict';
const {Client}=require('../test/ssh-rpc-client.cjs');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const host=process.argv[2];if(!host)throw new Error('Pass SSH destination');
let client,folder,thread;
const results=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=90000){const t=Date.now();while(!fn()){if(Date.now()-t>ms)throw new Error('Timed out waiting for control event');await wait(100)}}
(async()=>{
 client=new Client({sshHost:host},{});const init=await client.initialize();
 folder=path.win32.join(path.win32.dirname(init.codexHome),'AppData','Local','Temp','codex-ssh-control-'+crypto.randomUUID());
 await client.request('fs/createDirectory',{path:folder,recursive:true});
 const start=await client.request('thread/start',{cwd:folder,approvalPolicy:'on-request',sandbox:'read-only'});thread=start.thread.id;
 await client.request('thread/name/set',{threadId:thread,name:'Windows SSH approval and interruption test'});
 const events=[];let approvalCount=0;
 client.on('notification',m=>events.push(m));
 client.on('approval',m=>{
   const command=m.params?.command;
   // Only the exact harmless echo probe is accepted; other requests are declined.
   const joined=Array.isArray(command)?command.join(' '):command;
   console.log('Test approval command:',JSON.stringify(command));
   const allowed=m.method==='item/commandExecution/requestApproval' && typeof joined==='string' && /^(?:(?:"?[^";|&\r\n]*\\(?:powershell|pwsh)\.exe"?|powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+(?:(?:-NoLogo|-NoProfile|-NonInteractive)\s+)*-Command\s+)?["']?cmd(?:\.exe)? \/d \/c echo WINDOWS_SSH_APPROVAL_OK["']?$/i.test(joined.trim());
   if(allowed){approvalCount++;client.send({id:m.id,result:{decision:'accept'}})}
   else {console.log('Unaccepted approval method:',m.method);client.send({id:m.id,result:{decision:'decline'}})}
 });
 const turn=await client.request('turn/start',{threadId:thread,input:[{type:'text',text:'This is a transport approval test. Run exactly cmd.exe /d /c echo WINDOWS_SSH_APPROVAL_OK using exec_command with sandbox_permissions=require_escalated and justification=Validate Windows SSH approval routing. Do not run any other commands. Then reply DONE.',text_elements:[]}]});
 await until(()=>events.some(m=>m.method==='turn/completed'&&m.params?.turn?.id===turn.turn.id));
 results.push({name:'Real approval request and response',passed:approvalCount>0,approvalCount});
 console.log('Approval requests accepted:',approvalCount);
 events.length=0;
 const second=await client.request('turn/start',{threadId:thread,input:[{type:'text',text:'Write a long numbered list of 500 distinct general programming tips. Do not use tools.',text_elements:[]}]});
 await client.request('turn/interrupt',{threadId:thread,turnId:second.turn.id});
 await until(()=>events.some(m=>m.method==='turn/completed'&&m.params?.turn?.id===second.turn.id));
 const completed=events.find(m=>m.method==='turn/completed'&&m.params?.turn?.id===second.turn.id);
 assert.equal(completed.params.turn.status,'interrupted');
 results.push({name:'Interrupt active turn',passed:true});console.log('Interrupt active turn PASS');
 // Abrupt transport loss must not replay the preceding mutating requests.
 const pending=client.request('model/list',{limit:1});client.child.kill('SIGTERM');
 await pending.catch(()=>{});await until(()=>client.closed,10000);
 client=new Client({sshHost:host},{});await client.initialize();
 await client.request('thread/resume',{threadId:thread,cwd:folder});
 results.push({name:'Resume after abrupt SSH disconnect',passed:true});console.log('Resume after abrupt SSH disconnect PASS');
})().catch(e=>{results.push({name:'Control integration',passed:false,error:e.message});console.error(e.message);process.exitCode=1}).finally(async()=>{
 if(client&&!client.closed){
  if(thread)try{await client.request('thread/archive',{threadId:thread})}catch{}
  if(folder)try{await client.request('fs/remove',{path:folder,recursive:true,force:true})}catch{}
  await client.close();
 }
 fs.writeFileSync(path.join(__dirname,'../build/windows-ssh-control-results.json'),JSON.stringify({results},null,2)+'\n');
 if(results.some(r=>!r.passed))process.exitCode=1;
});
