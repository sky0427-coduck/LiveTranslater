import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useSessionStore } from '../store/sessionStore';
import { useTheme } from '../theme';

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
  const [timerMinutes, setTimerMinutes] = useState('5');
  const [speakerPickerOpen, setSpeakerPickerOpen] = useState(false);

  const handleAudioChunk = useCallback(
    (samples: Float32Array) => {
      const safeBuffer = new ArrayBuffer(samples.byteLength);
      new Float32Array(safeBuffer).set(samples);
      sendBinary(safeBuffer);
    },
    [sendBinary]
  );

  const audio = useAudioCapture({ onAudioChunk: handleAudioChunk });

  useEffect(() => {
    if (!session) return;
    setTimerMinutes(String(Math.round((session.timer.totalSeconds / 60) * 10) / 10));
  }, [session?.currentTeamId, session?.timer.totalSeconds]);

  const currentTeam = useMemo(
    () => session?.teams.find((team) => team.id === session.currentTeamId),
    [session]
  );

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
                <span className={`dot ${whisperReady ? 'live' : 'warn'}`} />
                Whisper {whisperReady ? '준비됨' : '준비 중'}
              </span>
            </div>
            <ThemeSwitch />
          </div>
        </header>

        <div className="main-stack">
          <section className="panel section">
            <div className="section-header">
              <h2>세션 주제</h2>
              <span className="hint">디스플레이 화면에 표시됩니다</span>
            </div>
            <div className="field">
              <label htmlFor="topic">Topic</label>
              <input
                id="topic"
                className="input"
                type="text"
                defaultValue={session.topic}
                onBlur={(event) => sendMessage({ type: 'SET_TOPIC', payload: { topic: event.target.value } })}
                placeholder="예: 결승 토론 주제"
              />
            </div>
          </section>

          <section className="panel section">
            <div className="section-header">
              <h2>발언 팀</h2>
              <span className="hint">{currentTeam ? `현재 발언: ${currentTeam.name}` : '발언팀 없음'}</span>
            </div>

            <div className="button-row">
              <button className="btn btn-primary" onClick={() => setSpeakerPickerOpen((v) => !v)} type="button">
                발언 팀 변경
              </button>
              {session.currentTeamId && (
                <button className="btn" onClick={() => sendMessage({ type: 'SET_TEAM', payload: { teamId: null } })} type="button">
                  발언팀 해제
                </button>
              )}
            </div>

            {speakerPickerOpen && (
              <div className="team-picker">
                {session.teams.length === 0 ? (
                  <span className="empty">먼저 팀을 추가하세요.</span>
                ) : (
                  session.teams.map((team) => (
                    <button
                      key={team.id}
                      className={`team-row ${session.currentTeamId === team.id ? 'active' : ''}`}
                      onClick={() => {
                        sendMessage({ type: 'SET_TEAM', payload: { teamId: team.id } });
                        setSpeakerPickerOpen(false);
                      }}
                      type="button"
                    >
                      <span className="team-dot" style={{ background: team.color || 'var(--accent)' }} />
                      <span>{team.name}</span>
                      <strong>{formatTime(team.timer.remainingSeconds)}</strong>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

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
                <button className="btn btn-danger" onClick={audio.stopCapture} type="button">
                  캡처 중지
                </button>
              ) : (
                <button className="btn btn-primary" onClick={audio.startCapture} type="button">
                  캡처 시작
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
          <section className="panel section timer-card">
            <div className="section-header">
              <h2>타이머</h2>
              <span className="hint">{session.timer.isRunning ? '진행 중' : '정지'}</span>
            </div>
            <div className="timer-value">{formatTime(session.timer.remainingSeconds)}</div>
            <div className="field compact-field">
              <label htmlFor="timer-minutes">타이머 길이(분)</label>
              <input
                id="timer-minutes"
                className="input"
                min="0.1"
                step="0.5"
                type="number"
                value={timerMinutes}
                onChange={(event) => setTimerMinutes(event.target.value)}
              />
            </div>
            <div className="button-row">
              <button className="btn btn-success" onClick={() => sendMessage({ type: 'TIMER_START' })} type="button">
                시작
              </button>
              <button className="btn" onClick={() => sendMessage({ type: 'TIMER_PAUSE' })} type="button">
                일시정지
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => sendMessage({ type: 'TIMER_RESET', payload: { seconds: minutesToSeconds(timerMinutes) } })}
                type="button"
              >
                시간 적용
              </button>
            </div>
          </section>

          <section className="panel section">
            <div className="section-header">
              <h2>팀 목록</h2>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  const name = window.prompt('추가할 팀 이름을 입력하세요.');
                  if (name?.trim()) {
                    sendMessage({
                      type: 'ADD_TEAM',
                      payload: { name: name.trim(), seconds: minutesToSeconds(timerMinutes) },
                    });
                  }
                }}
                type="button"
              >
                + 팀 추가
              </button>
            </div>
            <div className="team-list">
              {session.teams.length === 0 ? (
                <span className="empty">아직 추가된 팀이 없습니다.</span>
              ) : (
                session.teams.map((team) => (
                  <div key={team.id} className={`team-summary ${session.currentTeamId === team.id ? 'active' : ''}`}>
                    <span className="team-dot" style={{ background: team.color || 'var(--accent)' }} />
                    <span className="team-name">{team.name}</span>
                    <strong>{formatTime(team.timer.remainingSeconds)}</strong>
                    <button
                      className="icon-button"
                      onClick={() => sendMessage({ type: 'REMOVE_TEAM', payload: { teamId: team.id } })}
                      title="팀 삭제"
                      type="button"
                    >
                      x
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

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
                  {engine === 'deepl' ? 'DeepL' : 'OpenAI'}
                </button>
              ))}
            </div>
          </section>

          <section className="panel section">
            <div className="section-header">
              <h2>세션</h2>
            </div>
            <p className="meta">주제, 팀, 타이머, 번역 상태를 초기화합니다.</p>
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
