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

export function useRealtimeTranslation({
  targetLanguage,
  onSourceTranscript,
  onTranslation,
}: UseRealtimeTranslationOptions) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sourceTextRef = useRef('');
  const translatedTextRef = useRef('');

  const stop = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const connect = useCallback(async (stream: MediaStream) => {
    if (pcRef.current) stop();
    setIsConnecting(true);
    sourceTextRef.current = '';
    translatedTextRef.current = '';

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
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

      const events = pc.createDataChannel('oai-events');
      events.onmessage = ({ data }) => {
        const event = JSON.parse(data as string) as { type?: string; delta?: string };
        if (event.type === 'session.input_transcript.delta' && event.delta) {
          sourceTextRef.current += event.delta;
          onSourceTranscript(sourceTextRef.current);
        }
        if (event.type === 'session.output_transcript.delta' && event.delta) {
          translatedTextRef.current += event.delta;
          onTranslation(sourceTextRef.current, translatedTextRef.current);
        }
      };
      events.onerror = () => console.error('[realtime] data channel 오류');

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
      if (!sdpResponse.ok) throw new Error(await sdpResponse.text());
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
      pc.onconnectionstatechange = () => {
        const connected = pc.connectionState === 'connected';
        setIsConnected(connected);
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') stop();
      };
    } catch (error) {
      stop();
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [onSourceTranscript, onTranslation, stop, targetLanguage]);

  return { connect, stop, isConnecting, isConnected };
}
