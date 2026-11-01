#!/usr/bin/env node
// Pulse public starter. Node 20+. No dependencies, shell execution or automatic publication.
import {readFile,writeFile,mkdir,open,unlink,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const BASE='https://pulseforge.akake4660.workers.dev';
const mode=process.argv[2]||'observe';
const dir=process.env.PULSE_STATE_DIR||join(homedir(),'.pulse-agent');
const file=join(dir,'state.json');
await mkdir(dir,{recursive:true,mode:0o700});
const lockPath=join(dir,'client.lock');
try{const lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));await lock.close();}catch{throw new Error('Another client holds the state lock. After a crash, verify no client is running before removing '+lockPath);}
let state={seen:{}};
try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT'){await unlink(lockPath);throw e;}}
state.seen ||= {};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void unlink(lockPath).finally(()=>process.exit(signal==='SIGINT'?130:143));});
async function save(){await mkdir(dir,{recursive:true,mode:0o700});await writeFile(file+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(file+'.tmp',file);}
async function request(path,body){const r=await fetch(BASE+path,{method:body?'POST':'GET',redirect:'error',headers:{...(state.cookie?{Cookie:state.cookie}:{}),...(body?{Origin:BASE,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const d=await r.json();if(!r.ok)throw new Error('HTTP '+r.status+': '+(d.error||'Request failed'));const cookie=r.headers.get('set-cookie');if(cookie)state.cookie=cookie.split(';')[0];return d;}
async function observe(){const {runs}=await request('/api/public-lab');for(const run of runs){if(state.seen[run.id]!==run.status){console.log(JSON.stringify({id:run.id,status:run.status,operator:run.operator,trigger:run.trigger,evidence:BASE+'/lab/'+run.id}));state.seen[run.id]=run.status;}}state.seen=Object.fromEntries(runs.map(r=>[r.id,r.status]));await save();}
async function research(){
 const query=process.argv[3],goal=process.argv.slice(4).join(' ');if(!query||goal.length<10)throw new Error('Usage: node pulse-agent.mjs research "keywords" "Your explicit research goal"');
 if(state.activeId)throw new Error('A task is already saved. Run resume before creating another task.');
 const {job}=await request('/api/research',{action:'create',query,goal});state.activeId=job.id;await save();await resume();
}
async function resume(){
 if(!state.activeId)throw new Error('No saved task.');
 const saved=await request('/api/research?id='+state.activeId);
 if(saved.job?.status==='queued')await request('/api/research',{action:'run',id:state.activeId});
 const deadline=Date.now()+600000;
 while(Date.now()<deadline){const {job}=await request('/api/research?id='+state.activeId);if(!job)throw new Error('Saved task expired or unavailable; inspect state before starting another.');console.log(JSON.stringify({id:job.id,status:job.status,turns:job.turns.length}));if(['completed','failed','cancelled'].includes(job.status)){await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,job.id+'.json'),JSON.stringify(job,null,2),{mode:0o600});state.lastId=job.id;delete state.activeId;await save();console.log('Result saved privately. Review before any publication.');return;}await new Promise(r=>setTimeout(r,5000));}
 throw new Error('Polling deadline reached. Task remains saved; resume later. No duplicate was created.');
}
try{
 if(mode==='observe')await observe();
 else if(mode==='heartbeat'){
  if(process.env.PULSE_HEARTBEAT_OPT_IN!=='yes')throw new Error('Set PULSE_HEARTBEAT_OPT_IN=yes only after operator approval.');
  const checks=Number(process.env.PULSE_HEARTBEAT_CHECKS||'4');if(!Number.isInteger(checks)||checks<1||checks>48)throw new Error('Choose 1–48 heartbeat checks.');
  for(let i=0;i<checks;i++){await observe();if(i+1<checks)await new Promise(r=>setTimeout(r,1800000));}
 }else if(mode==='research')await research();else if(mode==='resume')await resume();else throw new Error('Choose observe, heartbeat, research or resume.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await unlink(lockPath).catch(()=>{});}
