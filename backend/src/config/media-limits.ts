// Gemini 3.5 Transcribe: the pipeline requests word timestamps, whose documented
// unary limit is 30 minutes, rather than the one-hour plain-transcript limit.
// https://ai.google.dev/gemini-api/docs/transcribe#limitations
export const MAX_TRANSCRIPTION_DURATION_SECONDS = 1800;
