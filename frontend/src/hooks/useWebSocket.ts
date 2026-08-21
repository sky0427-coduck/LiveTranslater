import { useCallback, useEffect, useRef } from 'react';
import { ClientMessage, ClientRole, ServerMessage } from '@shared/types';
import { useSessionStore } from '../store/sessionStore';

const WS_URL = 'ws://localhost:3001';
const RECONNECT_DELAY = 2000;

export function useWebSocket(role: ClientRole) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const shouldReconnect = useRef(true);

  const { applyServerMessage, setConnected } = useSessionStore();

  const connect = useCallback(() => {
    const socket = new WebSocket(`${WS_URL}?role=${role}`);
    ws.current = socket;

    socket.onopen = () => {
      console.log('[ws] connected');
      setConnected(true);
    };

    socket.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        applyServerMessage(msg);
      } catch (err) {
        console.error('[ws] failed to parse message:', err);
      }
    };

    socket.onclose = () => {
      console.log(`[ws] disconnected${shouldReconnect.current ? '. reconnecting...' : ''}`);
      setConnected(false);
      if (shouldReconnect.current) {
        reconnectTimer.current = window.setTimeout(connect, RECONNECT_DELAY);
      }
    };

    socket.onerror = (err) => {
      console.error('[ws] error:', err);
    };
  }, [role, applyServerMessage, setConnected]);

  const sendMessage = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
      return;
    }

    console.warn('[ws] cannot send message while disconnected');
  }, []);

  const sendBinary = useCallback((buffer: ArrayBuffer) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(buffer);
    }
  }, []);

  useEffect(() => {
    shouldReconnect.current = true;
    connect();
    return () => {
      shouldReconnect.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  return { sendMessage, sendBinary };
}
