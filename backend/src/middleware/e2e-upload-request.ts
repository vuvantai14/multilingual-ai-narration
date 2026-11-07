import type { RequestHandler } from 'express';
import { e2eRunEnabled } from '../services/e2e-test-run.js';
import { guardedActualWriter } from '../services/e2e-runtime-boundary.js';

/** Keeps one registry lease across Multer AND Media service persistence. */
export const e2eUploadRequest:RequestHandler=(request,response,next)=>{
  if(!e2eRunEnabled()){next();return;}
  const end=response.end;let captured:unknown[]|undefined;
  let detach=()=>{};
  const restore=()=>{response.end=end;detach();};
  const send=()=>{if(captured&&!response.destroyed)Reflect.apply(end,response,captured);};
  void guardedActualWriter({projectId:request.ownedProjectId??'',ownerId:request.user?.id??''},()=>new Promise<void>((resolve,reject)=>{
    const close=()=>reject(Error('S32_E2E_UPLOAD_REQUEST_DENIED'));
    response.once('close',close);detach=()=>response.removeListener('close',close);
    // This route returns JSON, never a streaming response. Hold its final end
    // until native readback, audits and stage attestation have all succeeded.
    response.end=((...args:unknown[])=>{if(captured)reject(Error('S32_E2E_UPLOAD_REQUEST_DENIED'));else{captured=args;if(response.statusCode<400)resolve();else reject(Error('S32_E2E_UPLOAD_REQUEST_DENIED'));}return response;}) as typeof response.end;
    next();
  }),'Media').then(()=>{restore();send();},error=>{restore();if(captured&&response.statusCode>=400)send();else if(!response.headersSent&&!response.destroyed)next(error);});
};
