import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useRealtimeTranslation } from '../hooks/useRealtimeTranslation';
import { useSessionStore } from '../store/sessionStore';
import { useTheme } from '../theme';
import { useNavigate } from 'react-router-dom';

function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function minutesToSeconds(value: string) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return 300;
  return Math.max(1, Math.round(minutes * 60));
}



function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-switch" aria-label="Theme">
      <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} type="button">
        Light
      </button>
      <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} type="button">
        Dark
      </button>
    </div>
  );
}

export function OperatorPage() {
  const { sendMessage, sendBinary } = useWebSocket('operator');
  const { session, isConnected, whisperReady, currentTranscript } = useSessionStore();
  const [speakerPickerOpen, setSpeakerPickerOpen] = useState(false);

  const handleAudioChunk = useCallback(
    (samples: Float32Array) => {
      if (session?.translationEngine !== 'deepl') return;
      const safeBuffer = new ArrayBuffer(samples.byteLength);
      new Float32Array(safeBuffer).set(samples);
      sendBinary(safeBuffer);
    },
    [sendBinary, session?.translationEngine]
  );
  const realtime = useRealtimeTranslation({
    targetLanguage: session?.targetLang ?? 'ko',
    onSourceTranscript: useCallback(
      (text: string) => sendMessage({ type: 'REALTIME_TRANSCRIPT', payload: { text } }),
      [sendMessage]
    ),
    onTranslation: useCallback(
      (original: string, delta: string) => sendMessage({
        type: 'REALTIME_TRANSLATION',
        payload: { original, delta },
      }),
      [sendMessage]
    ),
  });

  const handleStreamStarted = useCallback(async (stream: MediaStream) => {
    if (session?.translationEngine === 'openai-realtime') await realtime.connect(stream);
  }, [realtime.connect, session?.translationEngine]);

  const audio = useAudioCapture({
    onAudioChunk: handleAudioChunk,
    onStreamStarted: handleStreamStarted,
  });

  if (!session) {
    return (
      <main className="app-shell">
        <div className="operator-layout">
          <section className="panel section">세션을 불러오는 중입니다.</section>
        </div>
      </main>
    );
  }

  const meterColor = audio.level > 0.5 ? 'var(--danger)' : audio.level > 0.1 ? 'var(--success)' : 'var(--accent)';

  return (
    <main className="app-shell">
      <div className="operator-layout">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">LT</div>
            <div>
              <h1>Live Translator</h1>
              <p>운영자 콘솔</p>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="status-row" aria-label="Connection status">
              <span className="status-pill">
                <span className={`dot ${isConnected ? 'live' : 'warn'}`} />
                서버 {isConnected ? '연결됨' : '대기 중'}
              </span>
              <span className="status-pill">
                <span className={`dot ${session.translationEngine === 'openai-realtime'
                  ? (realtime.connectionStatus === 'connected' ? 'live' : 'warn')
                  : (whisperReady ? 'live' : 'warn')}`} />
                {session.translationEngine === 'openai-realtime'
                  ? `Realtime ${{
                    idle: '대기 중',
                    connecting: '연결 중',
                    connected: '연결됨',
                    reconnecting: '재연결 중',
                    failed: '연결 실패',
                  }[realtime.connectionStatus]}`
                  : `Whisper ${whisperReady ? '준비됨' : '준비 중'}`}
              </span>
            </div>
            <ThemeSwitch />
          </div>
        </header>

        {realtime.error && session.translationEngine === 'openai-realtime' && (
          <div className="panel section" role="status">
            Realtime 상태: {realtime.error}
          </div>
        )}

        <div className="main-stack">
          <section className="panel section">
            <div className="section-header">
              <h2>오디오 입력</h2>
              {audio.autoSelectedLabel && <span className="hint">자동 선택: {audio.autoSelectedLabel}</span>}
            </div>
            <div className="field">
              <label htmlFor="audio-device">Input device</label>
              <select
                id="audio-device"
                className="select"
                value={audio.selectedDeviceId}
                onChange={(event) => audio.setSelectedDeviceId(event.target.value)}
              >
                {audio.devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.isExternal ? 'External - ' : 'Built-in - '}
                    {device.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="meter" aria-label="Audio level">
              <div
                className="meter-fill"
                style={{ width: `${Math.min(audio.level * 100, 100)}%`, background: meterColor }}
              />
            </div>

            <div className="button-row">
              {audio.isCapturing ? (
                <button className="btn btn-danger" onClick={() => { realtime.stop(); audio.stopCapture(); }} type="button">
                  캡처 중지
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={audio.isStarting}
                  onClick={() => {
                    audio.startCapture();
                    window.open('/display', '_blank');
                  }}
                  type="button"
                >
                  {audio.isStarting ? '연결 중…' : '캡처 시작 및 송출시작'}
                </button>
              )}
              <button className="btn" onClick={audio.refreshDevices} type="button">
                입력 새로고침
              </button>

            </div>
          </section>

          <section className="panel section">
            <div className="section-header">
              <h2>실시간 인식</h2>
              <span className="hint">Partial transcript</span>
            </div>
            <div className="transcript-box">
              {currentTranscript || <span className="empty">음성이 인식되면 여기에 표시됩니다.</span>}
            </div>
          </section>
        </div>

        <aside className="side-stack">
          <section className="panel section">
            <div className="section-header">
              <h2>번역 엔진</h2>
            </div>
            <div className="segmented" aria-label="Translation engine">
              {(['deepl', 'openai-realtime'] as const).map((engine) => (
                <button
                  key={engine}
                  className={session.translationEngine === engine ? 'active' : ''}
                  onClick={() => sendMessage({ type: 'SWITCH_ENGINE', payload: { engine } })}
                  type="button"
                >
                  {engine === 'deepl' ? 'DeepL (Whisper 필요)' : 'OpenAI Realtime'}
                </button>
              ))}
            </div>
          </section>

          <section className="panel section">
            <div className="section-header">
              <h2>번역 언어</h2>
            </div>
            <div className="field">
              <label htmlFor="source-language">원문 언어</label>
              <select
                id="source-language"
                className="select"
                value={session.sourceLang}
                onChange={(event) => sendMessage({
                  type: 'SET_LANGUAGE',
                  payload: { sourceLang: event.target.value, targetLang: session.targetLang },
                })}
              >
                <option value="en">English</option>
                <option value="auto">자동 감지</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="target-language">표시 언어</label>
              <select
                id="target-language"
                className="select"
                value={session.targetLang}
                onChange={(event) => sendMessage({
                  type: 'SET_LANGUAGE',
                  payload: { sourceLang: session.sourceLang, targetLang: event.target.value },
                })}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </select>
            </div>
          </section>

          <section className="panel section">
            <div className="section-header">
              <h2>세션</h2>
            </div>
            <p className="meta">번역 상태를 초기화합니다.</p>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (window.confirm('세션을 초기화할까요?')) sendMessage({ type: 'RESET_SESSION' });
              }}
              type="button"
            >
              세션 초기화
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
