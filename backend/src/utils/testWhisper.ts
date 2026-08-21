// backend/src/utils/testWhisper.ts
// whisper-server 실행 시 stdout/stderr를 확인하는 테스트 스크립트
//
// 사용법: cd backend && npx tsx src/utils/testWhisper.ts
//
// 이 스크립트를 실행하면 whisper-server가 출력하는 모든 로그를 볼 수 있습니다.
// "listening" 또는 준비 완료 신호가 어떤 문자열인지 확인한 후
// whisperService.ts의 waitUntilReady()를 수정하세요.

import { spawn } from 'child_process';
import path from 'path';

const IS_WIN = process.platform === 'win32';
const EXE_EXT = IS_WIN ? '.exe' : '';
const ROOT = path.resolve(__dirname, '../../..');

const WHISPER_BIN = path.join(ROOT, 'external/whisper.cpp/build/bin', `whisper-server${EXE_EXT}`);
const MODEL_PATH  = path.join(ROOT, 'external/whisper.cpp/models/ggml-base.en.bin');

console.log('=== whisper-server stdout/stderr 테스트 ===');
console.log('실행파일:', WHISPER_BIN);
console.log('모델:', MODEL_PATH);
console.log('');
console.log('→ 아래 출력에서 "준비 완료"를 나타내는 문자열을 찾으세요');
console.log('→ whisperService.ts의 waitUntilReady()에서 그 문자열로 수정하세요');
console.log('');
console.log('Ctrl+C로 종료하세요.');
console.log('─────────────────────────────────────────────');

const proc = spawn(WHISPER_BIN, [
  '--model', MODEL_PATH,
  '--host', '127.0.0.1',
  '--port', '8080',
  '--threads', '4',
  '--language', 'auto',
]);

proc.stdout.on('data', (data: Buffer) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => console.log('[stdout]', JSON.stringify(line)));
});

proc.stderr.on('data', (data: Buffer) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => console.log('[stderr]', JSON.stringify(line)));
});

proc.on('error', (err) => {
  console.error('[오류]', err.message);
  console.log('');
  console.log('실행파일을 찾을 수 없습니다. 경로를 확인하세요:');
  console.log(WHISPER_BIN);
});

proc.on('exit', (code) => {
  console.log(`[종료] 종료 코드: ${code}`);
});
