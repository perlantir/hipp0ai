/**
 * Hipp0 Event Stream SDK client — subscribe to real-time memory events.
 *
 * Usage:
 *   import { Hipp0EventStream, type MemoryEvent } from '@hipp0/sdk';
 *
 *   const stream = new Hipp0EventStream({
 *     baseUrl: 'https://api.hipp0.dev',
 *     projectId: '...',
 *     apiKey: 'h0_live_...',
 *   });
 *
 *   stream.connect((event) => {
 *     if (event.type === 'decision.created') {
 *       console.log('New decision:', event.data);
 *     }
 *   });
 *
 *   // Later...
 *   stream.disconnect();
 *
 * The underlying transport is the global `WebSocket` constructor. This is
 * available natively in all modern browsers and in Node.js 22+. Older Node
 * runtimes must polyfill `globalThis.WebSocket` with the `ws` package:
 *
 *   import { WebSocket } from 'ws';
 *   // @ts-expect-error — assign the polyfill
 *   globalThis.WebSocket = WebSocket;
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEvent {
  type: string;
  project_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface Hipp0EventStreamConfig {
  /** Hipp0 API base URL — e.g. https://api.hipp0.dev */
  baseUrl: string;
  /** The project to subscribe to */
  projectId: string;
  /** A valid API key that has access to the project */
  apiKey: string;
}

// Minimal structural type for a WebSocket-like connection. Lets us compile
// cleanly without pulling in DOM lib types in the SDK package.
interface WSLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Simple WebSocket client for Hipp0's real-time event feed.
 *
 * Instantiate with a config object, then call `connect(callback)` to start
 * receiving events. Call `disconnect()` to tear down.
 */
export class Hipp0EventStream {
  private ws?: WSLike;
  private onEventHandler?: (event: MemoryEvent) => void;

  constructor(private readonly config: Hipp0EventStreamConfig) {}

  /**
   * Open the WebSocket connection and register a callback for incoming events.
   * The callback is invoked once per event. Malformed messages are silently
   * ignored so a single bad payload can never break the subscription.
   */
  connect(onEvent: (event: MemoryEvent) => void): void {
    this.onEventHandler = onEvent;

    const wsUrl =
      this.config.baseUrl.replace(/^http/i, 'ws').replace(/\/+$/, '') +
      `/ws/events?project_id=${encodeURIComponent(this.config.projectId)}` +
      `&api_key=${encodeURIComponent(this.config.apiKey)}`;

    const WSCtor = (globalThis as unknown as {
      WebSocket?: new (url: string) => WSLike;
    }).WebSocket;

    if (!WSCtor) {
      throw new Error(
        'Hipp0EventStream: no global WebSocket constructor found. ' +
          'In Node <22 install the `ws` package and assign ' +
          '`globalThis.WebSocket = require("ws").WebSocket` before connecting.',
      );
    }

    const ws = new WSCtor(wsUrl);
    this.ws = ws;

    ws.onmessage = (msg: { data: unknown }) => {
      try {
        const raw = typeof msg.data === 'string' ? msg.data : String(msg.data);
        const parsed = JSON.parse(raw) as MemoryEvent;
        if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
          this.onEventHandler?.(parsed);
        }
      } catch {
        // Ignore malformed messages — never break the subscription
      }
    };

    ws.onerror = () => {
      // No-op: consumers should rely on onclose or reconnection logic
    };

    ws.onclose = () => {
      this.ws = undefined;
    };
  }

  /** Close the WebSocket connection. Safe to call even when not connected. */
  disconnect(): void {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = undefined;
    this.onEventHandler = undefined;
  }

  /** Returns true while the underlying socket is open. */
  isConnected(): boolean {
    // readyState 1 === OPEN in the WHATWG WebSocket spec
    return this.ws?.readyState === 1;
  }
}
