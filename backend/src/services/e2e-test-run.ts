import { AsyncLocalStorage } from 'node:async_hooks';
import { openSync, writeSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../utils/app-error.js';

export type E2eStage = 'STT' | 'TRANSLATION' | 'TTS';
export type E2eRequestFailure = { method?:string;path?:string;status?:number;code?:string };
export type E2eStopEvidence = Readonly<{method:string;route:string;status:number;code:string}>;
type Scope = { projectId: string; ownerId: string; targetLanguage?: string };
const stages: E2eStage[] = ['STT', 'TRANSLATION', 'TTS'];
const deny = () => new AppError(409, 'E2E_TEST_RUN_BLOCKED', `Test run bị chặn${firstStop ? `: ${firstStop.code}` : ''}. Chỉ cho phép một project và một file; run đã dừng hoặc đã dùng không được retry/resume.`);

/** Single-process execution, exclusive durable journal across processes/restarts.
 * Entries are fsynced BEFORE work; existing journals are never reopened/reset. */
export class E2eTestRun {
  private stopped = false;
  private busy = false;
  private next = 0;
  private created = false;
  private target?:string;
  constructor(private readonly scope: Scope, private readonly record: (event: string) => void, private readonly targets:readonly string[]=['en']) {}
  private append(event: string) { try { this.record(event); } catch { this.stopped = true; throw deny(); } }
  stop() { this.stopped = true; this.append('STOP_REQUEST_ERROR'); }
  snapshot() { return { stopped:this.stopped,busy:this.busy,projectClaimed:this.created,
    dispatches:{STT:Number(this.next>0),TRANSLATION:Number(this.next>1),TTS:Number(this.next>2)} }; }
  claimProject(ownerId: string): string {
    if (ownerId !== this.scope.ownerId || this.created || this.stopped) throw deny();
    this.created = true; this.append('PROJECT_CLAIM'); return this.scope.projectId;
  }
  async run<T>(stage: E2eStage, scope: Scope | undefined, work: () => Promise<T>): Promise<T> {
    if (this.stopped || this.busy || !this.created || !scope || scope.ownerId !== this.scope.ownerId || scope.projectId !== this.scope.projectId ||
        stage !== stages[this.next] || (stage !== 'STT' && (!this.targets.includes(scope.targetLanguage??'') || this.target!==undefined&&scope.targetLanguage!==this.target))) throw deny();
    if(stage==='TRANSLATION')this.target=scope.targetLanguage;
    this.busy = true; this.next++;
    try { this.append(`CLAIM_${stage}`); const result = await work(); this.append(`COMPLETE_${stage}`); return result; }
    catch (error) { this.stopped = true; try { this.append(`STOP_${stage}`); } catch { /* fail closed even if journal unavailable */ } throw error; }
    finally { this.busy = false; }
  }
}

export function durableRun(scope: Scope, journal: string,targets:readonly string[]=['en']): E2eTestRun {
  // O_EXCL is the cross-process fence. Failure never means permission to resume.
  let fd: number;
  try { fd = openSync(journal, 'wx', 0o600); } catch { throw deny(); }
  const record = (event: string) => {
    writeSync(fd, JSON.stringify({ event, at: new Date().toISOString() }) + '\n'); fsyncSync(fd);
  };
  try { record('START_NO_RESUME'); } catch { closeSync(fd); throw deny(); }
  // The descriptor deliberately remains open for this process lifetime.
  return new E2eTestRun(scope, record,targets);
}

const context = new AsyncLocalStorage<Scope>();
let singleton: E2eTestRun | undefined;
let halted = false;
let firstStop:E2eStopEvidence|undefined;
let evidenceRecorded=false;
let stopObserver:((failure:E2eStopEvidence)=>void)|undefined;
let observer:((stage:E2eStage,value:unknown)=>Promise<void>)|undefined;
let failureObserver:((stage:E2eStage,error:unknown)=>Promise<void>)|undefined;
export function registerE2eInferenceFailureObserver(value:(stage:E2eStage,error:unknown)=>Promise<void>):void {
  if(failureObserver)throw deny();failureObserver=value;
}
export function registerE2eStopObserver(value:(failure:E2eStopEvidence)=>void):void {
  if(stopObserver)throw deny();stopObserver=value;
}
function stopEvidence(failure:E2eRequestFailure):E2eStopEvidence {
  const path=typeof failure.path==='string'?failure.path.split('?')[0]!.replace(/[a-f0-9]{24}/gi,':id'):'';
  const routes=new Set(['/api/auth/me','/api/auth/login','/api/auth/refresh','/api/auth/logout','/api/projects','/api/projects/:id',
    ...['media','transcript','transcription','translations/en','narrations','process'].map(p=>'/api/projects/:id/'+p)]);
  return Object.freeze({method:['GET','POST','PATCH','PUT','DELETE','OPTIONS','HEAD'].includes(failure.method??'')?failure.method!:'OTHER',
    route:routes.has(path)?path:'OTHER',status:Number.isInteger(failure.status)&&failure.status!>=400&&failure.status!<=599?failure.status!:0,
    code:typeof failure.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(failure.code)?failure.code:'REQUEST_FAILED'});
}
/** Read-only diagnostics: never initializes a run or grants/resets any state. */
export function snapshotE2eRun() {
  const state=singleton?.snapshot();
  return Object.freeze({enabled:e2eRunEnabled(),stopped:halted||state?.stopped===true,initialized:!!singleton,
    projectClaimed:state?.projectClaimed??false,busy:state?.busy??false,
    dispatches:Object.freeze(state?.dispatches??{STT:0,TRANSLATION:0,TTS:0}),
    firstStop:firstStop?Object.freeze({...firstStop}):null,evidenceRecorded});
}
export function registerE2eInferenceObserver(value:(stage:E2eStage,result:unknown)=>Promise<void>):void {
  if(observer)throw deny();observer=value;
}
export const e2eRunEnabled = () => process.env.S32_E2E_TEST_RUN_ENABLED === 'true';
function activeRun(): E2eTestRun {
  if (halted) throw deny();
  if (singleton) return singleton;
  const ownerId = process.env.S32_E2E_OWNER_ID ?? '', projectId = process.env.S32_E2E_PROJECT_ID ?? '', runId = process.env.S32_E2E_RUN_ID ?? '';
  if (!/^[a-f0-9]{24}$/.test(ownerId) || !/^[a-f0-9]{24}$/.test(projectId) || !/^[a-zA-Z0-9_-]{8,64}$/.test(runId) ||
      process.env.CUSTOMER_TRANSLATION_ENABLED !== 'true' || process.env.CUSTOMER_TRANSLATION_METHOD !== 'GEMINI_SIMPLE_V1' ||
      (process.env.CUSTOMER_TRANSLATION_THINKING ?? 'DEFAULT') !== 'DEFAULT' || process.env.CONTROLLED_PROVIDER_MODE ||
      ['STT_PROVIDER','TRANSLATION_PROVIDER','TTS_PROVIDER'].some(key => process.env[key]?.trim().toLowerCase() !== 'gemini')) throw deny();
  const root = resolve(fileURLToPath(new URL('../../', import.meta.url)), '.e2e-control');
  mkdirSync(root, { recursive: true });
  singleton = durableRun({ ownerId, projectId }, resolve(root, `${runId}.jsonl`),process.env.S33_MANUAL_RUN==='true'?['en','ja','ko','zh']:['en']);
  return singleton;
}
export function e2eProjectId(ownerId: string): string | undefined {
  return e2eRunEnabled() ? activeRun().claimProject(ownerId) : undefined;
}
export function withE2eScope<T>(scope: Scope, work: () => T): T { return context.run(scope, work); }
export async function e2eInference<T>(stage: E2eStage, work: () => Promise<T>): Promise<T> {
  return e2eRunEnabled() ? activeRun().run(stage, context.getStore(),async()=>{
    let result:T;
    try{result=await work();}catch(error){await failureObserver?.(stage,error);throw error;}
    await observer?.(stage,result);return result;
  }) : work();
}
export function stopE2eOnRequestError(failure:E2eRequestFailure={}): void {
  if (!e2eRunEnabled()||['GET','HEAD','OPTIONS'].includes(failure.method??'')) return;
  halted = true;
  if(!firstStop){
    firstStop=stopEvidence(failure);
    try{if(stopObserver){stopObserver(firstStop);evidenceRecorded=true;}}catch{/* A missing diagnostic must never rearm the stopped run. */}
  }
  try { singleton?.stop(); } catch { /* memory remains halted if journal is unavailable */ }
}
