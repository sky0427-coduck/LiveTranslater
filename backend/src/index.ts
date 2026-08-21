// backend/src/index.ts
// 서버 진입점 — Express HTTP + WebSocket 서버 시작

import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import { WsHub } from './socket/wsHub';
import { whisperService } from './services/whisperService';

dotenv.config({ path: '../config/.env' });

const PORT = process.env.PORT || 3001;

async function main() {
  const app = express();
  app.use(express.json());

  // 헬스체크
  app.get('/health', (_req, res) => {
    res.json({ ok: true, whisperReady: whisperService.isReady() });
  });

  const server = http.createServer(app);
  const wsHub = new WsHub(server);

  // whisper-server 프로세스 시작
  console.log('[server] whisper-server 시작 중...');
  try {
    await whisperService.start();
    console.log('[server] whisper-server 준비 완료');
  } catch (err) {
    console.error('[server] whisper-server 시작 실패:', err);
    console.warn('[server] STT 없이 계속 실행합니다');
  }

  server.listen(PORT, () => {
    console.log(`[server] 백엔드 실행 중: http://localhost:${PORT}`);
    console.log(`[server] WebSocket: ws://localhost:${PORT}`);
  });

  // 종료 처리
  process.on('SIGINT', () => {
    console.log('\n[server] 종료 중...');
    whisperService.stop();
    process.exit(0);
  });
}

main();
