import mongoose from 'mongoose';
import { cloneData, type Data, type ActualSession } from '../../src/services/e2e-actual-runtime.js';

type Store=Map<string,Map<string,Data>>;
const oid=(v:unknown)=>v instanceof mongoose.mongo.ObjectId?v.toHexString():v;
const get=(d:Data,k:string):unknown=>k.split('.').reduce((v,key)=>v&&typeof v==='object'?(v as Data)[key]:undefined,d as unknown);
const eq=(a:unknown,b:unknown)=>a==null&&b==null||String(oid(a))===String(oid(b));
export function matches(doc:Data,filter:Data):boolean{
  return Object.entries(filter).every(([key,value])=>{
    if(key==='$or')return(value as Data[]).some(f=>matches(doc,f));if(key==='$and')return(value as Data[]).every(f=>matches(doc,f));
    const actual=get(doc,key);
    if(value&&typeof value==='object'&&!(value instanceof mongoose.mongo.ObjectId)&&!(value instanceof Date))return Object.entries(value).every(([op,v])=>op==='$in'?(v as unknown[]).some(x=>eq(actual,x)):op==='$nin'?!(v as unknown[]).some(x=>eq(actual,x)):op==='$ne'?!eq(actual,v):op==='$lt'?Number(actual)<Number(v):op==='$lte'?Number(actual)<=Number(v):op==='$gt'?Number(actual)>Number(v):op==='$exists'?(actual!==undefined)===v:op==='$eq'?eq(actual,v):false);
    return eq(actual,value);
  });
}
function expression(v:unknown,doc:Data):unknown{
  if(v==='$$ROOT')return doc;if(typeof v==='string'&&v.startsWith('$'))return get(doc,v.slice(1));if(Array.isArray(v))return v.map(a=>expression(a,doc));
  if(v&&typeof v==='object'&&!(v instanceof mongoose.mongo.ObjectId)&&!(v instanceof Date)){
    const obj=v as Data,op=Object.keys(obj)[0]!;
    if(op==='$cond'){const[a,b,c]=obj[op] as unknown[];return expression(expression(a,doc)?b:c,doc);}
    const args=expression(obj[op],doc),list=Array.isArray(args)?args:[args];
    if(op==='$type')return typeof args==='string'?'string':args===undefined?'missing':typeof args;
    if(op==='$strLenBytes')return Buffer.byteLength(String(args));if(op==='$bsonSize')return mongoose.mongo.BSON.calculateObjectSize(args as Data);
    if(op==='$lte')return Number(list[0])<=Number(list[1]);if(op==='$eq')return eq(list[0],list[1]);if(op==='$ifNull')return list[0]??list[1];if(op==='$literal')return obj[op];
    if(op==='$sum')return list.reduce((n,x)=>Number(n)+Number(x),0);
    return Object.fromEntries(Object.entries(obj).map(([k,val])=>[k,expression(val,doc)]));
  }return v;
}
function project(doc:Data,projection?:Data):Data{
  if(!projection||!Object.keys(projection).length)return cloneData(doc);
  if(Object.values(projection).every(v=>v===0)){const result=cloneData(doc);for(const k of Object.keys(projection))delete result[k];return result;}
  const result:Data={};if(projection._id!==0&&doc._id!==undefined)result._id=doc._id;
  for(const[k,v]of Object.entries(projection)){if(v===1){if(get(doc,k)!==undefined)result[k]=get(doc,k);}else if(v!==0)result[k]=expression(v,doc);}return cloneData(result);
}
function update(doc:Data,value:Data,insert=false){
  for(const[op,fields]of Object.entries(value)){for(const[k,v]of Object.entries(fields as Data)){if(op==='$set'||op==='$setOnInsert'&&insert)doc[k]=cloneData(v);else if(op==='$unset')delete doc[k];else if(op==='$inc')doc[k]=Number(doc[k]??0)+Number(v);}}
}
class Cursor implements AsyncIterable<Data>{private offset=0;constructor(private readonly values:Data[]){}async toArray(){return cloneData(this.values);}async next(){return this.offset<this.values.length?cloneData(this.values[this.offset++]!):null;}async close(){}async *[Symbol.asyncIterator](){for(const v of this.values)yield cloneData(v);}}
export function memoryNative(){
  const store:Store=new Map(),calls:string[]=[];let commitUnknown=false,commitApplied=false;
  function collection(name:string,session?:MemorySession){const db=session?.active?session.data:store;if(!db.has(name))db.set(name,new Map());return db.get(name)!;}
  class MemorySession implements ActualSession{
    active=false;data:Store=new Map();serverSession={txnNumber:0};
    inTransaction(){return this.active;}
    startTransaction(){this.serverSession.txnNumber++;this.data=new Map([...store].map(([c,docs])=>[c,new Map([...docs].map(([k,v])=>[k,cloneData(v)]))]));this.active=true;}
    async commitTransaction(){calls.push('commit');if(commitUnknown&&!commitApplied)throw Error('UnknownTransactionCommitResult');store.clear();for(const[c,docs]of this.data)store.set(c,new Map([...docs].map(([k,v])=>[k,cloneData(v)])));this.active=false;if(commitUnknown)throw Error('UnknownTransactionCommitResult');}
    async abortTransaction(){calls.push('abort');this.active=false;}
    async withTransaction<T>(work:()=>Promise<T>){this.startTransaction();try{const result=await work();await this.commitTransaction();return result;}catch(e){await this.abortTransaction();throw e;}}
    async endSession(){}
  }
  class Collection{
    dbName='multilingual_ai_narration';constructor(public collectionName:string){}
    private selected(filter:Data,options:Data={}){let rows=[...collection(this.collectionName,options.session as MemorySession).values()].filter(d=>matches(d,filter));if(options.sort){for(const[k,direction]of Object.entries(options.sort as Data).reverse())rows.sort((a,b)=>String(get(a,k)).localeCompare(String(get(b,k)))*Number(direction));}if(options.skip)rows=rows.slice(Number(options.skip));if(options.limit)rows=rows.slice(0,Number(options.limit));return rows;}
    async findOne(filter:Data,options:Data={}){const d=this.selected(filter,options)[0];return d?project(d,options.projection as Data):null;}
    find(filter:Data={},options:Data={}){return new Cursor(this.selected(filter,options).map(d=>project(d,options.projection as Data)));}
    async countDocuments(filter:Data={},options:Data={}){return this.selected(filter,options).length;}
    async insertOne(doc:Data,options:Data={}){calls.push(this.collectionName+':insertOne');const rows=collection(this.collectionName,options.session as MemorySession),key=String(oid(doc._id));if(rows.has(key))throw Object.assign(Error('duplicate'),{code:11000});rows.set(key,cloneData(doc));return{acknowledged:true,insertedId:doc._id};}
    async insertMany(docs:Data[],options:Data={}){calls.push(this.collectionName+':insertMany');const rows=collection(this.collectionName,options.session as MemorySession);for(const d of docs){const key=String(oid(d._id));if(rows.has(key))throw Error('duplicate');rows.set(key,cloneData(d));}return{acknowledged:true,insertedCount:docs.length,insertedIds:Object.fromEntries(docs.map((d,i)=>[i,d._id]))};}
    async updateOne(filter:Data,value:Data,options:Data={}){calls.push(this.collectionName+':updateOne');const rows=collection(this.collectionName,options.session as MemorySession),before=this.selected(filter,options)[0];if(!before){if(!options.upsert)return{acknowledged:true,matchedCount:0,modifiedCount:0,upsertedCount:0};const doc=Object.fromEntries(Object.entries(filter).filter(([,v])=>v===null||typeof v!=='object'||v instanceof mongoose.mongo.ObjectId));if(rows.has(String(oid(doc._id))))throw Object.assign(Error('duplicate'),{code:11000});doc._id??=new mongoose.mongo.ObjectId();update(doc,value,true);rows.set(String(oid(doc._id)),cloneData(doc));return{acknowledged:true,matchedCount:0,modifiedCount:0,upsertedCount:1,upsertedId:doc._id};}update(before,value);return{acknowledged:true,matchedCount:1,modifiedCount:1,upsertedCount:0};}
    async findOneAndUpdate(filter:Data,value:Data,options:Data={}){calls.push(this.collectionName+':findOneAndUpdate');const rows=collection(this.collectionName,options.session as MemorySession);let before=this.selected(filter,options)[0];const old=before?cloneData(before):null;if(!before&&options.upsert){before=Object.fromEntries(Object.entries(filter).filter(([,v])=>v===null||typeof v!=='object'||v instanceof mongoose.mongo.ObjectId));before._id??=new mongoose.mongo.ObjectId();update(before,value,true);rows.set(String(oid(before._id)),cloneData(before));}else if(before)update(before,value);return options.returnDocument==='before'?old:before?cloneData(before):null;}
    async deleteMany(filter:Data,options:Data={}){calls.push('DESTRUCTIVE_DELETE');const rows=collection(this.collectionName,options.session as MemorySession);let n=0;for(const[k,d]of rows)if(matches(d,filter)){rows.delete(k);n++;}return{acknowledged:true,deletedCount:n};}
    async deleteOne(){calls.push('DESTRUCTIVE_DELETE');throw Error('not allowed');}
    async updateMany(){calls.push('BROAD_UPDATE');throw Error('not allowed');}
    async bulkWrite(){throw Error('not allowed');}
    aggregate(pipeline:Data[],options:Data={}){let rows=[...collection(this.collectionName,options.session as MemorySession).values()].map(cloneData);for(const stage of pipeline){if(stage.$match)rows=rows.filter(d=>matches(d,stage.$match as Data));else if(stage.$sort){for(const[k,v]of Object.entries(stage.$sort as Data).reverse())rows.sort((a,b)=>(Number(get(a,k))-Number(get(b,k)))*Number(v));}else if(stage.$limit)rows=rows.slice(0,Number(stage.$limit));else if(stage.$project)rows=rows.map(d=>project(d,stage.$project as Data));else throw Error('unsupported fixture aggregation '+Object.keys(stage)[0]);}return new Cursor(rows);}
  }
  class Db{command(){throw Error('raw command');}}class MongoClient{}
  return{driver:{Collection,Db,MongoClient},Collection,MemorySession,calls,
    seed:(c:string,d:Data)=>{collection(c).set(String(oid(d._id)),cloneData(d));},
    reads:{one:async(c:string,f:Data,s?:unknown)=>new Collection(c).findOne(f,{session:s}),many:async(c:string,f:Data,s?:unknown)=>new Collection(c).find(f,{session:s}).toArray()},
    collection:(c:string)=>new Collection(c),documents:(c:string)=>[...collection(c).values()].map(cloneData),
    commitUnknown:(v:boolean,applied=false)=>{commitUnknown=v;commitApplied=applied;},
  };
}
