import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { openSync, writeSync, fsyncSync } from 'node:fs';
import mongoose from 'mongoose';

type Row = Record<string, unknown>;
export type WriteScope = Readonly<{ runId: string; projectId: string; ownerId: string }>;
export type ScopedGrant = Readonly<{
  key: string; collection: string; method: 'insertOne' | 'insertMany' | 'deleteMany' | 'updateOne' | 'findOneAndUpdate';
  recordId: string; revision?: number; state?: string; transaction?: boolean; args: readonly unknown[];
}>;
export type WriteManifest = WriteScope & { database: string; freshProject: boolean; koreVoiceId?: string; grants: readonly ScopedGrant[] };
const collections = new Set(['projects','media','processingjobs','transcripts','transcriptsegments','translations','translationattempts','narrations','results','activitylogs']);
const denied = () => new Error('S32_SCOPED_WRITE_DENIED');
const oid = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'toHexString' in v && typeof v.toHexString === 'function') return String(v.toHexString());
  return '';
};
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const transactionStamp = (session: unknown): string => {
  const value = row(row(session).serverSession).txnNumber;
  return value !== undefined && /^\d+$/.test(String(value)) ? String(value) : '';
};
function canonical(value: unknown): unknown {
  if (value === undefined) return { undefined: true };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return { date: value.toISOString() };
  if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('hex') };
  if (oid(value) && typeof value !== 'string') return { oid: oid(value) };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  throw denied();
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const nativeWriteFingerprint = (method: string, args: readonly unknown[]) => hash([method,...args.map((arg,i)=> {
  const optionsIndex=['insertOne','insertMany','deleteMany'].includes(method)?1:2;
  if(i!==optionsIndex)return arg;
  const options={...row(arg)};delete options.session;return options;
})]);
function signature(method: string, args: readonly unknown[], media = false): string {
  const index = ['insertOne','insertMany','deleteMany'].includes(method) ? 1 : 2;
  const options = { ...row(args[index]) }; delete options.session;
  if (Object.keys(options).some(k => !['returnDocument','upsert','writeConcern', ...(method === 'insertMany' ? ['ordered'] : [])].includes(k)) || options.upsert === true && !(media && method === 'findOneAndUpdate') || options.ordered === false) throw denied();
  if (options.writeConcern && (row(options.writeConcern).w !== 'majority' || row(options.writeConcern).j !== true)) throw denied();
  return hash([...args.slice(0,index), options]);
}

/** A closed, immutable operation plan. No env flag arms this component.
 * The trusted coordinator must provide independently verified freshness and exact
 * native payloads. Production activation/bootstrap is deliberately not wired. */
export class ScopedWriteGuard {
  private readonly context = new AsyncLocalStorage<{ session?: object; active: boolean }>();
  private readonly grants: Array<ScopedGrant & { signature: string }>;
  private readonly used = new Set<string>();
  private readonly done = new Set<string>();
  private readonly dependencies = new Map<string,string>();
  private readonly recordDependencies = new Map<string,string>();
  private readonly completedSessions = new Map<string,{ session: unknown; stamp: string }>();
  private busy = false;
  private leased = false;
  private stopped = false;
  private readonly scope: WriteScope;
  readonly database: string;
  constructor(manifest: WriteManifest, private readonly record: (event: string) => void, private readonly enabled = false,
    private readonly emptySegments?: (transcriptId: string, session: object) => Promise<number>) {
    this.scope = Object.freeze({ runId: manifest.runId, projectId: manifest.projectId, ownerId: manifest.ownerId });
    this.database = manifest.database;
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(manifest.runId) || ![manifest.projectId,manifest.ownerId].every(v => /^[a-f0-9]{24}$/.test(v)) || manifest.database !== 'multilingual_ai_narration' || !manifest.freshProject) throw denied();
    const keys = new Set<string>();
    if (manifest.grants.filter(g=>g.collection==='media' && row(g.args[2]).upsert===true).length > 1) throw denied();
    const newIds = new Set(manifest.grants.filter(g=>g.method==='insertOne').map(g=>g.recordId));
    this.grants = manifest.grants.map(g => {
      if (!collections.has(g.collection) || !['insertOne','insertMany','deleteMany','updateOne','findOneAndUpdate'].includes(g.method) || !/^[a-zA-Z0-9_-]{8,100}$/.test(g.key) || keys.has(g.key) || !/^[a-f0-9]{24,64}$/.test(g.recordId)) throw denied();
      keys.add(g.key);
      if (['insertMany','deleteMany'].includes(g.method)) {
        if (g.collection !== 'transcriptsegments' || !g.transaction) throw denied();
        const parent = manifest.grants.find(p=>p.collection === 'transcripts' && p.method === 'insertOne' && p.recordId === g.recordId && p.transaction && oid(row(p.args[0]).projectId) === this.scope.projectId);
        if (!parent) throw denied();
        this.dependencies.set(g.key,parent.key);
        if (g.method === 'insertMany') {
          const rows = g.args[0];
          if (!Array.isArray(rows) || !rows.length || rows.length > 20_000 || new Set(rows.map(r=>oid(row(r)._id))).size !== rows.length) throw denied();
          for (const [index,r] of rows.entries()) {
            const d = row(r);
            if (Object.keys(d).some(k=>!['_id','transcriptId','sequence','text','startTime','endTime','createdAt','updatedAt','__v'].includes(k)) || !/^[a-f0-9]{24}$/.test(oid(d._id)) || oid(d.transcriptId) !== g.recordId || d.sequence !== index+1 || typeof d.text !== 'string' || !d.text.trim() || typeof d.startTime !== 'number' || typeof d.endTime !== 'number' || !Number.isFinite(d.startTime) || !Number.isFinite(d.endTime) || d.startTime < 0 || d.endTime < d.startTime) throw denied();
          }
        } else if (!this.emptySegments || Object.keys(row(g.args[0])).length !== 1 || oid(row(g.args[0]).transcriptId) !== g.recordId) throw denied();
        return Object.freeze({ ...g, args: [], signature: signature(g.method,g.args) });
      }
      const first = row(g.args[0]);
      if (oid(first._id) !== g.recordId) throw denied();
      if (g.collection === 'projects') {
        if (g.recordId !== this.scope.projectId || oid(first.userId) !== this.scope.ownerId) throw denied();
        if (g.method === 'insertOne' && (first.status !== 'DRAFT' || first.sourceLanguageMode !== 'AUTO' || first.sourceLanguage != null)) throw denied();
      } else {
        // Collections whose actual writer omits projectId remain BLOCKED.
        if (oid(first.projectId) !== this.scope.projectId) {
          const parent = manifest.grants.find(p=>p.collection === g.collection && p.method === 'insertOne' && p.recordId === g.recordId && oid(row(p.args[0]).projectId) === this.scope.projectId);
          if (g.method === 'insertOne' || first.projectId !== undefined || !parent) throw denied();
          this.recordDependencies.set(g.key,parent.key);
        }
        if (first.userId !== undefined && oid(first.userId) !== this.scope.ownerId || first.ownerId !== undefined && oid(first.ownerId) !== this.scope.ownerId) throw denied();
      }
      if (g.method !== 'insertOne') {
        if (g.revision !== undefined && (!Number.isSafeInteger(g.revision) || g.revision < 1 || first.revision !== g.revision)) throw denied();
        if (['transcripts','translations','narrations'].includes(g.collection) && g.revision === undefined) throw denied();
        if (['projects','processingjobs'].includes(g.collection) && (!g.state || first.status !== g.state)) throw denied();
        const update = row(g.args[1]);
        const mediaUpsert = g.collection === 'media' && row(g.args[2]).upsert === true;
        if (mediaUpsert && (g.method !== 'findOneAndUpdate' || oid(row(update.$setOnInsert)._id) !== g.recordId)) throw denied();
        if (Array.isArray(g.args[1]) || !Object.keys(update).length || Object.keys(update).some(k=>!['$set','$unset','$inc', ...(mediaUpsert ? ['$setOnInsert'] : [])].includes(k))) throw denied();
        for (const [operator,fields] of Object.entries(update)) if (Object.keys(row(fields)).some(k=>['_id','projectId','userId','ownerId','voiceId','transcriptId','translationId','narrationId','sourceTranscriptId','sourceTranslationId','sourceNarrationId'].includes(k.split('.')[0]!) && !(mediaUpsert && operator === '$setOnInsert' && k === '_id'))) throw denied();
        if (mediaUpsert) {
          const project = manifest.grants.find(p=>p.collection==='projects' && p.method==='insertOne' && p.recordId===this.scope.projectId);
          if (!project) throw denied(); this.recordDependencies.set(g.key,project.key);
        }
      }
      if (first.targetLanguage !== undefined && first.targetLanguage !== 'en' || first.languageCode !== undefined && !(g.collection === 'transcripts' && first.languageCode === null) && !['vi','en'].includes(String(first.languageCode))) throw denied();
      if (first.voiceId !== undefined && (!manifest.koreVoiceId || !/^[a-f0-9]{24}$/.test(manifest.koreVoiceId) || oid(first.voiceId) !== manifest.koreVoiceId)) throw denied();
      if (g.method === 'insertOne' && ['transcripts','translations','narrations'].includes(g.collection) && first.revision !== 1) throw denied();
      for (const field of ['transcriptId','translationId','narrationId','sourceTranscriptId','sourceTranslationId','sourceNarrationId']) {
        if (first[field] !== undefined && !newIds.has(oid(first[field]))) throw denied();
      }
      if (g.method === 'insertOne' && ['translations','narrations','results'].includes(g.collection)) {
        const field = g.collection === 'translations' ? 'sourceTranscriptRevision' : g.collection === 'narrations' ? 'sourceTranslationRevision' : 'sourceNarrationRevision';
        if (!Number.isSafeInteger(first[field]) || Number(first[field]) < 1) throw denied();
      }
      // Snapshot full argument fingerprint; mutation of caller arrays cannot widen it.
      return Object.freeze({ ...g, args: [], signature: signature(g.method,g.args,g.collection === 'media') });
    });
    this.append('START_NO_RESUME');
  }
  private append(event: string) { try { this.record(event); } catch { this.stopped = true; throw denied(); } }
  completedGrant(key:string):boolean { return !this.stopped && this.done.has(key); }
  async run<T>(scope: WriteScope, session: object | undefined, work: () => Promise<T>): Promise<T> {
    if (!this.enabled || this.stopped || this.leased || this.context.getStore() || scope.runId !== this.scope.runId || scope.projectId !== this.scope.projectId || scope.ownerId !== this.scope.ownerId) throw denied();
    const lease = { session, active: true }; this.leased = true;
    try { return await this.context.run(lease,work); }
    finally { lease.active = false; this.leased = false; }
  }
  async write<T>(database: string, collection: string, method: string, args: readonly unknown[], work: () => Promise<T>): Promise<T> {
    const ctx = this.context.getStore();
    if (!this.enabled || !ctx?.active || this.stopped || this.busy || database !== this.database) throw denied();
    const sig = signature(method,args,collection === 'media');
    const g = this.grants.find(g=>g.collection === collection && g.method === method && g.signature === sig);
    if (!g || this.used.has(g.key)) throw denied();
    const recordDependency = this.recordDependencies.get(g.key);
    if (recordDependency && !this.done.has(recordDependency)) throw denied();
    const dependency = this.dependencies.get(g.key);
    if (dependency && !this.done.has(dependency)) throw denied();
    const session = row(args[['insertOne','insertMany','deleteMany'].includes(method) ? 1 : 2]).session;
    if (g.transaction ? !ctx.session || session !== ctx.session || typeof row(session).inTransaction !== 'function' || !(row(session).inTransaction as () => boolean).call(session) : session !== undefined) throw denied();
    if (recordDependency && this.grants.find(p=>p.key===recordDependency)?.transaction) {
      const parent = this.completedSessions.get(recordDependency), stamp = transactionStamp(session);
      if (!stamp || !parent || parent.session !== session || parent.stamp !== stamp) throw denied();
    }
    if (dependency) {
      const parent = this.completedSessions.get(dependency), stamp = transactionStamp(session);
      if (!stamp || !parent || parent.session !== session || parent.stamp !== stamp) throw denied();
    }
    this.busy = true; this.used.add(g.key);
    try {
      this.append(`CLAIM_${g.key}`);
      // Never dispatch a destructive delete, even for an exact grant. Only
      // first-run empty persistence is compatible with this controlled no-op.
      if (method === 'deleteMany') {
        if (!ctx.session || await this.emptySegments!(g.recordId,ctx.session) !== 0) throw denied();
        this.append(`DONE_${g.key}`); this.done.add(g.key);
        return { acknowledged: true, deletedCount: 0 } as T;
      }
      const result = await work();
      const value = row(result);
      if (method === 'insertMany') {
        const expected = (args[0] as unknown[]).map(d=>oid(row(d)._id));
        const actual = Object.values(row(value.insertedIds)).map(oid);
        if (value.acknowledged !== true || value.insertedCount !== expected.length || actual.length !== expected.length || expected.some((id,i)=>id !== actual[i])) throw denied();
      } else if (method === 'insertOne' ? value.acknowledged !== true || oid(value.insertedId) !== g.recordId : method === 'updateOne' ? value.acknowledged !== true || value.matchedCount !== 1 : oid(value._id) !== g.recordId) throw denied();
      this.append(`DONE_${g.key}`); this.done.add(g.key); this.completedSessions.set(g.key,{ session, stamp: transactionStamp(session) }); return result;
    }
    catch (error) { this.stopped = true; try { this.append(`STOP_${g.key}`); } catch { /* keep stopped */ } throw error; }
    finally { this.busy = false; }
  }
}

/** Exclusive file creation refuses replay/restart; never reopen an old journal. */
export function exclusiveWriteJournal(path: string): (event: string) => void {
  let fd: number; try { fd = openSync(path,'wx',0o600); } catch { throw denied(); }
  return event => { writeSync(fd,JSON.stringify({ event, at: new Date().toISOString() })+'\n'); fsyncSync(fd); };
}

type Prototype = Record<string, unknown>;
type NativeCall = (...args: unknown[]) => unknown;
type NativeCollection = { dbName?: string; collectionName?: string };
const blocked = ['insertOne','insertMany','updateOne','updateMany','replaceOne','deleteOne','deleteMany','findOneAndUpdate','findOneAndReplace','findOneAndDelete','bulkWrite','initializeOrderedBulkOp','initializeUnorderedBulkOp','createIndex','createIndexes','dropIndex','dropIndexes','createCollection','dropCollection','dropDatabase','drop','rename','renameCollection','command','executeDbAdminCommand','mapReduce'];

/** Install against the SAME driver instance Mongoose uses before models/writers.
 * Existing read-only preload is not removed: its original remains in the chain.
 * No automatic installation and no automatic business permission are provided. */
export function installScopedWriteGuard(driver: { Collection: { prototype: Prototype }; Db: { prototype: Prototype }; MongoClient: { prototype: Prototype }; Admin?: { prototype: Prototype } }, guard: Pick<ScopedWriteGuard,'write'>,
  authAllowed: (collection: NativeCollection, method: string, args: readonly unknown[]) => boolean = () => false): () => void {
  const restore: Array<() => void> = [];
  const targets = [['Collection',driver.Collection.prototype],['Db',driver.Db.prototype],['MongoClient',driver.MongoClient.prototype], ...(driver.Admin ? [['Admin',driver.Admin.prototype] as const] : [])] as const;
  for (const [kind,prototype] of targets) {
    for (const method of blocked) {
      if (typeof prototype[method] !== 'function') continue;
      const original = prototype[method] as NativeCall;
      const wrapped = function(this: NativeCollection,...args: unknown[]) {
        if (kind !== 'Collection') {
          const command=row(args[0]);
          if((kind==='Db'||kind==='Admin')&&method==='command'&&Object.keys(command).length===1&&(command.hello===1||command.ping===1))return original.apply(this,args);
          throw denied();
        }
        let snapshot = args;
        if (['insertOne','insertMany','deleteOne','deleteMany','updateOne','findOneAndUpdate'].includes(method)) {
          // Driver operations may serialize after an await. Never delegate the
          // caller's mutable document/filter/update after checking its fingerprint.
          const optionsIndex = ['insertOne','insertMany','deleteOne','deleteMany'].includes(method) ? 1 : 2;
          try {
            snapshot = args.slice(0,optionsIndex).map(value=>mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize({ value })).value);
            const options = { ...row(args[optionsIndex]) }; const session = options.session; delete options.session;
            snapshot.push({ ...mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize(options)), ...(session ? { session } : {}) });
          } catch { return Promise.reject(denied()); }
        }
        if (this.dbName === 'multilingual_ai_narration' && this.collectionName === 'authsessions' && authAllowed(this,method,snapshot)) return original.apply(this,snapshot);
        return guard.write(this.dbName ?? '',this.collectionName ?? '',method,snapshot,async()=>original.apply(this,snapshot));
      };
      prototype[method] = wrapped;
      restore.push(()=>{ if (prototype[method] === wrapped) prototype[method] = original; });
    }
    if ((kind === 'Collection'||kind==='Db') && typeof prototype.aggregate === 'function') {
      const original = prototype.aggregate as NativeCall;
      const wrapped = function(this: unknown,...args: unknown[]) {
        // Aggregations can hide $out/$merge in nested structures. Only fixed
        // read-stage pipelines are allowed; unknown stages also fail closed.
        const safe = new Set(['$match','$project','$sort','$limit','$skip','$count','$group','$unwind','$addFields','$set','$unset','$replaceRoot','$replaceWith']);
        if (!Array.isArray(args[0]) || args[0].some(stage=>Object.keys(row(stage)).length !== 1 || !safe.has(Object.keys(row(stage))[0]!))) throw denied();
        return original.apply(this,args);
      };
      prototype.aggregate = wrapped; restore.push(()=>{if(prototype.aggregate===wrapped)prototype.aggregate=original;});
    }
  }
  return () => { for (const fn of restore.reverse()) fn(); };
}
