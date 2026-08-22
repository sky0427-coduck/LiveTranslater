export interface TimerState {
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
}

export interface Team {
  id: string;
  name: string;
  color?: string;
  timer: TimerState;
}

export interface Translation {
  id: string;
  original: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  teamId?: string;
  timestamp: number;
}

export type SttEngine = 'whisper-local';
export type TranslationEngine = 'openai-realtime' | 'deepl';
export type SessionStatus = 'idle' | 'listening' | 'translating' | 'paused';

export interface SessionState {
  id: string;
  topic: string;
  teams: Team[];
  currentTeamId: string | null;
  timer: TimerState;
  sttEngine: SttEngine;
  translationEngine: TranslationEngine;
  sourceLang: string;
  targetLang: string;
  translations: Translation[];
  status: SessionStatus;
}

export type ServerMessage =
  | { type: 'SESSION_UPDATE'; payload: SessionState }
  | { type: 'PARTIAL_TRANSCRIPT'; payload: TranscriptPayload }
  | { type: 'TRANSCRIPT_FINAL'; payload: TranscriptPayload }
  | { type: 'TRANSLATION_RESULT'; payload: TranslationResultPayload }
  | { type: 'TIMER_TICK'; payload: { remaining: number; teamId: string | null } }
  | { type: 'WHISPER_STATUS'; payload: { ready: boolean } }
  | { type: 'ERROR'; payload: { message: string } };

export type ClientMessage =
  | { type: 'AUDIO_CHUNK'; payload: AudioChunkPayload }
  | { type: 'SET_TOPIC'; payload: { topic: string } }
  | { type: 'SET_TEAM'; payload: { teamId: string | null } }
  | { type: 'ADD_TEAM'; payload: { name: string; color?: string; seconds?: number } }
  | { type: 'REMOVE_TEAM'; payload: { teamId: string } }
  | { type: 'TIMER_START' }
  | { type: 'TIMER_PAUSE' }
  | { type: 'TIMER_RESET'; payload: { seconds: number } }
  | { type: 'SWITCH_ENGINE'; payload: { engine: TranslationEngine } }
  | { type: 'SET_LANGUAGE'; payload: { sourceLang: string; targetLang: string } }
  | { type: 'REALTIME_TRANSCRIPT'; payload: { text: string } }
  | { type: 'REALTIME_TRANSLATION'; payload: { original: string; translated: string } }
  | { type: 'RESET_SESSION' };

export interface TranscriptPayload {
  text: string;
  isFinal: boolean;
  teamId?: string;
  timestamp: number;
}

export interface TranslationResultPayload {
  id: string;
  original: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  teamId?: string;
  timestamp: number;
}

export interface AudioChunkPayload {
  samples: number[];
  sampleRate: number;
  channels: number;
}

export type ClientRole = 'operator' | 'display' | 'monitor';

export interface ClientInfo {
  id: string;
  role: ClientRole;
  connectedAt: number;
}
