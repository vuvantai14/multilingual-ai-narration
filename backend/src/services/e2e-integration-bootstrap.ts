import { installScopedWriteGuard, ScopedWriteGuard, type WriteManifest } from './scoped-write-guard.js';

type NativeDriver = Parameters<typeof installScopedWriteGuard>[0];
type AuthPolicy = Parameters<typeof installScopedWriteGuard>[2];
export type BootstrapPlan = {
  runId: string; projectId: string; ownerId: string; koreVoiceId: string;
  mediaSha256: string; mediaBytes: number; mediaSeconds: number;
  sourceMode: 'AUTO'; confirmedSource: 'vi'; target: 'en'; voice: 'Kore';
  inferenceLimits: { STT: 1; TRANSLATION: 1; TTS: 1 };
  manifest: WriteManifest;
};
export type BootstrapReads = {
  database(): Promise<string>;
  customer(ownerId: string): Promise<boolean>;
  exists(collection: string, id: string): Promise<boolean>;
  activeKore(voiceId: string): Promise<boolean>;
};
const verified = new WeakMap<object,string>();
const denied = () => new Error('S32_INTEGRATION_BOOTSTRAP_DENIED');

/** Read-adapter boundary only: never connects a DB, issues grants or starts work.
 * The caller must supply trusted reads, never HTTP-provided booleans. */
export async function verifyIntegrationBootstrap(input: BootstrapPlan, reads: BootstrapReads, preparationOptIn = false): Promise<Readonly<BootstrapPlan>> {
  if (!preparationOptIn) throw denied();
  // Immutable snapshot before the first await; no caller mutation during reads.
  const plan = structuredClone(input);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(plan.runId) || ![plan.projectId,plan.ownerId,plan.koreVoiceId].every(v=>/^[a-f0-9]{24}$/.test(v)) ||
      plan.sourceMode !== 'AUTO' || plan.confirmedSource !== 'vi' || plan.target !== 'en' || plan.voice !== 'Kore' ||
      plan.mediaSha256 !== '8e37f21fce16be8bf735b7efe22296309582f6cc7529a4aa5aae0d46f86dd1d3' || plan.mediaBytes !== 4239951 || plan.mediaSeconds !== 53.591655 ||
      ['STT','TRANSLATION','TTS'].some(k=>plan.inferenceLimits[k as keyof typeof plan.inferenceLimits] !== 1) ||
      plan.manifest.runId !== plan.runId || plan.manifest.projectId !== plan.projectId || plan.manifest.ownerId !== plan.ownerId || plan.manifest.koreVoiceId !== plan.koreVoiceId) throw denied();
  if (plan.manifest.grants.filter(g=>g.collection==='projects' && g.method==='insertOne' && g.recordId===plan.projectId).length !== 1) throw denied();
  if (await reads.database() !== 'multilingual_ai_narration' || await reads.customer(plan.ownerId) !== true || await reads.activeKore(plan.koreVoiceId) !== true || await reads.exists('projects',plan.projectId) !== false) throw denied();
  for (const grant of plan.manifest.grants) if ((grant.method === 'insertOne' || grant.collection==='media' && grant.method==='findOneAndUpdate') && await reads.exists(grant.collection,grant.recordId) !== false) throw denied();
  if (plan.manifest.database !== 'multilingual_ai_narration') throw denied();
  plan.manifest.freshProject = true;
  // Structural validation is not arming. Destructive no-op plans still need a
  // transaction-bound empty-reader and cannot be bootstrapped by assertion alone.
  new ScopedWriteGuard(plan.manifest,()=>{},false);
  // Proof carries no runtime authority: clone/freeze excludes replacing it later.
  function freeze(value: unknown): void {
    if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  }
  freeze(plan); verified.set(plan,JSON.stringify(plan)); return plan;
}

/** Preparation-only preload composition. Installs DENY before connect/worker
 * callbacks. Even verified bootstrap does NOT activate business writes. */
export function prepareReadOnlyIntegration(driver: NativeDriver, proof: Readonly<BootstrapPlan> | undefined, connect: () => Promise<void>, authAllowed?: AuthPolicy) {
  const restore = installScopedWriteGuard(driver,{ write: async()=>{ throw denied(); } },authAllowed);
  if (!proof || verified.get(proof) !== JSON.stringify(proof)) throw denied();
  let attempted = false;
  return {
    restore,
    async connectOnce() { if (attempted) throw denied(); attempted = true; await connect(); },
    startWorker(): never { throw new Error('S32_WORKER_START_DENIED'); },
    activateWrites(): never { throw new Error('S32_WRITE_ACTIVATION_NOT_APPROVED'); },
  };
}
