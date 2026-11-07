import mongoose from 'mongoose';
import { readFileSync,lstatSync,realpathSync,mkdirSync } from 'node:fs';
import { resolve,relative,isAbsolute,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareActualRun,type ActualManifest,type ActualPreparation } from './services/e2e-actual-runtime.js';
import { productionActualTools } from './services/e2e-actual-storage.js';
import { existingAuthSessionPolicy } from './services/e2e-auth-policy.js';
import { MANUAL_RUN_CONTRACT } from './services/e2e-manual-policy.js';

/** Explicit Node preload, never imported by npm dev. OFF performs no I/O/patch.
 * Future invocation requires separate runtime/write/provider authorization. */
export async function preloadActualE2e():Promise<void>{
  if(process.env.S32_E2E_TEST_RUN_ENABLED!=='true')return;
  const {default:dotenv}=await import('dotenv');dotenv.config({quiet:true});
  const workspace=resolve(fileURLToPath(new URL('../../',import.meta.url))),backend=resolve(workspace,'backend');
  const fail=()=>new Error('S32_E2E_PRELOAD_INVALID');
  const path=resolve(process.env.S32_E2E_MANIFEST_PATH??''),rel=relative(workspace,path);
  if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`)||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>128*1024||realpathSync(path)!==path)throw fail();
  const json=readFileSync(path,'utf8');let manifest:ActualManifest;try{manifest=JSON.parse(json);}catch{throw fail();}
  const manual=manifest.contract===MANUAL_RUN_CONTRACT;
  if(process.env.CUSTOMER_TRANSLATION_ENABLED!=='true'||process.env.CUSTOMER_TRANSLATION_METHOD!=='GEMINI_SIMPLE_V1'||(process.env.CUSTOMER_TRANSLATION_THINKING??'DEFAULT')!=='DEFAULT'||process.env.CONTROLLED_PROVIDER_MODE||['STT_PROVIDER','TRANSLATION_PROVIDER','TTS_PROVIDER'].some(k=>process.env[k]!=='gemini')||manifest.runId!==process.env.S32_E2E_RUN_ID||manifest.projectId!==process.env.S32_E2E_PROJECT_ID||manifest.ownerId!==process.env.S32_E2E_OWNER_ID||(manual?manifest.media!==undefined:manifest.media?.duration!==53.591655||manifest.media?.bytes!==4239951||manifest.media?.sha256!=='8e37f21fce16be8bf735b7efe22296309582f6cc7529a4aa5aae0d46f86dd1d3'))throw fail();
  process.env.S33_MANUAL_RUN=String(manual);
  mongoose.set('autoCreate',false);mongoose.set('autoIndex',false);
  const uri=process.env.MONGODB_URI;if(!uri)throw fail();const reader=new mongoose.mongo.MongoClient(uri,{serverSelectionTimeoutMS:5000});let connection:Promise<unknown>|undefined,main=false;
  const db=async()=>{if(main){const value=mongoose.connection.db;if(!value||value.databaseName!=='multilingual_ai_narration')throw fail();return value;}await(connection??=reader.connect());const value=reader.db();if(value.databaseName!=='multilingual_ai_narration')throw fail();return value;};
  const journals=resolve(backend,'.e2e-control');mkdirSync(journals,{recursive:true});
  try{
    await prepareActualRun({manifest:json,driver:mongoose.mongo as unknown as ActualPreparation['driver'],reads:{one:async(c,f,s,majority)=>(await db()).collection(c).findOne(f,{...(s?{session:s as mongoose.mongo.ClientSession}:{}),...(majority?{readConcern:{level:'majority'}}:{})}),many:async(c,f,s)=>(await db()).collection(c).find(f,s?{session:s as mongoose.mongo.ClientSession}:{}).toArray()},journal:resolve(journals,`${manifest.runId}.native.jsonl`),workspace,uploadRoot:resolve(backend,process.env.UPLOAD_DIR??'uploads'),tools:productionActualTools(),authAllowed:existingAuthSessionPolicy,
      connect:async()=>{await reader.close();await mongoose.connect(uri,{serverSelectionTimeoutMS:5000,autoCreate:false,autoIndex:false});main=true;},
    },true);
  }catch{await reader.close();throw fail();}
}
await preloadActualE2e();
