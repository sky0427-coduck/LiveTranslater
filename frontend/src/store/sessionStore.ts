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
  translationLines: string[];
  translationPending: string;
  translationDisplayPending: string;
  lastTranslationUpdateAt: number;

  // 액션
  setConnected: (v: boolean) => void;
  clearDisplayedTranslationText: () => void;
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
  translationLines: [],
  translationPending: '',
  translationDisplayPending: '',
  lastTranslationUpdateAt: 0,

  setConnected: (v) => set({ isConnected: v }),
  clearDisplayedTranslationText: () => set({
    currentTranslation: '',
    translationLines: [],
    translationDisplayPending: '',
  }),

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
          translationLines: splitSentences(msg.payload.translated),
          translationPending: '',
          translationDisplayPending: '',
          lastTranslationUpdateAt: Date.now(),
        });
        break;

      case 'REALTIME_TRANSLATION_DELTA':
        set((state) => {
          const combined = state.translationPending + msg.payload.delta;
          const sentencePattern = /[^.!?。！？]*[.!?。！？]+["'”’」』)]*/gu;
          const completed: string[] = [];
          let match: RegExpExecArray | null;
          let consumed = 0;
          while ((match = sentencePattern.exec(combined)) !== null) {
            const sentence = match[0].trim();
            if (sentence) completed.push(sentence);
            consumed = sentencePattern.lastIndex;
          }

          const pending = combined.slice(consumed).trimStart();
          const translationLines = [...state.translationLines, ...completed];
          const visibleLines = [...translationLines, pending].filter(Boolean);
          return {
            currentTranscript: msg.payload.original || state.currentTranscript,
            translationLines,
            translationPending: pending,
            translationDisplayPending: pending,
            currentTranslation: visibleLines.join('\n'),
            lastTranslationUpdateAt: msg.payload.delta
              ? Date.now()
              : state.lastTranslationUpdateAt,
          };
        });
        break;

      case 'ERROR':
        console.error('[session] 서버 오류:', msg.payload.message);
        break;
    }
  },
}));

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？])\s*/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
