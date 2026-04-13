/**
 * Hipp0 Auto-Instrumentation
 *
 * Zero-config wrapper around the OpenAI / Anthropic SDKs that:
 *   - (optionally) prepends compiled Hipp0 context to every LLM call, and
 *   - (optionally) fires a passive capture of the full conversation back to
 *     Hipp0 after the call resolves.
 *
 * Works even when `openai` or `@anthropic-ai/sdk` is not installed — the
 * patching is wrapped in try/catch and silently skips missing modules.
 *
 * Usage:
 *   import { auto } from '@hipp0/sdk/auto';
 *   auto({ projectId: 'xxxx', agentName: 'myagent' });
 */

import { Hipp0Client } from './client.js';
import { createRequire } from 'node:module';

let _client: Hipp0Client | null = null;
let _projectId = '';
let _agentName = 'auto';
let _enabled = false;

/**
 * ESM-safe module loader. Tries to require() the given module via a runtime
 * createRequire anchored at cwd; returns undefined on any failure.
 */
function safeRequire(moduleName: string): unknown {
  try {
    const req = createRequire(process.cwd() + '/package.json');
    return req(moduleName);
  } catch {
    return undefined;
  }
}

export interface AutoOptions {
  baseUrl?: string;
  apiKey?: string;
  projectId?: string;
  agentName?: string;
  injectContext?: boolean;
  captureConversations?: boolean;
}

/**
 * Initialise auto-instrumentation. Safe to call multiple times; subsequent
 * calls re-patch with the new options.
 */
export function auto(options: AutoOptions = {}): void {
  const baseUrl =
    options.baseUrl ?? process.env.HIPP0_API_URL ?? process.env.HIPP0_URL ?? 'http://localhost:3100';
  const apiKey = options.apiKey ?? process.env.HIPP0_API_KEY ?? '';
  _projectId = options.projectId ?? process.env.HIPP0_PROJECT_ID ?? '';
  _agentName = options.agentName ?? process.env.HIPP0_AGENT_NAME ?? 'auto';

  if (!_projectId) {
    console.warn('[hipp0.auto] HIPP0_PROJECT_ID not set. Auto-capture disabled.');
    return;
  }

  try {
    _client = new Hipp0Client({ baseUrl, apiKey, projectId: _projectId });
    _enabled = true;
    // Use a shortened project id for the log line
    const shortId = _projectId.length > 8 ? `${_projectId.slice(0, 8)}...` : _projectId;
    console.log(`[hipp0.auto] Enabled (project=${shortId})`);
  } catch (err) {
    console.warn('[hipp0.auto] Failed to initialize:', (err as Error).message);
    return;
  }

  const inject = options.injectContext ?? true;
  const capture = options.captureConversations ?? true;

  if (inject || capture) {
    patchOpenAI(inject, capture);
    patchAnthropic(inject, capture);
  }
}

/** Disable auto-instrumentation. Primarily for tests. */
export function autoDisable(): void {
  _enabled = false;
  _client = null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function compileContext(task: string): Promise<string> {
  if (!_enabled || !_client) return '';
  try {
    const result = await _client.compile({
      agent_name: _agentName,
      task_description: task.slice(0, 500),
    });
    const md = (result as unknown as { formatted_markdown?: string }).formatted_markdown ?? '';
    if (md && !md.includes('No relevant decisions')) return md;
  } catch {
    // swallow — auto-instrumentation must never break the LLM call
  }
  return '';
}

function captureAsync(content: string): void {
  if (!_enabled || !_client) return;
  // Fire and forget — never awaited, never throws
  try {
    _client
      .capture({
        agent_name: _agentName,
        content: content.slice(0, 50000),
        source: 'auto',
      })
      .catch(() => {
        /* ignore */
      });
  } catch {
    /* ignore */
  }
}

type ChatMessage = { role: string; content: unknown };

function messagesToText(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const role = typeof msg.role === 'string' ? msg.role : 'unknown';
    const content = msg.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((block) => {
          if (typeof block === 'string') return block;
          if (block && typeof block === 'object') {
            const b = block as { type?: string; text?: string };
            if (b.type === 'text' && typeof b.text === 'string') return b.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    parts.push(`${role.toUpperCase()}: ${text}`);
  }
  return parts.join('\n\n');
}

function extractOpenAICompletionText(response: unknown): string {
  try {
    const r = response as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    };
    const content = r?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((b) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : ''))
        .filter(Boolean)
        .join('\n');
    }
  } catch {
    /* ignore */
  }
  return '';
}

function extractAnthropicCompletionText(response: unknown): string {
  try {
    const r = response as {
      content?: Array<{ type?: string; text?: string }>;
    };
    if (Array.isArray(r?.content)) {
      return r.content
        .map((b) => (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
        .filter(Boolean)
        .join('\n');
    }
  } catch {
    /* ignore */
  }
  return '';
}

/* ------------------------------------------------------------------ */
/*  OpenAI patch                                                       */
/* ------------------------------------------------------------------ */

const OPENAI_PATCHED = Symbol.for('hipp0.auto.openai.patched');

function patchOpenAI(inject: boolean, capture: boolean): void {
  try {
    const mod = safeRequire('openai');
    if (!mod) return;

    const OpenAI =
      (mod as { OpenAI?: unknown; default?: unknown }).OpenAI ??
      (mod as { default?: unknown }).default ??
      mod;

    const proto = (OpenAI as { prototype?: Record<string, unknown> })?.prototype;
    if (!proto) return;

    // Avoid double-patching
    if ((OpenAI as unknown as Record<symbol, unknown>)[OPENAI_PATCHED]) return;
    (OpenAI as unknown as Record<symbol, unknown>)[OPENAI_PATCHED] = true;

    // The OpenAI SDK structure is `client.chat.completions.create(...)`.
    // We lazily wrap the first time `chat` is accessed so that we hook the
    // resource's create method regardless of when it's instantiated.
    const origDescriptor = Object.getOwnPropertyDescriptor(proto, 'chat');

    // In recent versions of the SDK `chat` is defined as a lazy getter.
    // We replace it with a wrapper that calls the original getter then
    // patches completions.create on the returned object.
    if (origDescriptor && typeof origDescriptor.get === 'function') {
      const origGetter = origDescriptor.get;
      Object.defineProperty(proto, 'chat', {
        configurable: true,
        get(this: unknown) {
          const chat = origGetter.call(this);
          try {
            patchChatCompletions(chat, inject, capture);
          } catch {
            /* ignore */
          }
          return chat;
        },
      });
    } else {
      // Fallback: just wrap an instance's `chat` property on each call.
      // This is best-effort for older SDK layouts.
      const origInit = proto.constructor as unknown as ((...args: unknown[]) => unknown) | undefined;
      if (origInit != null) {
        try {
          // Newly constructed clients will be patched via instance access
          proto._hipp0AutoInjectCapture = { inject, capture };
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

function patchChatCompletions(chatResource: unknown, inject: boolean, capture: boolean): void {
  if (!chatResource || typeof chatResource !== 'object') return;
  const completions = (chatResource as { completions?: unknown }).completions;
  if (!completions || typeof completions !== 'object') return;

  const c = completions as Record<string | symbol, unknown>;
  if (c['__hipp0_patched']) return;

  const origCreate = c.create;
  if (typeof origCreate !== 'function') return;

  c['__hipp0_patched'] = true;

  const wrapped = async function (this: unknown, params: unknown, ...rest: unknown[]): Promise<unknown> {
    const args = params as {
      messages?: ChatMessage[];
      stream?: boolean;
    };

    // Inject context as an additional system message
    if (inject && args && Array.isArray(args.messages)) {
      const lastUser = [...args.messages].reverse().find((m) => m.role === 'user');
      const taskText =
        lastUser && typeof lastUser.content === 'string'
          ? lastUser.content
          : messagesToText(args.messages);
      const ctx = await compileContext(taskText);
      if (ctx) {
        args.messages = [
          { role: 'system', content: `# Hipp0 Context\n\n${ctx}` },
          ...args.messages,
        ];
      }
    }

    const response = await (origCreate as (...args: unknown[]) => Promise<unknown>).call(
      this,
      params,
      ...rest,
    );

    // Streams: skip capture (we can't buffer without breaking iterator semantics)
    if (capture && args && !args.stream) {
      try {
        const text = extractOpenAICompletionText(response);
        if (text) {
          const convo =
            messagesToText(args.messages ?? []) + `\n\nASSISTANT: ${text}`;
          captureAsync(convo);
        }
      } catch {
        /* ignore */
      }
    }

    return response;
  };

  c.create = wrapped;
}

/* ------------------------------------------------------------------ */
/*  Anthropic patch                                                    */
/* ------------------------------------------------------------------ */

const ANTHROPIC_PATCHED = Symbol.for('hipp0.auto.anthropic.patched');

function patchAnthropic(inject: boolean, capture: boolean): void {
  try {
    const mod = safeRequire('@anthropic-ai/sdk');
    if (!mod) return;

    const Anthropic =
      (mod as { Anthropic?: unknown; default?: unknown }).Anthropic ??
      (mod as { default?: unknown }).default ??
      mod;

    const proto = (Anthropic as { prototype?: Record<string, unknown> })?.prototype;
    if (!proto) return;

    if ((Anthropic as unknown as Record<symbol, unknown>)[ANTHROPIC_PATCHED]) return;
    (Anthropic as unknown as Record<symbol, unknown>)[ANTHROPIC_PATCHED] = true;

    const origDescriptor = Object.getOwnPropertyDescriptor(proto, 'messages');
    if (origDescriptor && typeof origDescriptor.get === 'function') {
      const origGetter = origDescriptor.get;
      Object.defineProperty(proto, 'messages', {
        configurable: true,
        get(this: unknown) {
          const messages = origGetter.call(this);
          try {
            patchAnthropicMessages(messages, inject, capture);
          } catch {
            /* ignore */
          }
          return messages;
        },
      });
    }
  } catch {
    /* ignore */
  }
}

function patchAnthropicMessages(
  messagesResource: unknown,
  inject: boolean,
  capture: boolean,
): void {
  if (!messagesResource || typeof messagesResource !== 'object') return;
  const m = messagesResource as Record<string | symbol, unknown>;
  if (m['__hipp0_patched']) return;

  const origCreate = m.create;
  if (typeof origCreate !== 'function') return;

  m['__hipp0_patched'] = true;

  const wrapped = async function (this: unknown, params: unknown, ...rest: unknown[]): Promise<unknown> {
    const args = params as {
      messages?: ChatMessage[];
      system?: string | Array<{ type?: string; text?: string }>;
      stream?: boolean;
    };

    if (inject && args && Array.isArray(args.messages)) {
      const lastUser = [...args.messages].reverse().find((msg) => msg.role === 'user');
      const taskText =
        lastUser && typeof lastUser.content === 'string'
          ? lastUser.content
          : messagesToText(args.messages);
      const ctx = await compileContext(taskText);
      if (ctx) {
        const prefix = `# Hipp0 Context\n\n${ctx}\n\n---\n\n`;
        if (typeof args.system === 'string') {
          args.system = prefix + args.system;
        } else if (Array.isArray(args.system)) {
          args.system = [{ type: 'text', text: prefix }, ...args.system];
        } else {
          args.system = prefix;
        }
      }
    }

    const response = await (origCreate as (...args: unknown[]) => Promise<unknown>).call(
      this,
      params,
      ...rest,
    );

    if (capture && args && !args.stream) {
      try {
        const text = extractAnthropicCompletionText(response);
        if (text) {
          const systemLine =
            typeof args.system === 'string' && args.system
              ? `SYSTEM: ${args.system}\n\n`
              : '';
          const convo =
            systemLine +
            messagesToText(args.messages ?? []) +
            `\n\nASSISTANT: ${text}`;
          captureAsync(convo);
        }
      } catch {
        /* ignore */
      }
    }

    return response;
  };

  m.create = wrapped;
}

export default auto;
