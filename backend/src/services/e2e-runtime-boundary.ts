import { e2eRunEnabled } from './e2e-test-run.js';
import type { E2eStorage } from './e2e-storage.js';
import type { QuotaIdentity, QuotaSession } from './e2e-quota-transaction.js';
import type { E2eActualAssets, ActualSession } from './e2e-actual-runtime.js';

export type WriterIdentity = { projectId: string; ownerId: string };
export type E2eRuntimeBinding = WriterIdentity & {
  runId: string;
  diagnostics?:()=>unknown;
  writer<T>(identity: WriterIdentity, work: () => Promise<T>, writerName?: string): Promise<T>;
  quota?<T>(session: QuotaSession, identity: QuotaIdentity, work: () => Promise<T>): Promise<T>;
  quotaAttested?(session:QuotaSession,identity:QuotaIdentity):void;
  failure?(writer:'TTS'|'Result'|'Translation',details:Record<string,unknown>):void;
  record(event: string): void;
  input?: { storage: E2eStorage; key: string; maxBytes: number };
  render?: (binary:string,args:string[],stage:string)=>Promise<{stdout:string;stderr:string}>;
  assets?: E2eActualAssets;
  transaction?<T>(session:ActualSession,work:()=>Promise<T>,options?:unknown):Promise<T>;
  audit?(work:()=>Promise<unknown>):Promise<void>;
};
let binding: E2eRuntimeBinding | undefined;
let composedStartup: (()=>boolean)|undefined;
const deny = () => new Error('S32_E2E_RUNTIME_NOT_PREPARED');

/** Explicit registration only; no env/startup auto-arming. Native/preload and
 * storage permissions remain independent, and are not granted by registration. */
export function registerPreparedE2eBoundary(value: E2eRuntimeBinding): void {
  if (binding || !/^[a-zA-Z0-9_-]{8,64}$/.test(value.runId) || ![value.projectId,value.ownerId].every(v=>/^[a-f0-9]{24}$/.test(v))) throw deny();
  binding = Object.freeze({...value});
}
export function assertE2eStartupReady(): void {
  if (e2eRunEnabled() && (!binding || !composedStartup?.())) throw new Error('S32_E2E_PRELOAD_COMPOSITION_BLOCKED');
}
/** Called by the explicit composition only, never by env parsing or registration
 * of a standalone mock/service callback. */
export function attestComposedStartup(value:E2eRuntimeBinding,ready:()=>boolean):void {
  if(binding?.runId!==value.runId || binding.projectId!==value.projectId || binding.ownerId!==value.ownerId || composedStartup || !ready())throw deny();
  composedStartup=ready;
}
export function currentPreparedBoundary(identity: WriterIdentity): E2eRuntimeBinding {
  if (!binding || identity.projectId !== binding.projectId || identity.ownerId !== binding.ownerId) throw deny();
  return binding;
}
/** The Web reads missing artifacts before generating them. Only these exact
 * scoped 404 reads are empty states, never permission to retry a write. */
export function expectedE2eEmptyRead(method:string,path:string,ownerId:string,status:number,code:string):boolean {
  if(!e2eRunEnabled()||!binding||method!=='GET'||status!==404||ownerId!==binding.ownerId)return false;
  const route=path.split('?')[0],base=`/api/projects/${binding.projectId}`;
  return route===`${base}/transcript`&&code==='TRANSCRIPT_NOT_FOUND'
    ||route===`${base}/translations/en`&&code==='TRANSLATION_NOT_FOUND';
}
export async function guardedActualWriter<T>(identity: WriterIdentity, work: () => Promise<T>, writerName?: string): Promise<T> {
  if (!e2eRunEnabled()) return work();
  const runtime=currentPreparedBoundary(identity);
  return runtime.writer(identity,work,writerName);
}
export function denyUnscopedTestStorage(): void {
  if (e2eRunEnabled()) throw new Error('S32_E2E_STORAGE_PATH_NOT_GRANTED');
}
export function preparedRender(binary:string,args:string[],stage:string):Promise<{stdout:string;stderr:string}> {
  if(!binding?.render)throw new Error('S32_E2E_STORAGE_PATH_NOT_GRANTED');
  return binding.render(binary,args,stage);
}
export function assertTestQuotaScope(identity: WriterIdentity): E2eRuntimeBinding | undefined {
  return e2eRunEnabled() ? currentPreparedBoundary(identity) : undefined;
}
export function testProjectForOwner(ownerId: string): string | undefined {
  if (!e2eRunEnabled()) return;
  if (!binding || binding.ownerId !== ownerId) throw deny();
  return binding.projectId;
}
export function actualAssets():E2eActualAssets {
  if(!binding?.assets)throw new Error('S32_E2E_STORAGE_PATH_NOT_GRANTED');return binding.assets;
}
export async function withGuardedTransaction<T>(session:ActualSession,work:()=>Promise<T>,options?:unknown):Promise<T> {
  if(!e2eRunEnabled())return await session.withTransaction(work,options as Parameters<ActualSession['withTransaction']>[1]) as T;
  if(!binding?.transaction)throw deny();return binding.transaction(session,work,options);
}
export async function scopedAudit(work:()=>Promise<unknown>):Promise<void> {
  if(!e2eRunEnabled()){await work();return;}
  if(!binding?.audit)throw deny();await binding.audit(work);
}
export function rethrowE2eUncertain(error:unknown):void {
  if(e2eRunEnabled() && error instanceof Error && /E2E_.*(?:UNCERTAIN|DENIED|BLOCKED)|SCOPED_WRITE_DENIED/.test(error.message))throw error;
}
/** Service-catch only; never a route-supplied grant or a recovery mechanism. */
export function attestE2eFailure(writer:'TTS'|'Result'|'Translation',details:Record<string,unknown>):void {
  if(!e2eRunEnabled())return;
  if(!binding?.failure)throw deny();binding.failure(writer,details);
}
