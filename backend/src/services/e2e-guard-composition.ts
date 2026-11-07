import { AsyncLocalStorage } from 'node:async_hooks';
import { ScopedWriteGuard, installScopedWriteGuard, exclusiveWriteJournal, nativeWriteFingerprint, type ScopedGrant, type WriteScope } from './scoped-write-guard.js';
import { verifyIntegrationBootstrap, type BootstrapPlan, type BootstrapReads } from './e2e-integration-bootstrap.js';
import { E2eStorage, type StorageGrant, type OutputLeaseGrant } from './e2e-storage.js';
import { QuotaNativePolicy, type QuotaPolicy, type QuotaSession, type QuotaIdentity } from './e2e-quota-transaction.js';
import type { E2eRuntimeBinding } from './e2e-runtime-boundary.js';
import { registerPreparedE2eBoundary, attestComposedStartup } from './e2e-runtime-boundary.js';
import { runLeasedRender, type RenderLeasePlan } from './media-processing/ffmpeg-media-processor.js';
import type { spawn } from 'node:child_process';
import { resolve, relative, isAbsolute, sep, basename, dirname } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

export const E2E_WRITERS = ['Project','Media','STT','Source','Translation','Approval','TTS','Result','Quota','Worker'] as const;
export type RegisteredWriter = typeof E2E_WRITERS[number];
export type WriterPolicy = { name: RegisteredWriter; grants: string[]; after: RegisteredWriter[] };
type Driver = Parameters<typeof installScopedWriteGuard>[0];
const deny = () => new Error('S32_E2E_COMPOSITION_DENIED');
const permitted: Record<RegisteredWriter,readonly string[]> = {
  Project:['projects','activitylogs'],Media:['media','projects','activitylogs'],STT:['projects','processingjobs','transcripts','transcriptsegments','activitylogs'],
  Source:['projects','transcripts'],Translation:['projects','translationattempts'],Approval:['projects','transcripts','translations','translationattempts','activitylogs'],
  TTS:['projects','processingjobs','transcripts','translations','narrations','activitylogs'],Result:['projects','processingjobs','transcripts','translations','narrations','results','activitylogs'],
  Quota:['translationattempts'],Worker:['processingjobs'],
};

/** Closed writer registry owns the native write router and request leases.
 * No dynamic registration or grant issuance once construction has completed. */
class WriterRegistry {
  private readonly context = new AsyncLocalStorage<{ name:RegisteredWriter; active:boolean; session?:object }>();
  private readonly policies:Map<string,WriterPolicy>;
  private readonly signatures:Map<string,ScopedGrant>;
  private readonly completed=new Set<string>();
  private readonly used=new Set<string>();
  private busy=false; private stopped=false;
  constructor(private readonly scope:WriteScope, policies:readonly WriterPolicy[], grants:readonly ScopedGrant[],private readonly native:ScopedWriteGuard,private readonly quota:QuotaNativePolicy,private readonly record:(event:string)=>void, private readonly outputReady:()=>boolean) {
    this.policies=new Map();this.signatures=new Map();const owned=new Set<string>();
    for(const p of policies){
      if(!E2E_WRITERS.includes(p.name) || this.policies.has(p.name) || p.after.some(n=>!E2E_WRITERS.includes(n)||n===p.name) || p.name==='Quota' && p.grants.length)throw deny();
      for(const key of p.grants){const g=grants.find(g=>g.key===key);if(!g || owned.has(key) || !permitted[p.name].includes(g.collection))throw deny();owned.add(key);}
      this.policies.set(p.name,{name:p.name,grants:[...p.grants],after:[...p.after]});
    }
    if(owned.size!==grants.length || policies.some(p=>p.after.some(n=>!this.policies.has(n))))throw deny();
    for(const g of grants){const sig=g.collection+':'+g.method+':'+nativeWriteFingerprint(g.method,g.args);if(this.signatures.has(sig))throw deny();this.signatures.set(sig,{...g,args:[]});}
  }
  halt(){this.stopped=true;}
  healthy(){return !this.stopped;}
  isComplete(name:RegisteredWriter){return this.completed.has(name) && !this.stopped;}
  storageAllowed(kind:'input'|'audio'|'video') {
    const ctx=this.context.getStore();return !this.stopped && ctx?.active===true && ctx.name===({input:'Media',audio:'TTS',video:'Result'} as const)[kind];
  }
  async run<T>(name:string|undefined,scope:WriteScope,session:object|undefined,work:()=>Promise<T>):Promise<T>{
    const policy=name&&this.policies.get(name);
    if(!policy || this.stopped || this.busy || this.used.has(policy.name) || policy.after.some(n=>!this.completed.has(n)) || scope.runId!==this.scope.runId || scope.projectId!==this.scope.projectId || scope.ownerId!==this.scope.ownerId)throw deny();
    this.used.add(policy.name);this.busy=true;const ctx={name:policy.name,active:true,session};
    try{
      this.record(`WRITER_CLAIM_${name}`);
      const result=await this.context.run(ctx,()=>policy.name==='Quota'?work():this.native.run(scope,session,work));
      if(policy.grants.some(key=>!this.native.completedGrant(key)))throw deny();
      this.record(`WRITER_DONE_${name}`);this.completed.add(policy.name);return result;
    }catch(error){this.stopped=true;throw error;}finally{ctx.active=false;this.busy=false;}
  }
  async quotaRun<T>(scope:WriteScope,session:QuotaSession,identity:QuotaIdentity,work:()=>Promise<T>):Promise<T>{
    // Actual quota reservation is nested inside the Translation writer.
    const outer=this.context.getStore();
    if(!outer?.active || outer.name!=='Translation')throw deny();
    const policy=this.policies.get('Quota');
    if(!policy || this.used.has('Quota') || this.stopped || policy.after.some(n=>!this.completed.has(n)))throw deny();
    if(scope.runId!==this.scope.runId || scope.projectId!==this.scope.projectId || scope.ownerId!==this.scope.ownerId)throw deny();
    this.used.add('Quota');const ctx={name:'Quota' as const,active:true,session};
    try{const result=await this.context.run(ctx,()=>this.quota.run(session,identity,work));this.completed.add('Quota');return result;}
    catch(error){this.stopped=true;throw error;}finally{ctx.active=false;}
  }
  async write<T>(db:string,collection:string,method:string,args:readonly unknown[],work:()=>Promise<T>):Promise<T>{
    const ctx=this.context.getStore();if(!ctx?.active || this.stopped)throw deny();
    if(ctx.name==='Quota')return this.quota.write(db,collection,method,args,work);
    const g=this.signatures.get(collection+':'+method+':'+nativeWriteFingerprint(method,args));
    if(!g || !this.policies.get(ctx.name)!.grants.includes(g.key))throw deny();
    if(collection==='results' && !this.outputReady())throw deny();
    return this.native.write(db,collection,method,args,work);
  }
}

export type ComposeDependencies = {
  driver:Driver; reads:BootstrapReads;
  workspace:string; storageRoot:string; journal:string;
  storageGrants:readonly StorageGrant[]; outputGrants:readonly OutputLeaseGrant[];
  writers:readonly WriterPolicy[];
  quota:QuotaPolicy;
  claimed:(id:string,session:QuotaSession)=>Promise<Record<string,unknown>|null>;
  connect:()=>Promise<void>;
  authAllowed?:Parameters<typeof installScopedWriteGuard>[2];
  render?:{plan:RenderLeasePlan;validate:(path:string,data:Buffer)=>Promise<boolean>;spawn?:typeof spawn};
};

/** Explicit pre-server composition; OFF never installs anything. No connection,
 * worker, provider or media process runs until the returned methods are called.
 * The supplied driver must be the same instance used by the loaded server. */
export async function composeE2eRun(json:string,deps:ComposeDependencies,optIn=false){
  if(!optIn)return undefined;
  const connect=deps.connect;
  const render=deps.render?{plan:Object.freeze({...deps.render.plan}),validate:deps.render.validate,spawn:deps.render.spawn}:undefined;
  let ready=false;
  // Default deny is installed BEFORE parse, read validation, connect or workers.
  installScopedWriteGuard(deps.driver,{write:async(db,c,m,a,w)=>{if(!ready)throw deny();return registry.write(db,c,m,a,w);}},deps.authAllowed);
  let proof:Readonly<BootstrapPlan>;
  try{proof=await verifyIntegrationBootstrap(JSON.parse(json),deps.reads,true);}catch{throw deny();}
  if(deps.quota.runId!==proof.runId || deps.quota.projectId!==proof.projectId || deps.quota.ownerId!==proof.ownerId)throw deny();
  const rel=relative(resolve(deps.workspace),resolve(deps.journal));
  if(!rel || isAbsolute(rel) || rel==='..' || rel.startsWith(`..${sep}`) || basename(deps.journal)!==`${proof.runId}.jsonl` || lstatSync(dirname(deps.journal)).isSymbolicLink() || realpathSync(dirname(deps.journal))!==resolve(dirname(deps.journal)))throw deny();
  const record=exclusiveWriteJournal(deps.journal); // O_EXCL: no restart/resume.
  const native=new ScopedWriteGuard(proof.manifest,record,true);
  const quota=new QuotaNativePolicy(deps.quota,deps.claimed,record);
  const storage:E2eStorage=new E2eStorage(deps.workspace,deps.storageRoot,proof.runId,proof.projectId,deps.storageGrants,record,true,deps.outputGrants,(kind):boolean=>registry.storageAllowed(kind));
  const registry:WriterRegistry=new WriterRegistry(proof,deps.writers,proof.manifest.grants,native,quota,record,():boolean=>storage.completedOutput());
  const active=registry;let connected=false,connecting=false;
  const binding:E2eRuntimeBinding={runId:proof.runId,projectId:proof.projectId,ownerId:proof.ownerId,record,
    writer:(identity,work,name)=>{if(!connected)throw deny();return active.run(name,{...identity,runId:proof.runId},undefined,work);},
    quota:(session,identity,work)=>active.quotaRun(proof,session,identity,work),
    quotaAttested:(session,identity)=>quota.attestCommit(session,identity),
    input:deps.storageGrants.find(g=>g.kind==='input')?{storage,key:deps.storageGrants.find(g=>g.kind==='input')!.key,maxBytes:proof.mediaBytes}:undefined,
    render:render?(binary,args,stage)=>runLeasedRender(binary,args,stage,render.plan,storage,render.validate,render.spawn):undefined,
  };
  ready=true;record('COMPOSITION_READY');
  return{
    proof,binding,storage,
    async connectOnce(){if(!ready||connected||connecting)throw deny();connecting=true;try{await connect();connected=true;record('COMPOSITION_CONNECTED');}catch(error){ready=false;active.halt();throw error;}},
    async writer<T>(name:RegisteredWriter,scope:WriteScope,session:object|undefined,work:()=>Promise<T>){if(!connected||!ready)throw deny();return active.run(name,scope,session,work);},
    async worker<T>(scope:WriteScope,work:()=>Promise<T>){if(!connected||!ready)throw deny();return active.run('Worker',scope,undefined,work);},
    installActualBoundary(){
      if(!ready || connected || connecting)throw deny();
      registerPreparedE2eBoundary(binding);attestComposedStartup(binding,()=>ready&&active.healthy());
    },
    resultReady:()=>ready&&active.isComplete('Result'),
  };
}

/** Intended for an explicitly invoked preload BEFORE dynamically importing the
 * ordinary server. No module import arms this function or reads .env. */
export async function preloadComposedServer(json:string,deps:ComposeDependencies,loadServer:()=>Promise<void>,optIn=false){
  const run=await composeE2eRun(json,deps,optIn);
  if(!run)return;
  run.installActualBoundary();
  await run.connectOnce();
  await loadServer();return run;
}
