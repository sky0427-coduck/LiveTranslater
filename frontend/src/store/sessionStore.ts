// frontend/src/store/sessionStore.ts
// Zustand 전역 상태 저장소
// 프론트엔드 전체에서 세션 상태를 공유합니다

import { create } from 'zustand';
import {
  SessionState,
  ServerMessage,
  TranscriptPayload,
  TranslationResultPayload,
} from '@shared/types';

interface SessionStore {
  // 상태
  session: SessionState | null;
  isConnected: boolean;
  whisperReady: boolean;

  // 현재 표시 중인 텍스트 (partial + final)
  currentTranscript: string;
  currentTranslation: string;
  displayText: string;

  // 액션
  setConnected: (v: boolean) => void;
  applyServerMessage: (msg: ServerMessage) => void;
}

const defaultSession: SessionState = {
  id: '',
  topic: '',
  teams: [],
  currentTeamId: null,
  timer: { totalSeconds: 300, remainingSeconds: 300, isRunning: false },
  sttEngine: 'whisper-local',
  translationEngine: 'openai-realtime',
  sourceLang: 'en',
  targetLang: 'ko',
  translations: [],
  status: 'idle',
};

export const useSessionStore = create<SessionStore>((set) => ({
  session: defaultSession,
  isConnected: false,
  whisperReady: false,
  currentTranscript: '',
  currentTranslation: '',
  displayText: '',

  setConnected: (v) => set({ isConnected: v }),

  applyServerMessage: (msg) => {
    switch (msg.type) {
      case 'SESSION_UPDATE':
        set({ session: msg.payload });
        break;

      case 'WHISPER_STATUS':
        set({ whisperReady: msg.payload.ready });
        break;

      case 'PARTIAL_TRANSCRIPT':
        set({ currentTranscript: msg.payload.text });
        break;

      case 'TRANSCRIPT_FINAL':
        set({ currentTranscript: msg.payload.text });
        break;

      case 'TRANSLATION_RESULT':
        set({
          currentTranslation: msg.payload.translated,
          currentTranscript: msg.payload.original,
        });
        break;

      case 'REALTIME_TRANSLATION_DELTA':
        set((state) => ({
          currentTranscript: msg.payload.original || state.currentTranscript,
          currentTranslation: state.displayText,
        }));
        break;

      case 'DISPLAY_TEXT_UPDATE':
        set({ displayText: msg.payload.text, currentTranslation: msg.payload.text });
        break;

      case 'ERROR':
        console.error('[session] 서버 오류:', msg.payload.message);
        break;
    }
  },
}));
