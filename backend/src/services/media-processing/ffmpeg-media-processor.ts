import { resolveMediaExecutable } from './media-executable.js';
import { spawn } from 'node:child_process';
import { denyUnscopedTestStorage, preparedRender, actualAssets } from '../e2e-runtime-boundary.js';
import { e2eRunEnabled } from '../e2e-test-run.js';
import type { E2eStorage } from '../e2e-storage.js';
import { stat } from 'node:fs/promises';
import type { ComposeNarrationInput, MediaProcessingResult, MediaProcessor, MediaProbeResult } from './media-processor.interface.js';
import { MediaProcessingError, sanitizeProcessingStderr, type ProcessingStage } from './processing-diagnostics.js';

const MAX_STDERR = 16_384;
const timeoutMs = () => { const value = Number(process.env.FFMPEG_TIMEOUT_MS ?? 300_000); return Number.isFinite(value) && value > 0 ? value : 300_000; };

export const runMediaCommand = (binary: string, args: string[], stage: ProcessingStage): Promise<{ stdout: string; stderr: string }> => new Promise((resolve, reject) => {
  if(e2eRunEnabled() && stage==='RENDER'){preparedRender(binary,args,stage).then(resolve,reject);return;}
  denyUnscopedTestStorage();
  const started = Date.now();
  const child = spawn(binary, args, { shell: false, windowsHide: true }); let stdout = ''; let stderr = ''; let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs());
  child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-MAX_STDERR); });
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-MAX_STDERR); });
  child.on('error', (error: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new MediaProcessingError({ stage, code: error.code === 'ENOENT' ? 'FFMPEG_NOT_AVAILABLE' : 'MEDIA_PROCESSING_FAILED', durationMs: Date.now() - started, systemCode: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : undefined })); });
  child.on('close', (code, signal) => { clearTimeout(timer); if (timedOut || code !== 0) reject(new MediaProcessingError({ stage, code: timedOut ? 'MEDIA_PROCESSING_TIMEOUT' : 'MEDIA_PROCESSING_FAILED', exitCode: code, signal, durationMs: Date.now() - started, stderr: sanitizeProcessingStderr(stderr, [binary, ...args.filter(arg => arg.includes('/') || arg.includes('\\'))]) })); else resolve({ stdout, stderr }); });
});

export type RenderLeasePlan = { sourcePath:string; narrationPath:string; outputPath:string; duration:number; key:string };
/** Same renderer's controlled output branch. File is opened exclusively by the
 * storage lease BEFORE spawn; FFmpeg receives an inherited regular-file fd.
 * Fragmented MP4 is required for the non-seekable pipe protocol, not faststart. */
export async function runLeasedRender(binary:string,args:string[],stage:string,plan:RenderLeasePlan,storage:E2eStorage,validate:(path:string,bytes:Buffer)=>Promise<boolean>,spawnProcess:typeof spawn=spawn):Promise<{stdout:string;stderr:string}> {
  const {resolve,relative,isAbsolute,sep}=await import('node:path');
  const {lstat,realpath}=await import('node:fs/promises');
  if(stage!=='RENDER' || binary!==resolveMediaExecutable('ffmpeg') || !Number.isFinite(plan.duration) || plan.duration<=0 || plan.duration>3600)throw Error('S32_RENDER_LEASE_DENIED');
  for(const path of [plan.sourcePath,plan.narrationPath,plan.outputPath]){const rel=relative(storage.directory,resolve(path));if(!rel || isAbsolute(rel) || rel==='..' || rel.startsWith(`..${sep}`))throw Error('S32_RENDER_LEASE_DENIED');}
  for(const path of [plan.sourcePath,plan.narrationPath]){const info=await lstat(path);if(!info.isFile() || info.isSymbolicLink() || await realpath(path)!==resolve(path))throw Error('S32_RENDER_LEASE_DENIED');}
  const expected=['-nostdin','-y','-i',plan.sourcePath,'-i',plan.narrationPath,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-c:a','aac','-af','apad','-t',String(plan.duration),'-movflags','+faststart',plan.outputPath];
  if(JSON.stringify(args)!==JSON.stringify(expected))throw Error('S32_RENDER_LEASE_DENIED');
  const output=await storage.output(plan.key,(fd,signal)=>new Promise<{stdout:string;stderr:string}>((resolvePromise,reject)=>{
    // No path write argument and no shell; no overwrite flag.
    const secure=expected.slice(0,-3).filter(arg=>arg!=='-y');secure.push('-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:3');
    let child:ReturnType<typeof spawn>;
    try{child=spawnProcess(binary,secure,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe',fd]});}catch{reject(Error('S32_RENDER_FAILED'));return;}
    let stdout='',stderr='',settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);if(error){child.kill('SIGKILL');reject(error);}else resolvePromise({stdout,stderr});};
    const abort=()=>finish(Error('S32_RENDER_TIMEOUT'));
    signal.addEventListener('abort',abort,{once:true});
    child.stdout!.on('data',(data:Buffer)=>{stdout=(stdout+data.toString()).slice(-16384);});
    child.stderr!.on('data',(data:Buffer)=>{stderr=(stderr+data.toString()).slice(-16384);});
    child.on('error',()=>finish(Error('S32_RENDER_FAILED')));child.on('close',code=>finish(code===0?undefined:Error('S32_RENDER_FAILED')));
    if(signal.aborted)abort();
  }),validate,undefined,plan.outputPath);
  return output.result;
}

export class FfmpegMediaProcessor implements MediaProcessor {
  constructor(private readonly command: typeof runMediaCommand = runMediaCommand) {}
  public async probe(inputPath: string, stage: ProcessingStage = 'PROBE'): Promise<MediaProbeResult> {
    if(e2eRunEnabled())return actualAssets().probe(inputPath);
    const { stdout } = await this.command(resolveMediaExecutable('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration,format_name,size', '-show_entries', 'stream=codec_type,codec_name,width,height:stream_disposition=attached_pic', '-of', 'json', inputPath], stage);
    try {
      const value = JSON.parse(stdout) as { format?: { duration?: string; format_name?: string; size?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; disposition?: { attached_pic?: number } }> };
      const duration = Number(value.format?.duration); const fileSize = Number(value.format?.size); const video = value.streams?.find((item) => item.codec_type === 'video' && item.disposition?.attached_pic !== 1);
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fileSize) || fileSize <= 0) throw new Error();
      const audio = value.streams?.find(item => item.codec_type === 'audio');
      return { duration, format: value.format?.format_name ?? '', fileSize, hasVideo: Boolean(video), hasAudio: Boolean(audio), width: video?.width, height: video?.height, videoCodec: video?.codec_name, audioCodec: audio?.codec_name };
    } catch { throw new MediaProcessingError({ stage, code: 'MEDIA_PROCESSING_INVALID_OUTPUT', durationMs: 0 }); }
  }

  public async verifyInput(inputPath: string): Promise<void> {
    // Decode to the null sink; never modify or normalize the uploaded original.
    // The opt-in run uses its independently hash/probe-attested input instead.
    if (e2eRunEnabled()) { await actualAssets().probe(inputPath); return; }
    await this.command(resolveMediaExecutable('ffmpeg'), ['-nostdin', '-v', 'error', '-xerror', '-i', inputPath, '-map', '0:a:0', '-map', '0:v:0?', '-f', 'null', '-'], 'VALIDATE_INPUT');
  }

  public async verifyNarrationAudio(inputPath: string): Promise<void> {
    if (e2eRunEnabled()) { await actualAssets().verifyNarrationAudio(inputPath); return; }
    const { stderr } = await this.command(resolveMediaExecutable('ffmpeg'), ['-nostdin', '-v', 'info', '-xerror', '-i', inputPath, '-map', '0:a:0', '-vn', '-af', 'astats=measure_perchannel=none:measure_overall=Peak_level', '-f', 'null', '-'], 'VALIDATE_OUTPUT');
    const peak = /Peak level dB:\s*(-?\d+(?:\.\d+)?|-inf)/.exec(stderr)?.[1];
    // Acoustic activity is necessary, not proof of spoken text accuracy.
    if (!peak || !Number.isFinite(Number(peak))) throw new MediaProcessingError({ stage: 'VALIDATE_OUTPUT', code: 'TTS_INVALID_RESPONSE', durationMs: 0 });
  }

  public async composeNarration(input: ComposeNarrationInput): Promise<MediaProcessingResult> {
    if(e2eRunEnabled())return actualAssets().render(input.sourceVideoPath,input.narrationAudioPath,input.outputPath);
    const source = await this.probe(input.sourceVideoPath, 'PROBE_SOURCE'); const narration = await this.probe(input.narrationAudioPath, 'PROBE_NARRATION');
    if (!source.hasVideo || !narration.hasAudio) throw new MediaProcessingError({ stage: 'VALIDATE_INPUT', code: 'MEDIA_PROCESSING_INVALID_OUTPUT', durationMs: 0 });
    await this.command(resolveMediaExecutable('ffmpeg'), ['-nostdin', '-y', '-i', input.sourceVideoPath, '-i', input.narrationAudioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-af', 'apad', '-t', String(source.duration), '-movflags', '+faststart', input.outputPath], 'RENDER');
    const output = await this.probe(input.outputPath, 'PROBE_OUTPUT');
    let size = 0; try { size = (await stat(input.outputPath)).size; } catch { /* Fail validation below. */ }
    if (!output.hasVideo || !output.hasAudio || output.videoCodec !== 'h264' || output.audioCodec !== 'aac' || !output.format.split(',').includes('mp4') || !Number.isFinite(output.duration) || Math.abs(output.duration-source.duration)>0.5 || size <= 0) throw new MediaProcessingError({ stage: 'VALIDATE_OUTPUT', code: 'MEDIA_PROCESSING_INVALID_OUTPUT', durationMs: 0 });
    return { ...output, fileSize: size, mimeType: 'video/mp4' };
  }
}
