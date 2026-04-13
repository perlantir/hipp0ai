import { useState, useEffect, useRef, useCallback } from 'react';

type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';
type EventCallback = (data: unknown) => void;

interface WebSocketEvent {
  event: string;
  data: unknown;
  timestamp: string;
}

export function useWebSocket() {
  const [connected, setConnected] = useState<ConnectionState>('disconnected');
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Set<EventCallback>>>(new Map());
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const getWsUrl = useCallback(() => {
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const wsProtocol = apiUrl.startsWith('https') ? 'wss' : 'ws';
    const host = apiUrl.replace(/^https?:\/\//, '');
    return `${wsProtocol}://${host}/ws`;
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected('connected');
        retryRef.current = 0;
      };

      ws.onmessage = (e) => {
        try {
          const msg: WebSocketEvent = JSON.parse(e.data as string);
          setLastEvent(msg);
          const subs = subscribersRef.current.get(msg.event);
          if (subs) {
            for (const cb of subs) cb(msg.data);
          }
          // Also notify wildcard subscribers
          const wildcardSubs = subscribersRef.current.get('*');
          if (wildcardSubs) {
            for (const cb of wildcardSubs) cb(msg);
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = () => {
        setConnected('reconnecting');
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30000);
        retryRef.current++;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setConnected('disconnected');
    }
  }, [getWsUrl]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((event: string, callback: EventCallback) => {
    if (!subscribersRef.current.has(event)) {
      subscribersRef.current.set(event, new Set());
    }
    subscribersRef.current.get(event)!.add(callback);
    return () => {
      subscribersRef.current.get(event)?.delete(callback);
    };
  }, []);

  return { connected, lastEvent, subscribe };
}
