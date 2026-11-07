import { constants, lstatSync, realpathSync, mkdirSync, openSync, closeSync, writeSync, fsyncSync, fstatSync, readSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { audioFormat } from './tts/audio-format.js';

export type StorageGrant = { key: string; fileName: string; kind: 'input' | 'audio' | 'video'; mime: 'video/mp4' | 'audio/mpeg'; bytes: number; sha256: string };
export type OutputLeaseGrant = { key: string; fileName: string; maxBytes: number; timeoutMs: number };
const deny = () => new Error('S32_E2E_STORAGE_DENIED');
const inside = (root: string,target: string) => { const rel=relative(root,target); return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`); };

/** Scoped storage API for isolated tests/preparation, not a global FS interceptor.
 * No rename/overwrite/delete/encode capability is exposed. */
export class E2eStorage {
  private readonly grants: StorageGrant[];
  private readonly used = new Set<string>();
  private stopped = false;
  private outputDone = false;
  private readonly outputs: readonly OutputLeaseGrant[];
  readonly directory: string;
  constructor(private readonly workspace: string, root: string, runId: string, projectId: string, grants: readonly StorageGrant[], private readonly record: (event: string)=>void, private readonly enabled = false, outputGrants: readonly OutputLeaseGrant[] = [], private readonly writerAllowed?: (kind:'input'|'audio'|'video')=>boolean) {
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(runId) || !/^[a-f0-9]{24}$/.test(projectId)) throw deny();
    this.workspace = resolve(workspace); root = resolve(root);
    if (!inside(this.workspace,root)) throw deny();
    this.directory = resolve(root,'runs',runId,projectId);
    this.grants = grants.map(g=>{
      if (!['input','audio','video'].includes(g.kind) || !/^[a-zA-Z0-9_-]{8,100}$/.test(g.key) || !/^[a-zA-Z0-9_-]+\.(mp4|mp3)$/.test(g.fileName) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(g.fileName) || !/^[a-f0-9]{64}$/.test(g.sha256) ||
          !Number.isSafeInteger(g.bytes) || g.bytes <= 0 || g.bytes > (g.kind === 'audio' ? 32 : 200)*1024*1024 ||
          (g.kind === 'audio' ? g.mime !== 'audio/mpeg' || extname(g.fileName) !== '.mp3' : g.kind==='input'&&g.mime==='audio/mpeg' ? extname(g.fileName)!=='.mp3' : g.mime !== 'video/mp4' || extname(g.fileName) !== '.mp4')) throw deny();
      return Object.freeze({...g});
    });
    if (new Set(this.grants.map(g=>g.key)).size !== grants.length || new Set(this.grants.map(g=>g.fileName)).size !== grants.length || new Set(this.grants.map(g=>g.kind)).size !== grants.length) throw deny();
    this.outputs=outputGrants.map(g=>{
      if(!/^[a-zA-Z0-9_-]{8,100}$/.test(g.key) || !/^[a-zA-Z0-9_-]+\.mp4$/.test(g.fileName) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(g.fileName) || !Number.isSafeInteger(g.maxBytes) || g.maxBytes<12 || g.maxBytes>200*1024*1024 || !Number.isSafeInteger(g.timeoutMs) || g.timeoutMs<1 || g.timeoutMs>300000)throw deny();
      return Object.freeze({...g});
    });
    if(new Set([...this.grants,...this.outputs].map(g=>g.key)).size!==grants.length+outputGrants.length || new Set([...this.grants,...this.outputs].map(g=>g.fileName)).size!==grants.length+outputGrants.length || outputGrants.length>1)throw deny();
  }
  private checkParents(create = false): void {
    if (lstatSync(this.workspace).isSymbolicLink()) throw deny();
    let cursor = this.workspace;
    for (const part of relative(this.workspace,this.directory).split(sep)) {
      cursor = resolve(cursor,part);
      try { const stat=lstatSync(cursor);if(stat.isSymbolicLink() || !stat.isDirectory())throw deny(); }
      catch(error) {
        if (!create || !(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
        mkdirSync(cursor);
        if(lstatSync(cursor).isSymbolicLink())throw deny();
      }
    }
    if (!inside(realpathSync(this.workspace),realpathSync(this.directory))) throw deny();
  }
  completedOutput():boolean { return this.outputDone && !this.stopped; }
  write(key: string, bytes: Uint8Array): { path: string; bytes: number; sha256: string; mime: string } {
    if (!this.enabled || this.stopped || this.used.has(key)) throw deny();
    const g=this.grants.find(g=>g.key===key);if(!g)throw deny();
    if(this.writerAllowed && !this.writerAllowed(g.kind))throw deny();
    const data=Buffer.from(bytes),sha256=createHash('sha256').update(data).digest('hex');
    if(data.length !== g.bytes || sha256 !== g.sha256 || (g.kind==='audio' ? audioFormat(data)!=='mp3' : g.mime==='audio/mpeg' ? data.length<4 || !(data.toString('ascii',0,3)==='ID3'||data[0]===255&&(data[1]!&224)===224) : data.length<12 || data.toString('ascii',4,8)!=='ftyp'))throw deny();
    this.used.add(key);
    let fd: number | undefined;
    try {
      this.record(`STORAGE_CLAIM_${key}`);this.checkParents(true);
      const target=resolve(this.directory,g.fileName);if(!inside(this.directory,target))throw deny();
      fd=openSync(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);
      let offset=0;while(offset<data.length){const written=writeSync(fd,data,offset,data.length-offset);if(written<=0)throw deny();offset+=written;}
      fsyncSync(fd);if(!fstatSync(fd).isFile() || fstatSync(fd).size!==g.bytes)throw deny();
      this.checkParents();if(realpathSync(target)!==target)throw deny();
      this.record(`STORAGE_DONE_${key}`);return{path:target,bytes:g.bytes,sha256,mime:g.mime};
    } catch(error) { this.stopped=true;throw error; }
    finally { if(fd!==undefined)closeSync(fd); }
  }
  /** Reserve O_EXCL before spawning. Encoder gets only the reserved descriptor;
   * it never receives authority to create/overwrite a path. Failed files remain
   * quarantined; no cleanup or lease reuse is exposed. */
  async output<T>(key: string, execute: (fd:number,signal:AbortSignal)=>Promise<T>, validate:(path:string,bytes:Buffer)=>Promise<boolean>, signal?:AbortSignal, expectedPath?:string):Promise<{result:T;path:string;bytes:number;sha256:string;mime:'video/mp4'}> {
    const grant=this.outputs.find(g=>g.key===key);
    if(!this.enabled || this.stopped || !grant || this.used.has(key) || signal?.aborted || expectedPath && resolve(expectedPath)!==resolve(this.directory,grant.fileName) || this.writerAllowed && !this.writerAllowed('video'))throw deny();
    this.used.add(key);const controller=new AbortController();let fd:number|undefined,timer:ReturnType<typeof setTimeout>|undefined,monitor:ReturnType<typeof setInterval>|undefined;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    let rejectDeadline:(reason:Error)=>void=()=>{};
    const deadline=new Promise<never>((_r,reject)=>{rejectDeadline=reject;});
    const fail=()=>{controller.abort();rejectDeadline(deny());};
    try{
      this.record(`OUTPUT_CLAIM_${key}`);this.checkParents(true);
      const path=resolve(this.directory,grant.fileName);if(!inside(this.directory,path))throw deny();
      fd=openSync(path,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);
      timer=setTimeout(fail,grant.timeoutMs);
      monitor=setInterval(()=>{try{if(fd!==undefined && fstatSync(fd).size>grant.maxBytes)fail();}catch{fail();}},20);
      controller.signal.addEventListener('abort',()=>rejectDeadline(deny()),{once:true});
      if(signal?.aborted)controller.abort();
      const result=await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)throw deny();return execute(fd!,controller.signal);}),deadline]);
      fsyncSync(fd);const size=fstatSync(fd).size;
      if(!size || size>grant.maxBytes || !fstatSync(fd).isFile())throw deny();
      const data=Buffer.alloc(size);let offset=0;while(offset<size){const count=readSync(fd,data,offset,size-offset,offset);if(count<=0)throw deny();offset+=count;}
      const sha256=createHash('sha256').update(data).digest('hex');
      this.checkParents();if(realpathSync(path)!==path || data.length<12 || data.toString('ascii',4,8)!=='ftyp' || !await Promise.race([validate(path,Buffer.from(data)),deadline]) || controller.signal.aborted)throw deny();
      const current=fstatSync(fd),named=lstatSync(path);
      if(current.size!==size || named.isSymbolicLink() || current.ino!==named.ino || current.dev!==named.dev)throw deny();
      const after=Buffer.alloc(size);offset=0;while(offset<size){const count=readSync(fd,after,offset,size-offset,offset);if(count<=0)throw deny();offset+=count;}
      if(createHash('sha256').update(after).digest('hex')!==sha256)throw deny();
      this.record(`OUTPUT_DONE_${key}`);this.outputDone=true;return{result,path,bytes:size,sha256,mime:'video/mp4'};
    }catch(error){this.stopped=true;controller.abort();try{this.record(`OUTPUT_REVOKED_${key}`);}catch{/*revoked remains*/}throw error;}
    finally{if(timer)clearTimeout(timer);if(monitor)clearInterval(monitor);signal?.removeEventListener('abort',abort);if(fd!==undefined)closeSync(fd);}
  }
}
