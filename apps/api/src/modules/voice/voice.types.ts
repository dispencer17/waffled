// Voice assistant (fork) — shared shapes for the transcribe + command routes.

export interface VoiceStatusDto {
  // Which STT backend will transcribe, or null when voice input is unavailable.
  stt: 'local' | 'openai' | null
}

// What the kiosk does with a spoken command. `say` is the short spoken reply
// (client TTS). 'timer' is executed client-side; 'capture' means "open the
// capture bar prefilled with the transcript" so complex intents get the normal
// visual preview/commit flow.
export type VoiceAction =
  | { kind: 'timer'; seconds: number; label: string; say: string }
  | { kind: 'grocery'; added: string[]; say: string }
  | { kind: 'ha'; entityId: string; say: string }
  | { kind: 'query'; say: string }
  | { kind: 'capture'; transcript: string; say: string | null }
  | { kind: 'none'; say: string }
