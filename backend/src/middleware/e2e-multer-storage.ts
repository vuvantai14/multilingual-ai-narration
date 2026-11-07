import type { StorageEngine } from 'multer';
import { dirname, basename } from 'node:path';
import { e2eRunEnabled } from '../services/e2e-test-run.js';
import { currentPreparedBoundary } from '../services/e2e-runtime-boundary.js';
import { AppError } from '../utils/app-error.js';

/** Actual Multer adapter: ordinary diskStorage is untouched when OFF. */
export class E2eMulterStorage implements StorageEngine {
  constructor(private readonly ordinary: StorageEngine) {}
  _handleFile(...args: Parameters<StorageEngine['_handleFile']>): void {
    const [request,file,callback]=args;
    if (!e2eRunEnabled()) { this.ordinary._handleFile(...args); return; }
    void (async()=>{
      const runtime=currentPreparedBoundary({projectId:request.ownedProjectId ?? '',ownerId:request.user?.id ?? ''});
      const maxBytes=runtime.assets ? runtime.assets.expectedInputBytes() : runtime.input?.maxBytes;
      if (!Number.isSafeInteger(maxBytes) || !maxBytes || maxBytes<1 || maxBytes>200*1024*1024 || !['video/mp4','audio/mpeg','audio/mp3'].includes(file.mimetype)) throw Error('S32_E2E_UPLOAD_DENIED');
      const chunks:Buffer[]=[];let size=0,limited=false;
      file.stream.once('limit',()=>{limited=true;});
      for await(const raw of file.stream){const chunk=Buffer.from(raw);size+=chunk.length;if(size>maxBytes)throw Error('S32_E2E_UPLOAD_LIMIT');chunks.push(chunk);}
      if(limited)throw Error('S32_E2E_UPLOAD_LIMIT');
      const stored=runtime.assets ? await runtime.assets.upload(Buffer.concat(chunks),file) : runtime.input!.storage.write(runtime.input!.key,Buffer.concat(chunks));
      return{path:stored.path,destination:dirname(stored.path),filename:basename(stored.path),size:stored.bytes};
    })().then(info=>callback(null,info),error=>callback(error instanceof AppError?error:
      error instanceof Error&&error.message==='S32_E2E_UPLOAD_LIMIT'
        ?new AppError(413,'FILE_TOO_LARGE','Tệp vượt giới hạn dung lượng của run. Không tự tải lại.')
        :new AppError(409,'S32_E2E_UPLOAD_DENIED','Upload bị scoped guard chặn hoặc không thể xác minh tệp. Dừng kiểm thử, không tự tải lại.')));
  }
  _removeFile(...args:Parameters<StorageEngine['_removeFile']>):void {
    if (!e2eRunEnabled()){this.ordinary._removeFile(...args);return;}
    const[request,file,callback]=args;
    try{const runtime=currentPreparedBoundary({projectId:request.ownedProjectId??'',ownerId:request.user?.id??''});if(!runtime.assets)throw Error();runtime.assets.cleanup(file.path);callback(null);}catch{callback(Error('S32_E2E_CLEANUP_NOT_APPROVED'));}
  }
}
