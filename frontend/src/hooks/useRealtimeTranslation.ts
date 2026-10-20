import { useCallback, useRef, useState } from 'react';

interface RealtimeSessionResponse {
  clientSecret?: string;
  error?: string;
}

interface UseRealtimeTranslationOptions {
  targetLanguage: string;
  onSourceTranscript: (text: string) => void;
  onTranslation: (original: string, translated: string) => void;
}

export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export function useRealtimeTranslation({
  targetLanguage,
  onSourceTranscript,
  onTranslation,
}: UseRealtimeTranslationOptions) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>('idle');
  const [error, setError] = useState('');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const helloTimerRef = useRef<number | null>(null);
  const sourcePhraseRef = useRef('');
  const sourceTextRef = useRef('');
  const retryCountRef = useRef(0);
  const stoppedRef = useRef(false);
  const connectRef = useRef<((stream: MediaStream, retry?: boolean) => Promise<void>) | null>(null);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    if (helloTimerRef.current) window.clearTimeout(helloTimerRef.current);
    reconnectTimerRef.current = null;
    helloTimerRef.current = null;
    pcRef.current && (pcRef.current.onconnectionstatechange = null);
    pcRef.current?.close();
    pcRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    setConnectionStatus('idle');
  }, []);

  const connect = useCallback(async (stream: MediaStream, retry = false) => {
    stoppedRef.current = false;
    if (!retry) retryCountRef.current = 0;
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    if (pcRef.current) {
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    setIsConnecting(true);
    setIsConnected(false);
    setConnectionStatus(retry ? 'reconnecting' : 'connecting');
    setError('');
    sourcePhraseRef.current = '';
    sourceTextRef.current = '';

    try {
      const sessionResponse = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguage }),
      });
      const session = await sessionResponse.json() as RealtimeSessionResponse;
      if (!sessionResponse.ok || !session.clientSecret) {
        throw new Error(session.error ?? 'Realtime 세션 생성에 실패했습니다.');
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc || stoppedRef.current) return;
        if (pc.connectionState === 'connected') {
          setIsConnected(true);
          setIsConnecting(false);
          setConnectionStatus('connected');
          retryCountRef.current = 0;
          return;
        }
        setIsConnected(false);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setConnectionStatus('reconnecting');
          if (!reconnectTimerRef.current) {
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = null;
              if (pcRef.current !== pc || stoppedRef.current || pc.connectionState === 'connected') return;
              if (retryCountRef.current >= 3) {
                setConnectionStatus('failed');
                setError(`Realtime 연결이 끊겼습니다 (${pc.connectionState}). 캡처를 다시 시작해 주세요.`);
                return;
              }
              retryCountRef.current += 1;
              void connectRef.current?.(stream, true);
            }, pc.connectionState === 'failed' ? 500 : 3000);
          }
        }
      };
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

      const events = pc.createDataChannel('oai-events');
      events.onmessage = ({ data }) => {
        const event = JSON.parse(data as string) as {
          type?: string;
          delta?: string;
          error?: { message?: string; code?: string };
        };
        if (event.type === 'session.input_transcript.delta' && event.delta) {
          sourceTextRef.current += event.delta;
          sourcePhraseRef.current += event.delta;
          onSourceTranscript(sourceTextRef.current);
          if (helloTimerRef.current) window.clearTimeout(helloTimerRef.current);
          helloTimerRef.current = window.setTimeout(() => {
            const phrase = sourcePhraseRef.current.trim().toLowerCase().replace(/[.!?,\s]+/gu, ' ');
            const words = phrase.split(/\s+/u).filter(Boolean);
            if (targetLanguage === 'ko' && words.length > 0 && words.length <= 3 && words.every((word) => word === 'hello' || word === 'hi')) {
              onTranslation(sourceTextRef.current, words.map(() => '안녕하세요.').join(' '));
            }
            sourcePhraseRef.current = '';
            helloTimerRef.current = null;
          }, 1200);
        }
        if (event.type === 'session.output_transcript.delta' && event.delta) {
          if (helloTimerRef.current) window.clearTimeout(helloTimerRef.current);
          helloTimerRef.current = null;
          sourcePhraseRef.current = '';
          onTranslation(sourceTextRef.current, event.delta);
        }
        if (event.type === 'error') {
          const message = event.error?.message ?? event.error?.code ?? 'Realtime 세션 오류';
          setError(message);
          console.error('[realtime] 서버 오류:', event.error);
        }
      };
      events.onerror = () => {
        setError('Realtime 이벤트 채널 오류');
        console.error('[realtime] data channel 오류');
      };
      events.onopen = () => console.log('[realtime] 이벤트 채널 열림');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(
        'https://api.openai.com/v1/realtime/translations/calls',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        }
      );
      if (!sdpResponse.ok) {
        const details = await sdpResponse.text();
        throw new Error(`Realtime SDP 오류 (${sdpResponse.status}): ${details}`);
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setIsConnected(false);
      setIsConnecting(false);
      setConnectionStatus('failed');
      if (pcRef.current) {
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
        pcRef.current = null;
      }
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [onSourceTranscript, onTranslation, targetLanguage]);

  connectRef.current = connect;

  return { connect, stop, isConnecting, isConnected, connectionStatus, error };
}
