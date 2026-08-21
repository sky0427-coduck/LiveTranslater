// backend/src/services/whisperService.ts
// whisper-server.exe 프로세스 관리 + /inference HTTP 호출
//
// 실제 확인된 동작 (testWhisper.ts 실행 결과):
//   - 모든 초기화 로그는 stderr로 출력됨 (stdout은 비어 있음)
//   - 마지막 stderr 로그: "compute buffer (decode)" 이후 HTTP 대기 진입
//   - stdout에는 아무것도 안 나오므로 HTTP 폴링으로 준비 여부 확인
//   - GPU 없음이 자동 감지되므로 --no-gpu 플래그 불필요

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import FormData from 'form-data';

const IS_WIN = process.platform === 'win32';
const EXE_EXT = IS_WIN ? '.exe' : '';
const WHISPER_PORT = 8080;
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const WHISPER_BIN = path.join(
  PROJECT_ROOT,
  'external/whisper.cpp/build/bin',
  `whisper-server${EXE_EXT}`
);

const MODEL_PATH = path.join(
  PROJECT_ROOT,
  'external/whisper.cpp/models/ggml-base.en.bin'
);

export class WhisperService {
  private process: ChildProcess | null = null;
  private _ready = false;
  private _initDone = false;  // "compute buffer (decode)" 로그 수신 여부

  isReady(): boolean {
    return this._ready;
  }

  async start(): Promise<void> {
    console.log(`[whisper] 실행파일: ${WHISPER_BIN}`);
    console.log(`[whisper] 모델: ${MODEL_PATH}`);

    this.process = spawn(WHISPER_BIN, [
      '--model',    MODEL_PATH,
      '--host',     '127.0.0.1',
      '--port',     String(WHISPER_PORT),
      '--language', 'auto',  // ✏️ 'ko', 'en', 'ja', 'auto' 중 선택
      '--threads',  '4',     // ✏️ CPU 코어 수에 맞게 조정 (보통 4~8)
      // --no-gpu 불필요: 자동으로 "no GPU found" 감지됨
    ]);

    // stdout은 비어 있음 (확인됨)
    this.process.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log('[whisper-stdout]', msg);
    });

    // 실제 초기화 로그는 전부 stderr로 나옴
    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();

      // "compute buffer (decode)" = 마지막 초기화 단계
      // 이 메시지 이후 HTTP 서버가 바인딩됨
      if (msg.includes('compute buffer (decode)')) {
        this._initDone = true;
        console.log('[whisper] 모델 로딩 완료, HTTP 서버 대기 중...');
      }

      // 중요 로그만 출력 (너무 장황하지 않게)
      const lines = msg.split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (
          line.includes('loading model') ||
          line.includes('model size') ||
          line.includes('compute buffer (decode)') ||
          line.includes('error') ||
          line.includes('Error')
        ) {
          console.log('[whisper]', line.trim());
        }
      }
    });

    this.process.on('exit', (code) => {
      console.warn(`[whisper] 프로세스 종료 (code: ${code})`);
      this._ready = false;
      this._initDone = false;
    });

    this.process.on('error', (err) => {
      console.error('[whisper] 프로세스 오류:', err.message);
      this._ready = false;
    });

    await this.waitUntilReady();
  }

  // WAV 버퍼 → whisper-server /inference → 텍스트 반환
  async transcribe(wavBuffer: Buffer, language = 'auto'): Promise<string> {
    if (!this._ready) throw new Error('Whisper server not ready');

    const form = new FormData();
    form.append('file', wavBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav',
    });
    form.append('language', language);
    form.append('response_format', 'json');
    form.append('temperature', '0.0');
    // ✏️ 추가 옵션 예시:
    // form.append('temperature_inc', '0.2');  // 인식 실패 시 온도 증가폭
    // form.append('word_timestamps', 'true'); // 단어별 타임스탬프

    try {
      const { default: fetch } = await import('node-fetch');
      const res = await fetch(
        `http://127.0.0.1:${WHISPER_PORT}/inference`,
        {
          method: 'POST',
          body: form as any,
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`whisper HTTP ${res.status}: ${body}`);
      }

      const data = await res.json() as { text?: string; error?: string };
      if (data.error) throw new Error(data.error);
      return (data.text ?? '').trim();

    } catch (err) {
      console.error('[whisper] transcribe 오류:', err);
      throw err;
    }
  }

  stop(): void {
    if (this.process) {
      // Windows: SIGTERM이 동작 안 할 수 있으므로 kill()로 강제 종료
      this.process.kill();
      this.process = null;
    }
    this._ready = false;
    this._initDone = false;
    console.log('[whisper] 프로세스 종료됨');
  }

  // 준비 완료 감지:
  //   1단계: stderr에서 "compute buffer (decode)" 수신 대기
  //          → 모델 로딩 완료 신호 (확인됨)
  //   2단계: HTTP GET /health 또는 빈 POST로 서버 응답 확인
  //          → 실제로 HTTP 바인딩됐는지 확인
  private waitUntilReady(timeoutMs = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._ready) { resolve(); return; }

      const start = Date.now();

      const poll = setInterval(async () => {
        const elapsed = Date.now() - start;

        if (elapsed > timeoutMs) {
          clearInterval(poll);
          reject(new Error(`[whisper] 준비 타임아웃 (${timeoutMs}ms 초과)`));
          return;
        }

        // 1단계: 모델 로딩이 완료됐는지 확인
        if (!this._initDone) return;

        // 2단계: HTTP로 실제 응답 확인
        try {
          const { default: fetch } = await import('node-fetch');

          // /health 엔드포인트가 있으면 사용, 없으면 /inference로 확인
          // whisper-server는 /health가 없을 수 있으므로 두 가지 시도
          const res = await fetch(
            `http://127.0.0.1:${WHISPER_PORT}/`,
            {
              method: 'GET',
              signal: AbortSignal.timeout(1000),
            }
          );

          // 어떤 HTTP 응답이든 오면 서버가 살아있는 것
          if (res.status > 0) {
            clearInterval(poll);
            this._ready = true;
            console.log(`[whisper] 준비 완료 (${elapsed}ms)`);
            resolve();
          }
        } catch {
          // 아직 HTTP 바인딩 안 됨 — 계속 대기
        }
      }, 300);
    });
  }
}

export const whisperService = new WhisperService();
