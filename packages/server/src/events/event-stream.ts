/**
 * Real-Time Memory Event Stream — unified event emitter for Hipp0 memory activity.
 *
 * Dashboards and external tools subscribe to a project's event feed via the
 * `/ws/events` WebSocket endpoint. Each emitted event is fanned out to every
 * subscriber registered for that project_id.
 *
 * Usage:
 *   import { emitEvent } from './events/event-stream.js';
 *   emitEvent({
 *     type: 'decision.created',
 *     project_id,
 *     timestamp: new Date().toISOString(),
 *     data: { decision_id, title },
 *   });
 *
 * All emit calls are fire-and-forget and wrapped in try/catch so they never
 * block or throw into the hot request path.
 */

import { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryEventType =
  | 'decision.created'
  | 'decision.updated'
  | 'decision.superseded'
  | 'contradiction.detected'
  | 'contradiction.resolved'
  | 'outcome.recorded'
  | 'capture.started'
  | 'capture.completed'
  | 'compile.completed'
  | 'skill.updated'
  | 'experiment.started'
  | 'experiment.resolved'
  | 'reflection.completed'
  | 'pattern.detected';

export interface MemoryEvent {
  type: string;
  project_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** project_id → Set<WebSocket> of active subscribers */
const subscribers = new Map<string, Set<WebSocket>>();

/** Max subscribers per project — prevents runaway memory growth */
const MAX_SUBSCRIBERS_PER_PROJECT = 100;

/** Drop payloads for clients whose buffered outbound data exceeds this. */
const WS_BACKPRESSURE_DROP_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Broadcast an event to all WebSocket subscribers of a project.
 * Fire-and-forget — never throws. Disconnected clients are cleaned up
 * opportunistically during iteration.
 */
export function emitEvent(event: MemoryEvent): void {
  try {
    const clients = subscribers.get(event.project_id);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify(event);
    const dead: WebSocket[] = [];
    const sends: Promise<void>[] = [];

    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > WS_BACKPRESSURE_DROP_BYTES) {
          console.warn(
            `[hipp0/events] Dropping event for slow client — bufferedAmount=${ws.bufferedAmount} type=${event.type}`,
          );
          continue;
        }
        try {
          sends.push(
            new Promise<void>((resolve) => {
              ws.send(payload, (err) => {
                if (err) {
                  // Mark dead on send error; cleanup happens after drain
                  dead.push(ws);
                }
                resolve();
              });
            }),
          );
        } catch {
          dead.push(ws);
        }
      } else if (
        ws.readyState === WebSocket.CLOSED ||
        ws.readyState === WebSocket.CLOSING
      ) {
        dead.push(ws);
      }
    }

    // Fan out in parallel — emitEvent is fire-and-forget but Promise.all
    // lets the event loop overlap TCP writes across clients.
    void Promise.all(sends);

    // Clean up any dead sockets encountered
    for (const ws of dead) clients.delete(ws);
    if (clients.size === 0) subscribers.delete(event.project_id);
  } catch (err) {
    // Never propagate errors out of emitEvent
    console.warn('[hipp0:events] emitEvent failed:', (err as Error).message);
  }
}

/**
 * Attach a WebSocket client to a project's event stream.
 * Returns `true` on success, `false` if the project is at the subscriber cap.
 */
export function subscribeToProject(projectId: string, ws: WebSocket): boolean {
  let clients = subscribers.get(projectId);
  if (!clients) {
    clients = new Set();
    subscribers.set(projectId, clients);
  }

  if (clients.size >= MAX_SUBSCRIBERS_PER_PROJECT) {
    return false;
  }

  clients.add(ws);
  return true;
}

/**
 * Remove a WebSocket subscriber from a project's event stream.
 */
export function unsubscribeFromProject(projectId: string, ws: WebSocket): void {
  const clients = subscribers.get(projectId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) subscribers.delete(projectId);
}

/**
 * Return the number of currently-active subscribers for a project.
 */
export function getActiveSubscribers(projectId: string): number {
  const clients = subscribers.get(projectId);
  if (!clients) return 0;

  // Only count clients that are still OPEN
  let count = 0;
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) count++;
  }
  return count;
}

/**
 * Return total subscribers across all projects (useful for metrics/debugging).
 */
export function getTotalSubscribers(): number {
  let total = 0;
  for (const set of subscribers.values()) total += set.size;
  return total;
}

/**
 * Safe convenience helper — fire-and-forget emit that never throws.
 * Automatically stamps `timestamp` if not provided.
 */
export function safeEmit(
  type: MemoryEventType | string,
  projectId: string,
  data: Record<string, unknown>,
): void {
  try {
    emitEvent({
      type,
      project_id: projectId,
      timestamp: new Date().toISOString(),
      data,
    });
  } catch {
    // Swallow — emit path must never break the caller
  }
}
