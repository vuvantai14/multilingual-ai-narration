import { statSync } from 'node:fs';

/** An absent restored absolute path must not shadow an installed PATH binary.
 * Spawn still reports ENOENT when neither source is usable. Never use a shell. */
export function resolveMediaExecutable(kind: 'ffmpeg' | 'ffprobe', configured = process.env[kind === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'], isFile = (path: string) => {
  try { return statSync(path).isFile(); } catch { return false; }
}): string {
  const value = configured?.trim();
  if (!value) return kind;
  // Bare commands are resolved by the OS using PATH, including on Windows.
  if (!/[\\/]/.test(value)) return value;
  return isFile(value) ? value : kind;
}
