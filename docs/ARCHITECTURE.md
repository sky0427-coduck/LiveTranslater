# Ourhouse Translator — 전체 아키텍처 & 구현 가이드

> 직접 수정할 파일: ✏️ | 학습 포인트: 📚 | 나중에 추가: 🔜

---

## 1. 전체 시스템 흐름

```
[마이크 / 외부 오디오 장비]
        ↓
[브라우저 MediaRecorder API]  ← frontend/src/hooks/useAudioCapture.ts ✏️
        ↓ (PCM Float32 청크)
[C++ 오디오 전처리 모듈] 🔜   ← native/audio_processor.cpp ✏️📚
  - 잡음 제거 (RNNoise)
  - VAD (음성 구간 감지)
  - 오디오 버퍼 정규화
        ↓ (정제된 오디오 청크)
[Node.js 백엔드 서버]         ← backend/src/
  - WebSocket 허브
  - 세션 상태 관리
  - 번역 엔진 라우팅
        ↓                           ↓
[OpenAI Realtime API]    [DeepL API + Whisper STT]
        ↓ (번역 결과 텍스트)
[WebSocket broadcast]
        ↓                           ↓
[운영자 화면]               [번역 출력 화면]
localhost:5173/operator    localhost:5173/display
```

---

## 2. 레이어별 역할

| 레이어 | 기술 | 역할 |
|---|---|---|
| 프론트엔드 | React + Vite + TS | 운영자 UI, 출력 UI, 오디오 캡처 |
| 백엔드 | Node.js + ws | WebSocket 허브, 번역 라우팅, 세션 저장 |
| C++ 모듈 | node-addon-api | 잡음 제거, VAD, 오디오 정규화만 |
| 공유 | TypeScript | 타입 정의 (양쪽에서 import) |

> C++ 모듈이 없어도 JS fallback으로 동작하도록 설계합니다.
> 처음엔 C++ 없이 시작하고, 7단계에서 붙이는 방식.

---

## 3. 파일 구조 & 역할

```
LiveTranslater/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── OperatorPage.tsx      # 운영자 화면 전체 ✏️
│   │   │   └── DisplayPage.tsx       # 번역 출력 화면 ✏️
│   │   ├── components/
│   │   │   ├── operator/
│   │   │   │   ├── TopicPanel.tsx    # 주제 입력/표시 ✏️
│   │   │   │   ├── TeamPanel.tsx     # 팀 관리 ✏️
│   │   │   │   ├── TimerPanel.tsx    # 타이머 UI ✏️
│   │   │   │   ├── AudioControl.tsx  # 마이크/장비 선택 ✏️
│   │   │   │   └── EngineSelector.tsx# 번역 엔진 전환 ✏️
│   │   │   ├── display/
│   │   │   │   ├── TranslationView.tsx  # 번역 결과 표시 ✏️
│   │   │   │   └── TopicBanner.tsx      # 상단 주제 배너 ✏️
│   │   │   └── shared/
│   │   │       ├── StatusBadge.tsx
│   │   │       └── Button.tsx
│   │   ├── hooks/
│   │   │   ├── useAudioCapture.ts    # 마이크 캡처 핵심 ✏️📚
│   │   │   ├── useWebSocket.ts       # WS 연결/재연결
│   │   │   └── useSessionState.ts    # 세션 상태 구독
│   │   ├── store/
│   │   │   └── sessionStore.ts       # Zustand 전역 상태
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/
│   │   └── manifest.json             # PWA 설정
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
│
├── backend/
│   ├── src/
│   │   ├── index.ts                  # 서버 진입점
│   │   ├── socket/
│   │   │   └── wsHub.ts              # WS 허브 + 브로드캐스트
│   │   ├── services/
│   │   │   ├── translationService.ts # 엔진 인터페이스 + 전환
│   │   │   ├── openaiService.ts      # OpenAI Realtime
│   │   │   └── deeplService.ts       # DeepL + Whisper
│   │   └── controllers/
│   │       └── sessionController.ts  # 세션 CRUD
│   ├── data/sessions/                # JSON 저장
│   └── package.json
│
├── native/
│   ├── audio_processor.cpp           # C++ 메인 ✏️📚
│   ├── audio_processor.h
│   ├── binding.gyp
│   └── README.md                     # C++ 학습 가이드
│
├── shared/
│   └── types.ts                      # 공통 타입
│
└── config/
    └── .env.example
```

---

## 4. 공통 상태 구조

```typescript
// 세션 전체 상태
interface SessionState {
  id: string;
  topic: string;
  teams: Team[];
  currentTeamId: string | null;
  timer: TimerState;
  translationEngine: 'openai' | 'deepl';
  translations: Translation[];
  status: 'idle' | 'listening' | 'translating' | 'paused';
}

interface TimerState {
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
}

// WebSocket 메시지 타입
type WsMessage =
  | { type: 'SESSION_UPDATE'; payload: SessionState }
  | { type: 'TRANSLATION_RESULT'; payload: Translation }
  | { type: 'TIMER_TICK'; payload: { remaining: number } }
  | { type: 'SET_TEAM'; payload: { teamId: string } }
  | { type: 'SET_TOPIC'; payload: { topic: string } }
  | { type: 'SWITCH_ENGINE'; payload: { engine: 'openai' | 'deepl' } }
  | { type: 'RESET_SESSION' }
  | { type: 'ERROR'; payload: { message: string } };
```

---

## 5. 데이터 흐름

### 오디오 → 번역 → 화면
```
useAudioCapture.ts
  → PCM Float32 청크 추출
  → (C++ 노이즈 제거) 🔜
  → WS로 오디오 청크 전송
    → backend/wsHub.ts 수신
    → translationService.ts 호출
      → OpenAI 또는 DeepL
    → 결과 텍스트 broadcast
      → DisplayPage.tsx 업데이트
      → OperatorPage.tsx 업데이트 (모니터링용)
```

### 운영자 조작 → 상태 변경
```
운영자 버튼 클릭
  → WS 메시지 전송 { type: 'SET_TEAM', payload: ... }
  → 서버 세션 상태 업데이트
  → SESSION_UPDATE broadcast
  → 모든 화면 동시 업데이트
```

---

## 6. 번역 엔진 교체 구조

```typescript
// backend/src/services/translationService.ts

interface TranslationEngine {
  processAudio(
    audioChunk: Buffer,
    sourceLang: string,
    targetLang: string
  ): Promise<string>;
  cleanup(): Promise<void>;
}

// 런타임 교체
let currentEngine: TranslationEngine;

export function switchEngine(engine: 'openai' | 'deepl') {
  currentEngine?.cleanup();
  currentEngine = engine === 'openai'
    ? new OpenAIEngine()
    : new DeepLEngine();
}
```

---

## 7. 잡음 제거 & VAD 위치

| 처리 | 위치 | 이유 |
|---|---|---|
| 잡음 제거 (RNNoise) | C++ native | CPU 집약, 실시간 필수 |
| VAD | C++ 또는 JS | 초기엔 JS RMS로 시작 가능 |
| 오디오 정규화 | C++ | 연산량 |
| 버퍼 관리 | Node.js | 네트워크 레이어 |

**초기 전략**: JS로 간단한 VAD 구현 → 이후 C++ 모듈 교체

---

## 8. 구현 단계 로드맵

### 1단계: 전체 뼈대 세팅 ← 지금
- [x] 폴더 구조 생성
- [x] 공통 타입 정의
- [ ] frontend package.json & vite 설정
- [ ] backend package.json & tsconfig 설정

### 2단계: WebSocket 통신
- [ ] backend wsHub.ts
- [ ] frontend useWebSocket.ts
- [ ] 연결 확인 (ping/pong)

### 3단계: 운영자 UI
- [ ] sessionStore.ts (Zustand)
- [ ] OperatorPage 레이아웃
- [ ] TopicPanel, TeamPanel, TimerPanel

### 4단계: 출력 화면
- [ ] DisplayPage 레이아웃
- [ ] TranslationView 컴포넌트
- [ ] 실시간 업데이트 연결

### 5단계: 오디오 캡처
- [ ] useAudioCapture.ts
- [ ] 외부 장비 선택
- [ ] 오디오 레벨 시각화

### 6단계: 번역 엔진
- [ ] translationService.ts 인터페이스
- [ ] OpenAI Realtime 연결
- [ ] DeepL 연결 및 전환

### 7단계: C++ 모듈 (학습 병행) ✏️📚
- [ ] node-addon-api 환경 구축
- [ ] PCM 데이터 이해 및 처리
- [ ] RMS 기반 VAD 구현
- [ ] RNNoise 잡음 제거

---

## 9. C++ 오디오 학습 순서 📚

### Phase 1: 개념
1. PCM = 오디오를 숫자 배열로 표현한 것
2. 샘플레이트(44100Hz), 비트심도(Float32 = -1.0 ~ 1.0)
3. 버퍼 크기 = 지연시간 (1024 샘플 @ 44100Hz ≈ 23ms)

### Phase 2: C++ 기초
```cpp
// 오디오 버퍼의 실체
float buffer[1024];  // 1024개 샘플
// 각 값: -1.0 ~ 1.0 (Float32)
// 이게 전부입니다!

// RMS (음량 측정) → VAD 기초
float rms = 0;
for (int i = 0; i < 1024; i++) rms += buffer[i] * buffer[i];
rms = sqrt(rms / 1024);
bool isSpeaking = rms > 0.01f; // 임계값
```

### Phase 3: Node.js 연동
- node-addon-api: JS Float32Array → C++ float*
- N-API로 함수 노출

### Phase 4: 실전 알고리즘
- RNNoise 라이브러리 통합
- 프레임 단위 처리 (480 샘플 = RNNoise 요구사항)

---

## 10. ✏️ 직접 작성할 TODO 포인트

1. `frontend/src/hooks/useAudioCapture.ts`
   - 마이크 목록 가져오기 (`enumerateDevices`)
   - 외부 장비 감지 및 선택 UI 연동

2. `frontend/src/components/operator/TimerPanel.tsx`
   - 타이머 UI 전체 디자인 및 로직

3. `frontend/src/components/operator/TeamPanel.tsx`
   - 팀 추가/제거, 현재 발언 팀 선택

4. `native/audio_processor.cpp`
   - RMS 기반 VAD 구현
   - 잡음 제거 필터 적용

5. `backend/src/services/translationService.ts`
   - 엔진 인터페이스 구현체 작성
