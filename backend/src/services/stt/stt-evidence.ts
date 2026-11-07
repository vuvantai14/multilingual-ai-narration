export const STT_STAGES = ['LOCAL_VALIDATION','MEDIA_PROBE','MODEL_VALIDATION','AUDIO_EXTRACTION','AUDIO_PROBE','FILE_UPLOAD','FILE_POLL','TRANSCRIPTION','RESPONSE_VALIDATION'] as const;
export type SttStage = typeof STT_STAGES[number];
import type { TimelineDiagnostic } from './normalize-timeline.js';
export type SttEvidence = Readonly<{
  contract:'GEMINI_STT_EVIDENCE_V1';stage:SttStage;startedAt:string;stageStartedAt:string;observedAt:string;
  inferenceDispatchAt?:string;inferenceResponseAt?:string;httpStatus?:number;providerErrorCode?:string;requestId?:string;operationId?:string;
  inferenceState:'NOT_DISPATCHED'|'INVOKED'|'RESPONSE_RECEIVED';
  outcome:'IN_PROGRESS'|'FAILED_PRE_DISPATCH'|'UNCERTAIN'|'FAILED_RESPONSE'|'SUCCEEDED';
  providerAccepted:'YES'|'NO'|'UNKNOWN';retryAllowed:false;cleanupFailed:boolean;timeline?:TimelineDiagnostic;
}>;
const field=(value:unknown,key:string):unknown=>{
  try{if(!value||typeof value!=='object')return;const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value'in descriptor?descriptor.value:undefined;}catch{return;}
};
const status=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=200&&v<=599?v:undefined;
const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)&&!/AIza|^sk-|^eyJ|bearer|password|api.?key|secret/i.test(v)?v:undefined;
const codes=new Set(['UNAVAILABLE','UNKNOWN','INTERNAL','RESOURCE_EXHAUSTED','PERMISSION_DENIED','UNAUTHENTICATED','INVALID_ARGUMENT','NOT_FOUND','FAILED_PRECONDITION','DEADLINE_EXCEEDED','CANCELLED','ABORTED','OUT_OF_RANGE','UNIMPLEMENTED','DATA_LOSS','ALREADY_EXISTS']);
const code=(v:unknown)=>typeof v==='string'&&codes.has(v)?v:typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=599?String(v):undefined;
function header(headers:unknown,name:string):unknown {
  try{if(headers instanceof Headers)return headers.get(name);return field(headers,name);}catch{return;}
}
/** Pick scalar allowlisted SDK metadata only. Never log messages, response body,
 * URLs, all headers, continuation tokens, media names or transcript contents. */
export function safeSttMetadata(error:unknown):Pick<SttEvidence,'httpStatus'|'providerErrorCode'|'requestId'|'operationId'> {
  let body=field(error,'error');const message=field(error,'message');
  if(!body&&typeof message==='string'&&message.length<=16384&&message.trimStart().startsWith('{')){try{body=JSON.parse(message);}catch{/*not a structured SDK error*/}}
  const nested=field(body,'error')??body,headers=field(error,'headers');
  const httpStatus=status(field(error,'status'))??status(field(error,'statusCode'))??status(field(error,'code'))??status(field(nested,'code'));
  const providerErrorCode=code(field(nested,'status'))??code(field(nested,'code'))??code(field(error,'providerErrorCode'));
  const requestId=id(header(headers,'x-request-id'))??id(header(headers,'x-goog-request-id'))??id(field(error,'requestId'));
  const operationId=id(field(error,'operationId'))??id(field(error,'id'));
  return{...(httpStatus!==undefined?{httpStatus}:{}),...(providerErrorCode?{providerErrorCode}:{}),...(requestId?{requestId}:{}),...(operationId?{operationId}:{})};
}
export class SttTrace {
  private value:SttEvidence;
  constructor(private readonly clock:()=>Date=()=>new Date()){
    const at=this.at();this.value={contract:'GEMINI_STT_EVIDENCE_V1',stage:'LOCAL_VALIDATION',startedAt:at,stageStartedAt:at,observedAt:at,
      inferenceState:'NOT_DISPATCHED',outcome:'IN_PROGRESS',providerAccepted:'NO',retryAllowed:false,cleanupFailed:false};
  }
  private at(){return this.clock().toISOString();}
  enter(stage:SttStage){const at=this.at();this.value={...this.value,stage,stageStartedAt:at,observedAt:at};return this.snapshot();}
  dispatch(){const at=this.at();this.value={...this.value,stage:'TRANSCRIPTION',stageStartedAt:at,observedAt:at,inferenceDispatchAt:at,
    inferenceState:'INVOKED',providerAccepted:'UNKNOWN'};return this.snapshot();}
  response(value:unknown,metadata?:unknown){
    const at=this.at(),accepted=field(value,'status');this.value={...this.value,...safeSttMetadata(metadata),
      ...(id(field(value,'id'))?{operationId:id(field(value,'id'))}:{}),observedAt:at,inferenceResponseAt:at,
      inferenceState:'RESPONSE_RECEIVED',providerAccepted:['completed','in_progress'].includes(String(accepted))?'YES':'UNKNOWN'};return this.snapshot();
  }
  fail(error:unknown){
    const metadata=safeSttMetadata(error),at=this.at(),received=!!this.value.inferenceResponseAt;
    this.value={...this.value,...metadata,observedAt:at,
      ...(this.value.stage==='TRANSCRIPTION'&&metadata.httpStatus!==undefined?{inferenceResponseAt:at,inferenceState:'RESPONSE_RECEIVED' as const}:{}),
      outcome:!this.value.inferenceDispatchAt?'FAILED_PRE_DISPATCH':received&&this.value.providerAccepted==='YES'?'FAILED_RESPONSE':'UNCERTAIN'};
    return this.snapshot();
  }
  success(){this.value={...this.value,observedAt:this.at(),outcome:'SUCCEEDED',providerAccepted:'YES'};return this.snapshot();}
  normalized(timeline:TimelineDiagnostic){this.value={...this.value,timeline:Object.freeze({...timeline})};}
  cleanupFailed(){this.value={...this.value,cleanupFailed:true,observedAt:this.at()};return this.snapshot();}
  snapshot():SttEvidence{return Object.freeze({...this.value});}
}
