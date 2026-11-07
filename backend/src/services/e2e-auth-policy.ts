import mongoose from 'mongoose';
/** Same narrow authsessions lifecycle predicate as the existing read-only
 * preload, extracted here for a FUTURE composed process. No patch on import. */
export function existingAuthSessionPolicy(collection:{dbName?:string;collectionName?:string},method:string,args:readonly unknown[]):boolean{
  if(collection.dbName!=='multilingual_ai_narration'||collection.collectionName!=='authsessions')return false;
  const [first,second,third]=args as [Record<string,unknown>|undefined,Record<string,unknown>|undefined,Record<string,unknown>|undefined];
  const oid=(v:unknown)=>v instanceof mongoose.mongo.ObjectId;
  if(method==='insertOne')return process.env.S32_ALLOW_AUTH_SESSION_INSERT==='true'&&!!first&&Object.keys(first).every(k=>['_id','userId','tokenHash','expiresAt','revokedAt','createdAt','updatedAt','__v'].includes(k))&&oid(first._id)&&oid(first.userId)&&typeof first.tokenHash==='string'&&/^[a-f0-9]{64}$/.test(first.tokenHash)&&first.expiresAt instanceof Date&&first.expiresAt.getTime()>Date.now()&&first.revokedAt==null;
  if(process.env.S32_ALLOW_AUTH_SESSION_LIFECYCLE!=='true'||!first||!oid(first._id)||!oid(first.userId)||typeof first.tokenHash!=='string'||!/^[a-f0-9]{64}$/.test(first.tokenHash)||third?.upsert)return false;
  if(method==='findOneAndUpdate'){
    const expires=first.expiresAt as Record<string,unknown>|undefined,set=second?.$set as Record<string,unknown>|undefined;
    return Object.keys(first).every(k=>['_id','userId','tokenHash','revokedAt','expiresAt'].includes(k))&&Object.hasOwn(first,'revokedAt')&&first.revokedAt===null&&(!expires||Object.keys(expires).length===1&&expires.$gt instanceof Date)&&!!second&&Object.keys(second).length===1&&!!set&&Object.keys(set).every(k=>['revokedAt','updatedAt'].includes(k))&&set.revokedAt instanceof Date&&(!set.updatedAt||set.updatedAt instanceof Date);
  }
  const expires=first.expiresAt as Record<string,unknown>|undefined;
  return method==='deleteOne'&&Object.keys(first).every(k=>['_id','userId','tokenHash','expiresAt'].includes(k))&&!!expires&&Object.keys(expires).length===1&&expires.$lte instanceof Date&&expires.$lte.getTime()<=Date.now();
}
