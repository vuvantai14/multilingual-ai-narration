/** Conservative container/frame validation, not a speech-quality assertion. */
export function audioFormat(bytes: Buffer): 'wav' | 'mp3' | undefined {
  if (bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) return;
    let fmt = false, data = false;
    for (let p = 12; p + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(p + 4), end = p + 8 + size;
      if (end > bytes.length) return;
      const tag = bytes.toString('ascii', p, p + 4);
      if (tag === 'fmt ' && size >= 16) fmt = [1, 3].includes(bytes.readUInt16LE(p + 8)) && bytes.readUInt16LE(p + 10) > 0 && bytes.readUInt32LE(p + 12) > 0;
      if (tag === 'data' && size > 0) data = true;
      p = end + (size % 2);
    }
    return fmt && data ? 'wav' : undefined;
  }
  let p = 0;
  if (bytes.toString('ascii', 0, 3) === 'ID3') {
    if (bytes.length < 10 || [...bytes.subarray(6, 10)].some(n => n > 127)) return;
    p = 10 + ((bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!) + ((bytes[5]! & 16) ? 10 : 0);
  }
  let frames = 0;
  while (p + 4 <= bytes.length) {
    if (bytes.length - p === 128 && bytes.toString('ascii', p, p + 3) === 'TAG') return frames ? 'mp3' : undefined;
    const b = bytes[p + 1]!, c = bytes[p + 2]!;
    const version = (b >> 3) & 3, rate = (c >> 2) & 3, index = c >> 4;
    if (bytes[p] !== 255 || (b & 224) !== 224 || version === 1 || ((b >> 1) & 3) !== 1 || rate === 3 || index === 0 || index === 15) return;
    const rates = [44100, 48000, 32000];
    const bitrates = version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
    const sampleRate = rates[rate]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const length = Math.floor((version === 3 ? 144000 : 72000) * bitrates[index]! / sampleRate) + ((c >> 1) & 1);
    if (length < 4 || p + length > bytes.length) return;
    p += length; frames++;
  }
  return frames && p === bytes.length ? 'mp3' : undefined;
}
