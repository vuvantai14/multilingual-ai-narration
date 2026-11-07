import { assertTestQuotaScope, type WriterIdentity, type E2eRuntimeBinding } from './e2e-runtime-boundary.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { digest } from './translation/group-plan.js';
import { nativeWriteFingerprint } from './scoped-write-guard.js';

type TxOptions = { readConcern: { level: 'snapshot' }; writeConcern: { w: 'majority'; j: true } };
export interface QuotaSession {
  withTransaction<T>(work: () => Promise<T>, options: TxOptions): Promise<unknown>;
  startTransaction(options: TxOptions): void;
  commitTransaction(): Promise<void>;
  abortTransaction(): Promise<void>;
  inTransaction(): boolean;
  serverSession?: { txnNumber?: unknown };
}

type NativeRow = Record<string,unknown>;
const asRow = (v: unknown): NativeRow => v && typeof v==='object' ? v as NativeRow : {};
export type QuotaPolicy = QuotaIdentity & { runId: string; perUser: number; global: number; binding: string };
/** Exact native policy for the three EXISTING reservation updates, not a
 * permission for arbitrary quota documents. Must wrap the commit attestation. */
export class QuotaNativePolicy {
  private readonly context = new AsyncLocalStorage<{ session: QuotaSession; active: boolean; writes: number; busy: boolean; stamp?: string; attested:boolean }>();
  private used=false;
  private stopped=false;
  private readonly policy: Readonly<QuotaPolicy>;
  readonly attemptId: string;
  constructor(policy: QuotaPolicy, private readonly claimed: (id: string,session: QuotaSession)=>Promise<NativeRow|null>, private readonly record: (event: string)=>void) {
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(policy.runId) || ![policy.ownerId,policy.projectId].every(id=>/^[a-f0-9]{24}$/.test(id)) || !/^[a-f0-9]{64}$/.test(policy.binding) || !/^[a-f0-9]{64}$/.test(policy.sourceRevision) || !['en','ja','ko','zh'].includes(policy.targetLanguage) || !/^\d{4}-\d{2}-\d{2}$/.test(policy.day) || !Number.isInteger(policy.perUser) || policy.perUser<1 || policy.perUser>1000 || !Number.isInteger(policy.global) || policy.global<1 || policy.global>10000) throw uncertain();
    this.policy=Object.freeze({...policy});
    this.attemptId=digest(['CUSTOMER_TRANSLATION_V1',policy.ownerId,policy.projectId,policy.targetLanguage,policy.sourceRevision]);
  }
  async run<T>(session: QuotaSession, identity: QuotaIdentity, work:()=>Promise<T>):Promise<T> {
    if(this.used || this.stopped || this.context.getStore() || identity.projectId!==this.policy.projectId || identity.ownerId!==this.policy.ownerId || identity.sourceRevision!==this.policy.sourceRevision || identity.targetLanguage!==this.policy.targetLanguage || identity.day!==this.policy.day || identity.day!==new Date().toISOString().slice(0,10) || session.inTransaction())throw uncertain();
    this.used=true;const lease={session,active:true,writes:0,busy:false,stamp:undefined as string|undefined,attested:false};
    try{return await this.context.run(lease,async()=>{this.record('QUOTA_NATIVE_BEGIN');const result=await work();if(lease.writes!==3 || session.inTransaction() || !lease.attested)throw uncertain();this.record('QUOTA_NATIVE_COMPLETE');return result;});}
    catch(error){this.stopped=true;throw error;}finally{lease.active=false;}
  }
  attestCommit(session:QuotaSession,identity:QuotaIdentity):void {
    const ctx=this.context.getStore();
    if(!ctx?.active || ctx.session!==session || ctx.attested || ctx.writes!==3 || session.inTransaction() || ctx.stamp!==String(session.serverSession?.txnNumber) || identity.ownerId!==this.policy.ownerId || identity.projectId!==this.policy.projectId || identity.sourceRevision!==this.policy.sourceRevision || identity.targetLanguage!==this.policy.targetLanguage || identity.day!==this.policy.day)throw uncertain();
    ctx.attested=true;
  }
  async write<T>(database:string,collection:string,method:string,args:readonly unknown[],work:()=>Promise<T>):Promise<T> {
    const ctx=this.context.getStore();
    if(this.stopped || !ctx?.active || ctx.busy || ctx.writes>=3 || database!=='multilingual_ai_narration' || collection!=='translationattempts' || method!=='updateOne' || !ctx.session.inTransaction() || asRow(args[2]).session!==ctx.session || this.policy.day!==new Date().toISOString().slice(0,10))throw uncertain();
    const stamp=String(ctx.session.serverSession?.txnNumber ?? '');
    if(!/^\d+$/.test(stamp) || ctx.stamp && ctx.stamp!==stamp)throw uncertain();
    ctx.busy=true;
    try{
      if(ctx.writes===0){
        const attempt=await this.claimed(this.attemptId,ctx.session);
        if(!attempt || attempt._id!==this.attemptId || attempt.ownerId!==this.policy.ownerId || attempt.projectId!==this.policy.projectId || attempt.targetLanguage!==this.policy.targetLanguage || attempt.sourceRevision!==this.policy.sourceRevision || attempt.binding!==this.policy.binding || attempt.state!=='CLAIMED' || attempt.executionVersion!==1 || attempt.phase!=='METADATA_DISPATCHING' || attempt.quotaReserved===true)throw uncertain();
        ctx.stamp=stamp;
      }
      let expected: unknown[];
      if(ctx.writes<2){
        const id=ctx.writes===0?`customer-day:${this.policy.ownerId}:${this.policy.day}`:`customer-global-day:${this.policy.day}`;
        const cap=ctx.writes===0?this.policy.perUser:this.policy.global;
        expected=[{_id:id,count:{$lt:cap}},{$inc:{count:1},$setOnInsert:{kind:'QUOTA'}},{session:ctx.session,upsert:true}];
      }else expected=[{_id:this.attemptId,state:'CLAIMED',executionVersion:1,quotaReserved:{$ne:true}},{$set:{quotaReserved:true,quotaDay:this.policy.day}},{session:ctx.session}];
      if(nativeWriteFingerprint(method,args)!==nativeWriteFingerprint(method,expected))throw uncertain();
      if(ctx.writes<2){
        const counter=await this.claimed(String(asRow(expected[0])._id),ctx.session);
        const cap=ctx.writes===0?this.policy.perUser:this.policy.global;
        if(counter && (counter.kind!=='QUOTA' || !Number.isSafeInteger(counter.count) || Number(counter.count)<0 || Number(counter.count)>=cap))throw uncertain();
      }
      if(!ctx.active || !ctx.session.inTransaction() || String(ctx.session.serverSession?.txnNumber)!==stamp)throw uncertain();
      const index=ctx.writes++;this.record(`QUOTA_NATIVE_CLAIM_${index}`);
      const result=await work(),value=asRow(result);
      if(value.acknowledged!==true || (index<2 ? Number(value.modifiedCount)+Number(value.upsertedCount)!==1 : value.matchedCount!==1 || value.modifiedCount!==1))throw uncertain();
      return result;
    }catch(error){this.stopped=true;throw error;}finally{ctx.busy=false;}
  }
}
export type QuotaIdentity = WriterIdentity & { targetLanguage: string; sourceRevision: string; day: string };
type Receipt = { ownerId?: unknown; projectId?: unknown; targetLanguage?: unknown; sourceRevision?: unknown; quotaReserved?: unknown; quotaDay?: unknown };
const uncertain = () => new Error('S32_QUOTA_COMMIT_UNCERTAIN');
const consumed = new WeakSet<E2eRuntimeBinding>();

/** Wraps the actual reservation body unchanged. Native counter permissions are
 * NOT supplied here. OFF retains the original withTransaction behavior. */
export async function runQuotaTransaction(session: QuotaSession, identity: QuotaIdentity, body: () => Promise<void>,
  readCommittedReceipt: () => Promise<Receipt | null>, options: TxOptions): Promise<void> {
  const runtime=assertTestQuotaScope(identity);
  if (!runtime) { await session.withTransaction(body,options); return; }
  const work=()=>attestQuotaCommit(runtime,session,identity,body,readCommittedReceipt,options);
  if (runtime.quota) await runtime.quota(session,identity,work); else await work();
}

export async function attestQuotaCommit(runtime: E2eRuntimeBinding, session: QuotaSession, identity: QuotaIdentity, body: () => Promise<void>, readCommittedReceipt: () => Promise<Receipt|null>, options: TxOptions): Promise<void> {
  if (consumed.has(runtime) || runtime.ownerId !== identity.ownerId || runtime.projectId !== identity.projectId || !['en','ja','ko','zh'].includes(identity.targetLanguage) || !/^[a-f0-9]{64}$/.test(identity.sourceRevision) || identity.day !== new Date().toISOString().slice(0,10) || session.inTransaction()) throw uncertain();
  consumed.add(runtime);
  // One logical commit call, no application retry. Driver-internal commit
  // protocol retries are not inference retries and are not claimed absent.
  let started=false;
  try {
    runtime.record('QUOTA_BEGIN'); session.startTransaction(options); started=true;
    await body();
    runtime.record('QUOTA_COMMIT_REQUESTED');
    await session.commitTransaction();
    if (session.inTransaction()) throw uncertain();
    // Majority read OUTSIDE the transaction, bound to exact owner/project/source.
    const receipt=await readCommittedReceipt();
    if (!receipt || receipt.ownerId !== identity.ownerId || receipt.projectId !== identity.projectId || receipt.targetLanguage !== identity.targetLanguage || receipt.sourceRevision !== identity.sourceRevision || receipt.quotaReserved !== true || receipt.quotaDay !== identity.day) throw uncertain();
    runtime.record('QUOTA_COMMITTED_ATTESTED');
    runtime.quotaAttested?.(session,identity);
  } catch {
    if (started && session.inTransaction()) { try { await session.abortTransaction(); } catch { /* do not retry or assume rollback */ } }
    try { runtime.record('QUOTA_UNCERTAIN_STOP'); } catch { /* stop without a receipt */ }
    throw uncertain();
  }
}
