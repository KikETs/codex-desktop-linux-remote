'use strict';
const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const readline = require('node:readline');
const {buildCommand} = require('../src/windows-ssh.cjs');
class Client extends EventEmitter {
  constructor(connection, settings) {
    super(); this.nextId=0; this.pending=new Map(); this.closed=false;
    const [exe,...args]=buildCommand(connection,settings);
    this.child=spawn(exe,args,{stdio:['pipe','pipe','pipe']});
    this.child.stdin.on('error',e=>this.fail(e));
    this.stderr=''; this.child.stderr.on('data',b=>{this.stderr=(this.stderr+b).slice(-4096)});
    this.reader=readline.createInterface({input:this.child.stdout});
    this.reader.on('line',line=>{
      let msg; try {msg=JSON.parse(line)} catch {this.fail(new Error('Invalid JSONL response'));return}
      if(msg.method){this.emit('notification',msg);if(msg.id!=null)this.emit('approval',msg);return}
      const pending=this.pending.get(msg.id);if(!pending)return;
      this.pending.delete(msg.id);clearTimeout(pending.timer);
      if(msg.error)pending.reject(new Error(JSON.stringify(msg.error)));else pending.resolve(msg.result);
    });
    this.child.on('error',e=>this.fail(e));
    this.child.on('exit',()=>{this.closed=true;this.fail(new Error('SSH transport disconnected'));this.emit('closed')});
  }
  fail(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e)}this.pending.clear()}
  send(msg){if(this.closed)throw new Error('Transport closed');this.child.stdin.write(JSON.stringify(msg)+'\n')}
  request(method,params={},timeout=30000){
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Timeout: '+method))},timeout);
      this.pending.set(id,{resolve,reject,timer});
      try {this.send({id,method,params})} catch(e) {clearTimeout(timer);this.pending.delete(id);reject(e)}
    });
  }
  async initialize(){const r=await this.request('initialize',{clientInfo:{name:'windows-ssh-integration-test',version:'0.1.0'},capabilities:{experimentalApi:true}});this.send({method:'initialized'});return r}
  async close(){if(this.closed)return;this.child.stdin.end();let timer;try{await Promise.race([new Promise(r=>this.child.once('exit',r)),new Promise(r=>{timer=setTimeout(r,5000)})])}finally{clearTimeout(timer)}if(!this.closed)this.child.kill()}
}
module.exports={Client};
