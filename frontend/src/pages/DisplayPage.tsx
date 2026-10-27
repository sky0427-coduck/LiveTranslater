import { useWebSocket } from '../hooks/useWebSocket';
import { useSessionStore } from '../store/sessionStore';
import { useTheme } from '../theme';

export function DisplayPage() {
  useWebSocket('display');

  const { theme, toggleTheme } = useTheme();
  const {
    session,
    displayText,
  } = useSessionStore();
  const displayLines = displayText ? displayText.split('\n') : [];

  if (!session) return null;

  return (
    <main className="display-page">
      <section className="display-main" aria-live="polite">
        <div className="caption-stack">
          <div className="translated-caption">
            {displayLines.length ? (
              displayLines.map((line, i) => <div key={`${i}-${line}`}>{line}</div>)
            ) : null}
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
