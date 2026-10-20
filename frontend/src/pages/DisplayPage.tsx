import { useWebSocket } from '../hooks/useWebSocket';
import { useSessionStore } from '../store/sessionStore';
import { useTheme } from '../theme';

export function DisplayPage() {
  useWebSocket('display');

  const { theme, toggleTheme } = useTheme();
  const { session, currentTranscript, translationLines, translationPending } = useSessionStore();

  if (!session) return null;

  return (
    <main className="display-page">
      <header className="display-header">
        <div className="display-title">
          <h1>Live Translator</h1>
        </div>
      </header>

      <section className="display-main" aria-live="polite">
        <div className="caption-stack">
          <div className="original-caption">
            {currentTranscript || <span className="empty">원문 음성을 기다리는 중입니다.</span>}
          </div>
          <div className="translated-caption">
            {translationLines.length || translationPending ? (
              [...translationLines, translationPending].filter(Boolean).slice(-3).map((line, i) => (
                <div key={`${i}-${line}`}>{line}</div>
              ))
            ) : (
              currentTranscript ? '번역 중...' : ''
            )}
          </div>
        </div>
      </section>

      <footer className="display-footer">
        <span>{session.translationEngine === 'deepl' ? 'DeepL' : 'OpenAI Realtime'} 번역</span>
        <button className="btn btn-ghost" onClick={toggleTheme} type="button">
          {theme === 'dark' ? 'Light' : 'Dark'} mode
        </button>
      </footer>
    </main>
  );
}
