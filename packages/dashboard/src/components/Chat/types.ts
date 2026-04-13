export interface ToolCallInfo {
  tool_name: string;
  tool_emoji?: string;
  args_preview?: string;
  result_preview?: string;
  status: 'started' | 'completed' | 'error';
  duration_ms?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agent_name?: string;
  timestamp: number;
  tool_calls?: ToolCallInfo[];
  isStreaming?: boolean;
  /** Process metadata for audit trail */
  processData?: MessageProcessData;
}

/** Per-message process data for the audit trail */
export interface MessageProcessData {
  compile?: CompileAuditData;
  toolCalls?: ToolCallInfo[];
  capture?: CaptureAuditData;
  streamEnd?: StreamEndData;
  agentSetup?: AgentSetupData;
}

export interface CompileAuditData {
  decisions_scanned: number;
  decisions_passed: number;
  user_facts_loaded: number;
  top_decisions: Array<{
    title: string;
    score: number;
    freshness: number;
    tier: string;
  }>;
  user_facts: Array<{
    key: string;
    value: string;
    category: string;
  }>;
  context_tokens: number;
  context_budget: number;
  duration_ms: number;
}

export interface CaptureAuditData {
  transcript_tokens: number;
  facts_extracted: number;
  decisions_extracted: number;
  distillery_status: string;
  duration_ms: number;
}

export interface StreamEndData {
  tokens: { input?: number; output?: number; chunks?: number };
  duration_seconds: number;
  cost_estimate_usd?: number;
  model?: string;
}

export interface AgentSetupData {
  agent_name: string;
  model: string;
  provider: string;
  soul_md_tokens: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

// WebSocket protocol messages (server -> client)
export interface WsStreamStart {
  type: 'stream_start';
  conversation_id: string;
  agent_name: string;
  model: string;
}

export interface WsStreamDelta {
  type: 'stream_delta';
  content: string;
}

export interface WsToolCall {
  type: 'tool_call';
  tool_name: string;
  tool_emoji?: string;
  args_preview?: string;
  status: 'started' | 'completed' | 'error';
  result_preview?: string;
  duration_ms?: number;
}

export interface WsStreamEnd {
  type: 'stream_end';
  conversation_id: string;
  tokens: { input?: number; output?: number; chunks?: number };
  duration_seconds: number;
  cost_estimate_usd?: number;
  model?: string;
}

export interface WsError {
  type: 'error';
  message: string;
  recoverable: boolean;
}

export type ProcessingStatus = 'idle' | 'compiling' | 'thinking' | 'capturing';

export interface WsStatusMessage {
  type: 'status';
  status: ProcessingStatus;
}

export interface WsHipp0Event {
  type: 'hipp0_event';
  event: string;
  // compile_done fields
  decisions?: number;
  decisions_scanned?: number;
  decisions_passed?: number;
  user_facts_loaded?: number;
  top_decisions?: Array<{ title: string; score: number; freshness: number; tier: string }>;
  user_facts?: Array<{ key: string; value: string; category: string }>;
  context_tokens?: number;
  context_budget?: number;
  duration_ms?: number;
  // capture_done fields
  transcript_tokens?: number;
  facts_extracted?: number;
  decisions_extracted?: number;
  distillery_status?: string;
  // legacy
  detail?: string;
}

export interface WsAgentSetup {
  type: 'agent_setup';
  agent_name: string;
  model: string;
  provider: string;
  soul_md_tokens: number;
}

export interface ActiveToolCall {
  tool_name: string;
  tool_emoji?: string;
  args_preview?: string;
  result_preview?: string;
  status: 'started' | 'completed' | 'error';
  started_at: number;
  completed_at?: number;
  duration_ms?: number;
}

export interface Hipp0Activity {
  message: string;
  timestamp: number;
}

export type WsServerMessage =
  | WsStreamStart
  | WsStreamDelta
  | WsToolCall
  | WsStreamEnd
  | WsError
  | WsStatusMessage
  | WsHipp0Event
  | WsAgentSetup;

// Agent info from HIPP0 API
export interface AgentInfo {
  name: string;
  agent_id?: string;
  status?: string;
}
