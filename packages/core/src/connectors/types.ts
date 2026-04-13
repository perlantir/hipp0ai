export interface SourceConnector {
  name: string;
  type: 'directory' | 'api' | 'webhook';
  watch?(config: WatchConfig): AsyncIterable<ConversationChunk>;
  poll?(config: PollConfig): Promise<ConversationChunk[]>;
  handleWebhook?(payload: unknown): ConversationChunk[];
}

export interface ConversationChunk {
  text: string;
  source_id: string;
  agent_name?: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface WatchConfig {
  path: string;
  pattern?: string;
  poll_interval_ms?: number;
}

export interface PollConfig {
  url: string;
  api_key: string;
  since?: Date;
  poll_interval_ms?: number;
}
