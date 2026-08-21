# Whisper.cpp 연동 설계 가이드

> whisper.cpp를 외부 로컬 STT 엔진으로 연결하는 전략 문서
> 내부 코드는 건드리지 않고, 실행파일을 HTTP 서버로 띄워서 연결합니다.

---

## 0. 현재 상황 파악 (이미 준비된 것들)

```
external/whisper.cpp/
├── build/bin/
│   ├── whisper-server.exe   ← ✅ 이미 빌드 완료! HTTP 서버 모드
│   ├── whisper-cli.exe      ← ✅ CLI 모드 (파이프 방식)
│   └── test-vad.exe         ← ✅ VAD 테스트용
└── models/
    └── ggml-base.en.bin     ← ✅ 모델 파일 존재
```

**핵심 선택**: `whisper-server.exe`를 사용한다.
- whisper-server를 로컬 HTTP 서버(포트 8080)로 띄움
- Node.js 백엔드가 WAV 오디오를 HTTP POST로 전송
- JSON 응답으로 텍스트 받음
- child_process.spawn으로 프로세스 관리

---

## 1. 전체 연결 구조

```
[브라우저 마이크 / 외부 장비]
        ↓ (MediaRecorder → WAV 청크)
[Node.js 백엔드 :3001]
  └─ whisperService.ts
        ↓ HTTP POST /inference (multipart WAV)
[whisper-server.exe :8080]        ← 별도 프로세스, 내부 건드리지 않음
        ↓ JSON 응답 { text: "..." }
[Node.js 백엔드]
        ↓ 번역 API 호출 (OpenAI / DeepL)
        ↓ WebSocket broadcast
[프론트엔드 운영자/출력 화면]
```

---

## 2. 파일 책임 구조

```
backend/src/services/
├── whisperService.ts        # whisper-server 프로세스 관리 + HTTP 호출
├── translationService.ts    # 번역 엔진 인터페이스 (OpenAI / DeepL)
├── openaiService.ts         # OpenAI Realtime 연동
└── deeplService.ts          # DeepL 번역 연동

backend/src/socket/
└── wsHub.ts                 # 오디오 청크 수신 → whisper → 번역 → broadcast

backend/src/utils/
└── audioUtils.ts            # Float32Array → WAV 변환 유틸
```

---

## 3. whisperService.ts — 핵심 인터페이스

```typescript
// backend/src/services/whisperService.ts

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';
import fs from 'fs';

const WHISPER_SERVER_PORT = 8080;
const WHISPER_BIN = path.resolve(
  __dirname,
  '../../../external/whisper.cpp/build/bin/whisper-server'
  // Windows: '../../../external/whisper.cpp/build/bin/whisper-server.exe'
);
const MODEL_PATH = path.resolve(
  __dirname,
  '../../../external/whisper.cpp/models/ggml-base.en.bin'
);

export class WhisperService {
  private process: ChildProcess | null = null;
  private ready = false;

  // whisper-server 프로세스 시작
  async start(): Promise<void> {
    // TODO ✏️: 실행 인자 조정 가능 (언어, 스레드 수 등)
    this.process = spawn(WHISPER_BIN, [
      '--model', MODEL_PATH,
      '--host', '127.0.0.1',
      '--port', String(WHISPER_SERVER_PORT),
      '--language', 'auto',   // ✏️ 'ko', 'en', 'auto' 선택
      '--threads', '4',        // ✏️ CPU 코어 수에 맞게 조정
    ]);

    this.process.stdout?.on('data', (data) => {
      if (data.toString().includes('listening')) {
        this.ready = true;
      }
    });

    this.process.stderr?.on('data', (data) => {
      console.error('[whisper]', data.toString());
    });

    // 서버 준비될 때까지 대기
    await this.waitUntilReady();
  }

  // WAV 버퍼를 whisper-server로 전송 → 텍스트 반환
  async transcribe(wavBuffer: Buffer, language = 'auto'): Promise<string> {
    if (!this.ready) throw new Error('Whisper server not ready');

    const form = new FormData();
    form.append('file', wavBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav',
    });
    form.append('language', language);
    form.append('response_format', 'json');
    form.append('temperature', '0.0');

    const res = await fetch(
      `http://127.0.0.1:${WHISPER_SERVER_PORT}/inference`,
      { method: 'POST', body: form }
    );

    const data = await res.json() as { text: string };
    return data.text.trim();
  }

  stop(): void {
    this.process?.kill();
    this.ready = false;
  }

  private waitUntilReady(timeout = 10000): Promise<void> {
    // ✏️ polling으로 /inference 엔드포인트 확인하거나
    // stdout 파싱으로 "listening" 문자열 감지
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = setInterval(async () => {
        if (this.ready) { clearInterval(check); resolve(); return; }
        if (Date.now() - start > timeout) {
          clearInterval(check);
          reject(new Error('Whisper server timeout'));
        }
      }, 200);
    });
  }
}

export const whisperService = new WhisperService();
```

---

## 4. 오디오 청크 처리 방식

### 문제: 실시간 partial transcript를 어떻게?

whisper.cpp는 기본적으로 "음성 끝나면 한 번에 변환"하는 방식입니다.
Partial transcript를 흉내내려면 **슬라이딩 윈도우 방식**을 씁니다.

```
시간선: ──────────────────────────────────────
        [  chunk1  ]
              [  chunk2  ]        ← 50% overlap
                    [  chunk3  ]
                          [  chunk4  ]

각 청크: 2~3초 분량 WAV
처리: 각 청크를 whisper로 보내서 부분 결과를 빠르게 반환
```

### audioUtils.ts — Float32Array → WAV 변환

```typescript
// backend/src/utils/audioUtils.ts

export function float32ToWav(
  samples: Float32Array,
  sampleRate = 16000   // whisper는 16kHz 요구!
): Buffer {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2); // WAV 헤더 44바이트

  // WAV 헤더 작성
  // ✏️ 이 부분이 C++ 오디오 학습의 시작점입니다
  // RIFF 헤더, fmt 청크, data 청크 구조를 이해하면
  // PCM 포맷의 전체 그림이 보입니다

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);        // chunk size
  buffer.writeUInt16LE(1, 20);         // PCM
  buffer.writeUInt16LE(1, 22);         // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);         // block align
  buffer.writeUInt16LE(16, 34);        // bits per sample

  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  // Float32 → Int16 변환
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  return buffer;
}
```

---

## 5. WebSocket 흐름 — partial transcript까지

```
frontend useAudioCapture.ts
  └─ 100ms마다 오디오 청크 버퍼에 누적
  └─ 2초 분량 쌓이면 WS로 전송

backend wsHub.ts
  └─ AUDIO_CHUNK 메시지 수신
  └─ audioBuffer에 누적
  └─ 2초 단위로 whisperService.transcribe() 호출
  └─ 결과를 즉시 broadcast:
     { type: 'PARTIAL_TRANSCRIPT', text: '...' , isFinal: false }
  └─ 발화 종료 감지 (VAD 또는 2초 이상 묵음)
  └─ 최종 결과:
     { type: 'TRANSCRIPT_FINAL', text: '...' , isFinal: true }
  └─ 번역 API 호출
  └─ 번역 결과 broadcast:
     { type: 'TRANSLATION_RESULT', original: '...', translated: '...' }
```

### wsHub.ts 청크 처리 핵심 로직

```typescript
// backend/src/socket/wsHub.ts (핵심 부분만)

class AudioBuffer {
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private readonly CHUNK_SAMPLES = 16000 * 2; // 2초 @ 16kHz

  append(chunk: Float32Array): Float32Array | null {
    this.chunks.push(chunk);
    this.totalSamples += chunk.length;

    if (this.totalSamples >= this.CHUNK_SAMPLES) {
      const merged = this.flush();
      return merged;
    }
    return null;
  }

  flush(): Float32Array {
    const merged = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    // ✏️ 슬라이딩 윈도우: 마지막 0.5초는 다음 청크에 포함
    const overlap = Math.floor(16000 * 0.5);
    this.chunks = [merged.slice(-overlap)];
    this.totalSamples = overlap;
    return merged;
  }
}
```

---

## 6. OpenAI Realtime vs Whisper.cpp + 번역 API 비교

| 항목 | OpenAI Realtime | whisper.cpp + 번역 API |
|---|---|---|
| **지연시간** | 매우 낮음 (스트리밍) | 2~3초 청크 단위 |
| **partial transcript** | 네이티브 지원 | 슬라이딩 윈도우로 구현 |
| **인터넷 필요** | 필수 | STT는 로컬, 번역만 API |
| **비용** | 분당 과금 (높음) | STT 무료, 번역만 과금 |
| **오프라인 가능** | 불가 | STT는 완전 오프라인 가능 |
| **언어 지원** | 매우 넓음 | 넓음 (Whisper 지원 언어) |
| **세팅 복잡도** | 간단 (API 키만) | 복잡 (프로세스 관리 필요) |
| **토론회 실용성** | ✅ 네트워크 안정적이면 최고 | ✅ 네트워크 불안정 환경에서 유리 |

### 추천 전략

```
1단계 (MVP): OpenAI Realtime만 구현 → 빠르게 동작하는 것 먼저 확인
2단계: whisper.cpp + DeepL 경로 추가
3단계: 운영자 화면에서 실시간 전환 가능하게
```

---

## 7. whisper.cpp 내부 코드 학습 순서 📚

내부를 건드리진 않지만, C++ 오디오 학습을 위해 읽어볼 파일들:

### Step 1: 구조 파악 (읽기만)
```
external/whisper.cpp/
├── include/whisper.h          ← 1번. C API 정의. 이게 전부입니다
├── src/whisper.cpp            ← 2번. 핵심 구현 (길지만 함수 목록만 훑기)
└── examples/cli/main.cpp      ← 3번. CLI 사용 예시 (가장 단순한 사용법)
```

### Step 2: 오디오 처리 흐름
```
examples/common.cpp            ← WAV 읽기/쓰기 구현 (float32ToWav 학습용)
examples/common-whisper.cpp    ← 오디오 전처리 (리샘플링, 정규화)
examples/stream/               ← 스트리밍 처리 예시 ✏️ 꼭 읽기
```

### Step 3: 우리 프로젝트와 연관
```
examples/server/server.cpp     ← whisper-server HTTP 서버 구현
                                  /inference 엔드포인트가 어떻게 생겼는지 확인
```

### 읽을 때 주목할 것들
- `whisper_full()` 함수 — 메인 추론 함수
- `whisper_pcm_to_mel()` — PCM → 멜 스펙트로그램 변환
- 샘플레이트가 16000Hz로 하드코딩된 이유

---

## 8. 배포 고려사항 (선생님이 git clone/cmake 없이 쓰게)

### 현재 상태
```
✅ whisper-server.exe 이미 빌드됨
✅ ggml-base.en.bin 모델 존재
```

### 배포 전략
```
배포 패키지 구조:
LiveTranslater/
├── external/whisper.cpp/
│   ├── build/bin/whisper-server.exe   ← 빌드된 실행파일 포함
│   └── models/ggml-base.en.bin        ← 모델 파일 포함
├── backend/
├── frontend/
└── start.sh (또는 start.bat)          ← 한 번에 시작 스크립트
```

### start.sh (macOS용)
```bash
#!/bin/bash
# whisper-server 백그라운드 실행
./external/whisper.cpp/build/bin/whisper-server \
  --model ./external/whisper.cpp/models/ggml-base.en.bin \
  --port 8080 &

# Node.js 백엔드 실행
cd backend && npm start &

# 프론트엔드 실행
cd frontend && npm run preview &

echo "✅ Ourhouse Translator 시작됨"
echo "운영자 화면: http://localhost:5173/operator"
echo "출력 화면:   http://localhost:5173/display"
```

> macOS에서는 `whisper-server.exe` 대신 `whisper-server` (확장자 없음)
> 현재 Windows에서 빌드된 .exe는 macOS에서 재빌드 필요합니다.
> → macOS에서는 cmake로 한 번만 빌드하면 됩니다 (다음 섹션 참고)

### macOS 빌드 가이드 (선생님용, 딱 한 번만)
```bash
cd external/whisper.cpp
cmake -B build
cmake --build build --config Release
# → build/bin/whisper-server 생성됨
```

---

## 9. ✏️ 내가 직접 작성할 부분

### 높은 우선순위
1. `backend/src/services/whisperService.ts`
   - `waitUntilReady()` 완성 (stdout 파싱 로직)
   - 재시작 처리 (`process.on('exit')` 핸들러)

2. `backend/src/utils/audioUtils.ts`
   - `float32ToWav()` 완성
   - 16kHz 리샘플링 추가 (브라우저는 보통 44100Hz 출력)

3. `backend/src/socket/wsHub.ts`
   - `AudioBuffer` 슬라이딩 윈도우 로직
   - VAD 묵음 감지 (RMS 임계값 방식)

### 나중에 (C++ 학습 병행)
4. `native/audio_processor.cpp`
   - 리샘플링을 C++로 옮기기 (JS보다 훨씬 빠름)
   - RNNoise 잡음 제거 추가

---

## 10. MVP 구현 우선순위

```
1. whisperService.ts — 서버 시작 + /inference 호출 동작 확인
2. audioUtils.ts — Float32 → WAV 변환 (가장 핵심!)
3. wsHub.ts — 청크 누적 + transcribe 루프
4. 프론트에서 PARTIAL_TRANSCRIPT 수신 후 화면 표시
5. translationService.ts — DeepL 또는 OpenAI로 번역
6. 전체 파이프라인 통합 테스트
```

---

## 11. 타입 추가 (shared/types.ts에 추가할 것)

```typescript
// shared/types.ts에 추가

export type SttEngine = 'whisper-local';
export type TranslationEngine = 'openai-realtime' | 'deepl';

export interface TranscriptMessage {
  type: 'PARTIAL_TRANSCRIPT' | 'TRANSCRIPT_FINAL';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface TranslationResult {
  type: 'TRANSLATION_RESULT';
  original: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

export interface AudioChunkMessage {
  type: 'AUDIO_CHUNK';
  samples: number[];    // Float32Array를 배열로 직렬화
  sampleRate: number;
}
```
