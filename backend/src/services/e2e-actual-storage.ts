import { constants, openSync, closeSync, writeSync, fsyncSync, fstatSync, lstatSync, realpathSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { E2eStorage } from './e2e-storage.js';
import { audioFormat } from './tts/audio-format.js';
import type { ActualManifest, Data } from './e2e-actual-runtime.js';
import type { MediaProbeResult, MediaProcessingResult } from './media-processing/media-processor.interface.js';
import { resolveMediaExecutable } from './media-processing/media-executable.js';
import { MANUAL_RUN_CONTRACT, MANUAL_MEDIA_BYTES, MANUAL_MEDIA_SECONDS } from './e2e-manual-policy.js';
import { AppError } from '../utils/app-error.js';

type OutputKind='extract'|'render';
export type ActualTools={
  probe(path:string):Promise<MediaProbeResult>;
  encode(kind:OutputKind,fd:number,source:string,audio:string|undefined,duration:number,signal:AbortSignal):Promise<void>;
  convert?(wav:Buffer,signal:AbortSignal):Promise<Buffer>;
  verifyAudio?(path:string):Promise<boolean>;
  validateInput?(path:string):Promise<void>;
};
type Fact={kind:'input'|'audio'|'video'|'extract';path:string;bytes:number;sha256:string;mime:string;probe:MediaProbeResult};
const deny=()=>new Error('S32_E2E_ACTUAL_STORAGE_DENIED');
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const inside=(root:string,path:string)=>{const r=relative(root,path);return!!r&&!isAbsolute(r)&&r!=='..'&&!r.startsWith(`..${sep}`);};
export class E2eActualStorage {
  readonly directory:string;
  private readonly files=new Map<string,Fact>();
  private readonly used=new Set<string>();
  private readonly names=new Map<string,string>();
  private readonly input:E2eStorage;
  private expectedAudio?:string;
  private inputClaimed=false;
  assertStage(name:'STT'|'TTS'|'Result'){
    if(this.writer()!==name||!this.files.size)throw deny();
    const target=this.path(name==='STT'?'extract':name==='TTS'?'audio':'video');
    try{lstatSync(target);throw deny();}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))throw e;}
  }
  async convert(wav:Buffer,signal:AbortSignal):Promise<Buffer>{
    if(this.writer()!=='TTS'||this.used.has('convert')||audioFormat(wav)!=='wav'||wav.length>32*1024*1024||!this.tools.convert)throw deny();this.used.add('convert');
    const result=await this.tools.convert(Buffer.from(wav),signal);if(signal.aborted||audioFormat(result)!=='mp3'||result.length>32*1024*1024)throw deny();return result;
  }
  expectedInputBytes(){return this.manifest.contract===MANUAL_RUN_CONTRACT?MANUAL_MEDIA_BYTES:this.manifest.media!.bytes;}
  claimed(){return this.inputClaimed;}
  constructor(private readonly workspace:string,uploadRoot:string,private readonly manifest:Readonly<ActualManifest>,private readonly record:(event:string)=>void,private readonly tools:ActualTools,private readonly writer:()=>string){
    this.input=new E2eStorage(workspace,uploadRoot,manifest.runId,manifest.projectId,manifest.contract===MANUAL_RUN_CONTRACT?[]:[{key:'actual-input-once',fileName:'input.mp4',kind:'input',mime:'video/mp4',bytes:manifest.media!.bytes,sha256:manifest.media!.sha256}],record,true,[],kind=>kind==='input'&&this.writer()==='Media');
    this.directory=this.input.directory;
  }
  private regular(path:string){const absolute=resolve(path);if(!inside(this.directory,absolute)||lstatSync(absolute).isSymbolicLink()||!lstatSync(absolute).isFile()||realpathSync(absolute)!==absolute)throw deny();return absolute;}
  private parents(){
    const base=resolve(this.workspace);if(!inside(base,this.directory))throw deny();let path=base;
    for(const part of relative(base,this.directory).split(sep)){path=resolve(path,part);try{const s=lstatSync(path);if(s.isSymbolicLink()||!s.isDirectory())throw deny();}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))throw e;mkdirSync(path);}}
    if(realpathSync(this.directory)!==resolve(this.directory))throw deny();
  }
  path(kind:'audio'|'video'|'extract'):string{
    if(!this.names.has(kind))this.names.set(kind,resolve(this.directory,`${kind}-${randomUUID()}.${kind==='audio'?'mp3':kind==='video'?'mp4':'wav'}`));return this.names.get(kind)!;
  }
  async upload(data:Buffer,file?:{originalname:string;mimetype:string}){
    if(this.writer()!=='Media'||this.used.has('input'))throw deny();this.used.add('input');
    if(this.manifest.contract===MANUAL_RUN_CONTRACT){
      const mp3=/\.mp3$/i.test(file?.originalname??'')&&['audio/mpeg','audio/mp3'].includes(file?.mimetype??'');
      const mp4=/\.mp4$/i.test(file?.originalname??'')&&file?.mimetype==='video/mp4';
      if(!data.length||data.length>MANUAL_MEDIA_BYTES||(!mp3&&!mp4)||!this.tools.validateInput)throw deny();
      const mime=mp3?'audio/mpeg':'video/mp4';
      const grant=new E2eStorage(this.workspace,resolve(this.directory,'../../..'),this.manifest.runId,this.manifest.projectId,[{key:'actual-input-once',fileName:mp3?'input.mp3':'input.mp4',kind:'input',mime,bytes:data.length,sha256:hash(data)}],this.record,true,[],kind=>kind==='input'&&this.writer()==='Media');
      try{
      const stored=grant.write('actual-input-once',data),fact=await this.seal('input',stored.path,mime);
      if(fact.probe.duration>MANUAL_MEDIA_SECONDS)throw new AppError(422,'MEDIA_DURATION_EXCEEDED','Thời lượng media vượt giới hạn 1800 giây.');
      if(mp3&&(fact.probe.audioCodec!=='mp3'||fact.probe.hasVideo))throw new AppError(422,'MEDIA_TYPE_MISMATCH','Nội dung tệp không khớp định dạng MP3.');
      await this.tools.validateInput(stored.path);await this.probe(stored.path);
      const {validateUploadedMedia}=await import('./media-validation.js');
      const validated=await validateUploadedMedia({path:stored.path,originalname:file!.originalname,mimetype:file!.mimetype,size:data.length});
      fact.mime=validated.mimeType;
      this.record(`S33_MEDIA_IDENTITY_CLAIM_${JSON.stringify({sha256:fact.sha256,bytes:fact.bytes,duration:fact.probe.duration,mime:fact.mime})}`);
      this.inputClaimed=true;
      return stored;
      }catch(error){this.record('ACTUAL_STORAGE_INPUT_QUARANTINED');throw error;}
    }
    const stored=this.input.write('actual-input-once',data);await this.seal('input',stored.path,'video/mp4',this.manifest.media!.duration);this.inputClaimed=true;return stored;
  }
  verifyAudio(data:Uint8Array){if(this.writer()!=='TTS'||this.expectedAudio)throw deny();this.expectedAudio=hash(data);}
  async saveAudio(data:Uint8Array){
    if(this.writer()!=='TTS'||this.expectedAudio!==hash(data)||audioFormat(Buffer.from(data))!=='mp3')throw deny();
    return this.produce('audio',async fd=>{let n=0;while(n<data.length){const count=writeSync(fd,data,n,data.length-n);if(count<=0)throw deny();n+=count;}},'audio/mpeg');
  }
  async extract(source:string){
    if(this.writer()!=='STT'||!this.files.has(this.regular(source))||this.files.get(source)?.kind!=='input')throw deny();
    await this.probe(source);
    return this.produce('extract',(fd,signal)=>this.tools.encode('extract',fd,source,undefined,this.metadata('input').probe.duration,signal),'audio/wav');
  }
  async render(source:string,audio:string,output:string):Promise<MediaProcessingResult>{
    if(this.writer()!=='Result'||output!==this.path('video')||this.files.get(this.regular(source))?.kind!=='input'||this.files.get(this.regular(audio))?.kind!=='audio')throw deny();
    await this.probe(source);await this.probe(audio);
    const duration=this.metadata('input').probe.duration;
    const fact=await this.produce('video',(fd,signal)=>this.tools.encode('render',fd,source,audio,duration,signal),'video/mp4',duration);
    return{...fact.probe,fileSize:fact.bytes,mimeType:'video/mp4'};
  }
  async probe(path:string){const absolute=this.regular(path),fact=this.files.get(absolute);if(!fact||hash(readFileSync(absolute))!==fact.sha256)throw deny();return{...fact.probe};}
  async verifyNarrationAudio(path:string){
    const absolute=this.regular(path),fact=this.files.get(absolute);
    if(this.writer()!=='TTS'||fact?.kind!=='audio'||!this.tools.verifyAudio)throw deny();
    await this.probe(absolute);
    if(!await this.tools.verifyAudio(absolute))throw new Error('TTS_INVALID_RESPONSE');
    await this.probe(absolute);
  }
  metadata(kind:'input'|'audio'|'video'){const value=[...this.files.values()].find(f=>f.kind===kind);if(!value)throw deny();return value;}
  validateMetadata(kind:'input'|'audio'|'video',doc:Data){
    const f=this.metadata(kind),path=String(doc[kind==='input'?'storagePath':kind==='audio'?'audioPath':'videoPath']);
    const suffix=relative(resolve(this.directory,'../../..'),f.path).replaceAll('\\','/');
    if(!f.path.replaceAll('\\','/').endsWith('/'+path)||path!==suffix||doc.fileSize!==f.bytes||doc.mimeType!==f.mime||(kind==='video'||kind==='audio')&&doc.duration!==f.probe.duration)throw deny();
  }
  cleanup(path:string){this.writer();const absolute=resolve(path);if(!inside(this.directory,absolute)||![...this.names.values(),...this.files.keys()].includes(absolute))throw deny();this.record('ACTUAL_STORAGE_QUARANTINED');/* No automatic unlink, even for new files. */}
  private async produce(kind:'audio'|'video'|'extract',encode:(fd:number,signal:AbortSignal)=>Promise<void>|void,mime:string,duration?:number){
    if(this.used.has(kind))throw deny();this.used.add(kind);this.parents();const path=this.path(kind);let fd:number|undefined;const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined,monitor:ReturnType<typeof setInterval>|undefined;let rejectDeadline:(e:Error)=>void=()=>{};
    const deadline=new Promise<never>((_r,j)=>{rejectDeadline=j;});const limit=kind==='audio'?32*1024*1024:kind==='extract'?500*1024*1024:200*1024*1024;
    const abort=()=>{controller.abort();rejectDeadline(deny());};
    try{
      this.record(`ACTUAL_FILE_LEASE_${kind}`);fd=openSync(path,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);
      timer=setTimeout(abort,kind==='video'?300000:120000);monitor=setInterval(()=>{try{if(fd!==undefined&&fstatSync(fd).size>limit)abort();}catch{abort();}},20);
      await Promise.race([Promise.resolve().then(()=>encode(fd!,controller.signal)),deadline]);fsyncSync(fd);
      const info=fstatSync(fd);if(!info.size||info.size>limit)throw deny();
      if(kind==='extract'){
        // FFmpeg streaming WAV uses unknown RIFF/data lengths. Patch only those
        // two bounded sizes in our OWN reserved file, never source media.
        const data=readFileSync(path);if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw deny();
        data.writeUInt32LE(data.length-8,4);let p=12;while(p+8<=data.length){const size=data.readUInt32LE(p+4);if(data.toString('ascii',p,p+4)==='data'){data.writeUInt32LE(data.length-p-8,p+4);break;}if(size>data.length-p-8)throw deny();p+=8+size+(size%2);}writeSync(fd,data,0,data.length,0);fsyncSync(fd);
      }
      const sealed=await Promise.race([this.seal(kind,path,mime,duration),deadline]),bound=fstatSync(fd),named=lstatSync(path);
      if(controller.signal.aborted||bound.dev!==info.dev||bound.ino!==info.ino||named.dev!==bound.dev||named.ino!==bound.ino||bound.size!==sealed.bytes||named.size!==sealed.bytes)throw deny();this.record(`ACTUAL_FILE_READY_${kind}`);return sealed;
    }catch(e){controller.abort();try{this.record(`ACTUAL_FILE_REVOKED_${kind}`);}catch{/*revoked*/}throw e;}finally{if(timer)clearTimeout(timer);if(monitor)clearInterval(monitor);if(fd!==undefined)closeSync(fd);}
  }
  private async seal(kind:Fact['kind'],path:string,mime:string,duration?:number){
    const absolute=this.regular(path),data=readFileSync(absolute),before=hash(data);
    if(kind==='audio'||kind==='extract'){if(audioFormat(data)!==(kind==='audio'?'mp3':'wav'))throw deny();}else if(mime==='audio/mpeg'){if(data.length<4||!(data.toString('ascii',0,3)==='ID3'||data[0]===255&&(data[1]!&224)===224))throw deny();}else if(data.length<12||data.toString('ascii',4,8)!=='ftyp')throw deny();
    const probe=await this.tools.probe(absolute);
    if(kind==='input'&&!probe.hasAudio)throw new AppError(422,'MEDIA_AUDIO_REQUIRED','Tệp nguồn phải có luồng âm thanh.');
    if(!probe.hasAudio||!Number.isFinite(probe.duration)||probe.duration<=0||probe.duration>3600||probe.fileSize!==data.length||duration!==undefined&&Math.abs(probe.duration-duration)>0.5||kind==='video'&&(!probe.hasVideo||probe.videoCodec!=='h264'||probe.audioCodec!=='aac'))throw deny();
    if(hash(readFileSync(this.regular(path)))!==before)throw deny();const fact:Fact={kind,path:absolute,bytes:data.length,sha256:before,mime,probe};this.files.set(absolute,fact);return fact;
  }
}

export function productionActualTools():ActualTools{
  return{
    async validateInput(path){await command(resolveMediaExecutable('ffmpeg'),['-nostdin','-v','error','-xerror','-i',path,'-map','0:a:0','-map','0:v:0?','-f','null','-'],undefined,undefined,false,300000);},
    async verifyAudio(path){const text=await command(resolveMediaExecutable('ffmpeg'),['-nostdin','-v','info','-xerror','-i',path,'-map','0:a:0','-vn','-af','astats=measure_perchannel=none:measure_overall=Peak_level','-f','null','-'],undefined,undefined,true);const peak=/Peak level dB:\s*(-?\d+(?:\.\d+)?|-inf)/.exec(text)?.[1];return Boolean(peak&&Number.isFinite(Number(peak)));},
    convert(wav,signal){return new Promise((resolvePromise,reject)=>{
      if(signal.aborted){reject(deny());return;}const child=spawn(resolveMediaExecutable('ffmpeg'),['-nostdin','-hide_banner','-loglevel','error','-i','pipe:0','-c:a','libmp3lame','-b:a','128k','-f','mp3','pipe:1'],{shell:false,windowsHide:true});let size=0,settled=false;const parts:Buffer[]=[];
      const abort=()=>finish(deny()),finish=(error?:Error)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);if(error){child.kill('SIGKILL');reject(error);}else resolvePromise(Buffer.concat(parts));};
      signal.addEventListener('abort',abort,{once:true});child.stdout.on('data',(v:Buffer)=>{size+=v.length;if(size>32*1024*1024)finish(deny());else parts.push(v);});child.stderr.resume();child.stdin.on('error',()=>finish(deny()));child.on('error',()=>finish(deny()));child.on('close',c=>finish(c===0?undefined:deny()));child.stdin.end(wav);if(signal.aborted)abort();
    });},
    async probe(path){
      const text=await command(resolveMediaExecutable('ffprobe'),['-v','error','-show_entries','format=duration,format_name,size:stream=codec_type,codec_name,width,height:stream_disposition=attached_pic','-of','json',path]);
      const value=JSON.parse(text),video=value.streams?.find((s:Data)=>s.codec_type==='video'&&(s.disposition as Data|undefined)?.attached_pic!==1),audio=value.streams?.find((s:Data)=>s.codec_type==='audio');
      return{duration:Number(value.format?.duration),fileSize:Number(value.format?.size),format:String(value.format?.format_name??''),hasVideo:!!video,hasAudio:!!audio,videoCodec:video?.codec_name,audioCodec:audio?.codec_name,width:video?.width,height:video?.height};
    },
    async encode(kind,fd,source,audio,duration,signal){
      const args=kind==='extract'?['-nostdin','-i',source,'-map','0:a:0','-vn','-c:a','pcm_s16le','-f','wav','pipe:3']:['-nostdin','-i',source,'-i',audio!,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-c:a','aac','-af','apad','-t',String(duration),'-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:3'];
      await command(resolveMediaExecutable('ffmpeg'),args,fd,signal);
    },
  };
}
function command(binary:string,args:string[],fd?:number,signal?:AbortSignal,diagnostics=false,deadlineMs?:number):Promise<string>{
  return new Promise((resolvePromise,reject)=>{
    if(signal?.aborted){reject(deny());return;}const child=spawn(binary,args,{shell:false,windowsHide:true,stdio:fd===undefined?['ignore','pipe','pipe']:['ignore','pipe','pipe',fd]});let output='',settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){child.kill('SIGKILL');reject(error);}else resolvePromise(output);};
    const abort=()=>finish(new Error('MEDIA_PROCESSING_TIMEOUT')),timer=setTimeout(abort,deadlineMs??(fd===undefined?15000:300000));signal?.addEventListener('abort',abort,{once:true});
    child.stdout!.on('data',(v:Buffer)=>{if(!diagnostics){output+=v.toString();if(output.length>65536)finish(new Error('MEDIA_PROCESSING_INVALID_OUTPUT'));}});child.stderr!.on('data',(v:Buffer)=>{if(diagnostics)output=(output+v.toString()).slice(-65536);});child.on('error',(e:NodeJS.ErrnoException)=>finish(new Error(e.code==='ENOENT'?'FFMPEG_NOT_AVAILABLE':'MEDIA_PROCESSING_FAILED')));child.on('close',code=>finish(code===0?undefined:new Error('MEDIA_PROCESSING_FAILED')));if(signal?.aborted)abort();
  });
}
