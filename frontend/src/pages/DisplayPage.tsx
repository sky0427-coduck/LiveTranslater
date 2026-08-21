import { useWebSocket } from '../hooks/useWebSocket';
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

export function DisplayPage() {
  useWebSocket('display');

  const { theme, toggleTheme } = useTheme();
  const { session, currentTranscript, currentTranslation } = useSessionStore();

  if (!session) return null;

  const currentTeam = session.teams.find((team) => team.id === session.currentTeamId);

  return (
    <main className="display-page">
      <header className="display-header">
        <div className="display-title">
          <span className="topic-label">TOPIC</span>
          <h1>{session.topic || 'Live Translator'}</h1>
          <p>실시간 통역 디스플레이</p>
        </div>

        {currentTeam && (
          <div className="display-team" style={{ color: currentTeam.color || 'var(--accent)' }}>
            {currentTeam.name}
          </div>
        )}

        <div className="display-timer">{formatTime(session.timer.remainingSeconds)}</div>
      </header>

      <section className="display-main" aria-live="polite">
        <div className="caption-stack">
          <div className="original-caption">
            {currentTranscript || <span className="empty">원문 음성을 기다리는 중입니다.</span>}
          </div>
          <div className="translated-caption">
            {currentTranslation || (currentTranscript ? '번역 중...' : '')}
          </div>
        </div>
      </section>

      <footer className="display-footer">
        <span>{session.translationEngine === 'deepl' ? 'DeepL' : 'OpenAI'} 번역</span>
        <button className="btn btn-ghost" onClick={toggleTheme} type="button">
          {theme === 'dark' ? 'Light' : 'Dark'} mode
        </button>
      </footer>
    </main>
  );
}
