import test from 'node:test';
import assert from 'node:assert/strict';
import { mapGeminiTranscript, GeminiSttError } from '../src/services/stt/gemini-stt.provider.js';
import { normalizeTimeline } from '../src/services/stt/normalize-timeline.js';
const response=(times:readonly(readonly[number,number])[])=>({status:'completed',output_text:times.map((_,i)=>`word${i}`).join(' '),steps:[{type:'model_output',content:[{type:'text',annotations:times.map(([s,e],i)=>({type:'word_info',text:`word${i}`,start_offset:s+'s',end_offset:e+'s'}))}]}]});

test('evidence-based regression index51 at13.300s normalizes with synthetic nearby anchors, not a replay of unsaved response',()=>{
  const times:Array<[number,number]>=Array.from({length:50},(_,i)=>[i/4,(i+1)/4]);times.push([12.5,13.28],[13.3,13.3],[13.31,13.6]);
  const value=response(times),before=JSON.stringify(value),mapped=mapGeminiTranscript(value,53.591655);
  assert.equal(mapped.text,value.output_text);assert.equal(mapped.segments.map(s=>s.text).join(' '),value.output_text);
  assert.equal(mapped.segments[50]!.end,13.3);assert.equal(mapped.segments[50]!.text,'word50 word51');
  assert.equal(mapped.timelineDiagnostic?.pointWords,1);assert.equal(mapped.timelineDiagnostic?.maxAdjustmentMs,20);assert.equal(JSON.stringify(value),before);
});
for(const [name,times]of Object.entries({touching:[[0,1],[1,1],[1,2]],leading:[[0,0],[0.03,1]],trailing:[[0,1],[1.03,1.03]],duplicates:[[0,1],[0,1],[1,2]],points:[[0,1],[1.02,1.02],[1.02,1.02],[1.03,2]],overlap:[[0,1],[0.98,2]]}as const))test(`bounded normalization preserves words: ${name}`,()=>{
  const value=response(times),mapped=mapGeminiTranscript(value,3);assert.equal(mapped.text,value.output_text);assert.equal(mapped.segments.map(s=>s.text).join(' '),value.output_text);
  for(let i=0;i<mapped.segments.length;i++){const s=mapped.segments[i]!;assert.ok(s.end>s.start&&s.start>=0&&s.end<=3);if(i)assert.ok(s.start>=mapped.segments[i-1]!.end);}
  assert.ok(mapped.timelineDiagnostic!.maxAdjustmentMs<=50);
});
for(const [name,times]of Object.entries({isolated:[[0,1],[13.3,13.3]],overlap:[[0,1],[0.8,2]],negative:[[-0.01,1]],beyond:[[0,4]],reverse:[[1,0.99]],allPoints:[[1,1],[1,1]],chainedDrift:[[0,1],[1.04,1.04],[1.08,1.08]]}as const))test(`unsafe timing rejected: ${name}`,()=>assert.throws(()=>mapGeminiTranscript(response(times),3),e=>e instanceof GeminiSttError&&e.code==='STT_INVALID_RESPONSE'));
test('normalization never crosses separate provider content or explicit segment boundary',()=>{
  assert.throws(()=>normalizeTimeline([{start:0,end:1,text:'a',wordIndex:0,boundary:0},{start:1.02,end:1.02,text:'b',wordIndex:1,boundary:1}],2));
  assert.throws(()=>normalizeTimeline([{start:0,end:1.01,text:'a',wordIndex:0,boundary:0,max:1}],2));
  assert.throws(()=>normalizeTimeline([{start:0,end:1,text:'a',wordIndex:0,boundary:0,max:1},{start:1.02,end:1.02,text:'b',wordIndex:1,boundary:0}],2));
  assert.throws(()=>normalizeTimeline([{start:0.98,end:0.98,text:'a',wordIndex:0,boundary:0},{start:1,end:2,text:'b',wordIndex:1,boundary:0,min:1}],2));
});
