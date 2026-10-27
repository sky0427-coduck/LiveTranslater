import { useEffect, useState } from 'react';

interface DisplayTextEvent {
  text: string;
}

type OverlayAlignment = 'left' | 'center' | 'right';

function getOverlayOptions() {
  const params = new URLSearchParams(window.location.search);
  const requestedSize = Number(params.get('fontSize'));
  const fontSize = Number.isFinite(requestedSize)
    ? Math.max(16, Math.min(96, requestedSize))
    : 42;
  const requestedColor = params.get('color') ?? '';
  const color = /^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(requestedColor)
    ? requestedColor
    : '#ffffff';
  const requestedAlign = params.get('align');
  const align: OverlayAlignment = requestedAlign === 'left' || requestedAlign === 'right'
    ? requestedAlign
    : 'center';

  return { fontSize, color, align };
}

export function OverlayPage() {
  const [text, setText] = useState('');
  const { fontSize, color, align } = getOverlayOptions();

  useEffect(() => {
    document.body.classList.add('obs-overlay-active');
    const stream = new EventSource('/api/display/stream');
    stream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DisplayTextEvent;
        if (typeof data.text !== 'string') throw new Error('Invalid display text event');
        setText(data.text);
      } catch (error) {
        console.error('[overlay] 표시 텍스트 이벤트를 읽지 못했습니다:', error);
      }
    };
    stream.onerror = () => console.error('[overlay] 텍스트 스트림 연결 오류');

    return () => {
      document.body.classList.remove('obs-overlay-active');
      stream.close();
    };
  }, []);

  return (
    <main
      className="obs-overlay"
      style={{ fontSize, color, textAlign: align }}
      aria-live="polite"
    >
      {text.split('\n').filter(Boolean).map((line, index) => (
        <div className="obs-overlay-line" key={`${index}-${line}`}>{line}</div>
      ))}
    </main>
  );
}
