// backend/src/index.ts
// 서버 진입점 — Express HTTP + WebSocket 서버 시작

import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';

// Resolve from this source file instead of the shell's current directory, and
// load it before importing services that capture API keys during initialization.
dotenv.config({ path: path.resolve(__dirname, '../../config/.env') });

const PORT = process.env.PORT || 3001;

async function main() {
  const [{ WsHub }, { whisperService }] = await Promise.all([
    import('./socket/wsHub'),
    import('./services/whisperService'),
  ]);

  const app = express();
  app.use(express.json());

  // The browser receives only this short-lived secret. The standard API key
  // remains on this server and is never bundled into the frontend.
  app.post('/api/realtime/session', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    const targetLanguage = req.body?.targetLanguage;
    if (!apiKey) {
      res.status(503).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' });
      return;
    }
    if (targetLanguage !== 'ko' && targetLanguage !== 'en') {
      res.status(400).json({ error: '지원하지 않는 출력 언어입니다.' });
      return;
    }

    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(
        'https://api.openai.com/v1/realtime/translations/client_secrets',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            session: {
              model: 'gpt-realtime-translate',
              audio: {
                input: {
                  transcription: { model: 'gpt-realtime-whisper' },
                  noise_reduction: { type: 'far_field' },
                },
                output: { language: targetLanguage },
              },
            },
          }),
        }
      );
      const data = await response.json() as { value?: string; error?: unknown };
      if (!response.ok || !data.value) {
        console.error('[realtime] client secret 발급 실패:', data);
        res.status(response.status || 502).json({ error: 'Realtime 세션을 만들지 못했습니다.' });
        return;
      }
      res.json({ clientSecret: data.value });
    } catch (error) {
      console.error('[realtime] client secret 요청 오류:', error);
      res.status(502).json({ error: 'OpenAI Realtime 연결에 실패했습니다.' });
    }
  });

  // 헬스체크
  app.get('/health', (_req, res) => {
    res.json({ ok: true, whisperReady: whisperService.isReady() });
  });

  const server = http.createServer(app);
  const wsHub = new WsHub(server);

  // Realtime Translation is the default. Whisper is only needed for the
  // optional DeepL fallback path.
  if (process.env.USE_WHISPER === 'true') {
    console.log('[server] whisper-server 시작 중...');
    try {
      await whisperService.start();
      console.log('[server] whisper-server 준비 완료');
    } catch (err) {
      console.error('[server] whisper-server 시작 실패:', err);
      console.warn('[server] STT 없이 계속 실행합니다');
    }
  } else {
    console.log('[server] OpenAI Realtime 모드: Whisper를 시작하지 않습니다');
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
