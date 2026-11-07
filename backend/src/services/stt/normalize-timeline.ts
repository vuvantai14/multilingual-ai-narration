import type { SttSegment } from './stt-provider.interface.js';

// Application tolerance, not a claim about provider accuracy. Never allocate
// epsilon-sized words: merge into a real adjacent interval or reject.
export const STT_ROUNDING_SECONDS = 0.05;
export type TimelineWord = { start:number;end:number;text:string;wordIndex:number;boundary:number;min?:number;max?:number };
export type TimelineDiagnostic = Readonly<{ policy:'BOUNDED_TIMELINE_V1';toleranceMs:50;pointWords:number;duplicateIntervals:number;overlaps:number;maxAdjustmentMs:number }>;
export class TimelineError extends Error {
  constructor(readonly code:'TIMESTAMP_INTERVAL_INVALID'|'TIMESTAMP_OVERLAP_OR_ORDER'|'TIMESTAMP_BEYOND_DURATION',readonly wordIndex:number){super(code);}
}
type Span = TimelineWord & { tokens:string[];anchorEnd:number };
const near=(a:number,b:number)=>Math.abs(a-b)<=STT_ROUNDING_SECONDS+1e-9;

export function normalizeTimeline(words:readonly TimelineWord[],duration:number):{segments:SttSegment[];diagnostic:TimelineDiagnostic}{
  const spans:Span[]=[],out:Span[]=[];
  let pointWords=0,duplicateIntervals=0,overlaps=0,maxAdjustment=0;
  for(const w of words){
    if(!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.start<(w.min??0)||w.end>Math.min(duration,w.max??duration))throw new TimelineError('TIMESTAMP_BEYOND_DURATION',w.wordIndex);
    if(w.end<w.start)throw new TimelineError('TIMESTAMP_INTERVAL_INVALID',w.wordIndex);
    if(w.start===w.end)pointWords++;
    const previous=spans.at(-1);
    // Several words can share one provider interval; preserve all text/order in
    // one segment rather than pretending they each have distinct timings.
    if(previous&&previous.boundary===w.boundary&&previous.start===w.start&&previous.end===w.end){previous.tokens.push(w.text);duplicateIntervals++;}
    else spans.push({...w,tokens:[w.text],anchorEnd:w.end});
  }
  for(let i=0;i<spans.length;i++){
    const current=spans[i]!,previous=out.at(-1),next=spans[i+1];
    if(current.start===current.end){
      const t=current.start;
      // Same content boundary only; prefer the preceding real interval. A
      // <=50ms edge extension must still fit before the next interval.
      if(previous&&previous.boundary===current.boundary&&t>=previous.start&&
          Math.max(previous.end,t)<=Math.min(duration,previous.max??duration)&&
          (t<=previous.end||near(t,previous.anchorEnd))&&(!next||next.boundary!==current.boundary||Math.max(previous.end,t)<=next.start)){
        maxAdjustment=Math.max(maxAdjustment,Math.max(0,t-previous.anchorEnd));previous.end=Math.max(previous.end,t);previous.tokens.push(...current.tokens);continue;
      }
      if(next&&next.boundary===current.boundary&&next.end>next.start&&t<=next.start&&t>=(next.min??0)&&near(t,next.start)&&(!previous||t>=previous.end)){
        maxAdjustment=Math.max(maxAdjustment,next.start-t);next.start=t;next.tokens.unshift(...current.tokens);continue;
      }
      throw new TimelineError('TIMESTAMP_INTERVAL_INVALID',current.wordIndex);
    }
    if(previous&&current.start<previous.end){
      const overlap=previous.end-current.start;
      // Do not bridge content/segment boundaries or hide reversed/nested words.
      if(previous.boundary!==current.boundary||!near(previous.end,current.start)||current.end<=previous.end||current.start<previous.start)throw new TimelineError('TIMESTAMP_OVERLAP_OR_ORDER',current.wordIndex);
      current.start=previous.end;overlaps++;maxAdjustment=Math.max(maxAdjustment,overlap);
    }
    if(current.end<=current.start||current.start<(current.min??0)||current.end>Math.min(duration,current.max??duration))throw new TimelineError('TIMESTAMP_INTERVAL_INVALID',current.wordIndex);
    out.push(current);
  }
  return{segments:out.map(s=>({start:s.start,end:s.end,text:s.tokens.join(' ')})),diagnostic:Object.freeze({policy:'BOUNDED_TIMELINE_V1',toleranceMs:50,pointWords,duplicateIntervals,overlaps,maxAdjustmentMs:Math.round(maxAdjustment*1000000)/1000})};
}
