/* ------------------------------------------------------------------ */
/*  Shared types for the Hipp0 dashboard                              */
/* ------------------------------------------------------------------ */

export type DecisionStatus = 'active' | 'superseded' | 'reverted' | 'pending';

export interface Decision {
  id: string;
  title: string;
  description: string;
  reasoning: string;
  status: DecisionStatus;
  tags: string[];
  made_by: string;
  created_at: string;
  alternatives?: string[];
  assumptions?: string[];
  relationships?: Relationship[];
  supersedes?: string;
  superseded_by?: string | null;
  project_id: string;
  validated_at?: string | null;
  validation_source?: string | null;
  confidence?: string;
  metadata?: Record<string, unknown>;
  domain?: string | null;
  category?: string | null;
  priority_level?: number;
  wing?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  temporal_scope?: 'permanent' | 'sprint' | 'experiment' | 'deprecated';
  namespace?: string | null;
}

export interface Relationship {
  target_id: string;
  type: 'depends_on' | 'conflicts_with' | 'relates_to' | 'blocks' | 'supersedes';
  description?: string;
}

export interface Contradiction {
  id: string;
  decision_a_id: string;
  decision_b_id: string;
  decision_a?: Decision;
  decision_b?: Decision;
  similarity_score: number;
  conflict_description: string;
  status: 'unresolved' | 'resolved' | 'dismissed';
  resolution?: string;
  resolved_at?: string;
  detected_at: string;
}

export interface Session {
  id: string;
  agent_name: string;
  topic: string;
  started_at: string;
  ended_at?: string;
  summary?: string;
  decisions_extracted: number;
  decision_ids?: string[];
  assumptions?: string[];
  open_questions?: string[];
  lessons_learned?: string[];
  extraction_confidence?: number;
}

export interface Notification {
  id: string;
  type: 'contradiction' | 'supersession' | 'new_decision' | 'status_change' | 'session_complete';
  urgency: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  role_context?: string;
  read: boolean;
  created_at: string;
  decision_id?: string;
}

export interface ContextResult {
  agent: { name: string; role: string };
  task: string;
  decisions: Array<{
    id: string;
    title: string;
    combined_score: number;
    wing?: string | null;
    [key: string]: unknown;
  }>;
  wing_sources?: Record<string, number>;
}

export interface ImpactResult {
  decision: Decision;
  downstream: Decision[];
  affected_agents: Array<{ name: string; role: string }>;
  blocking: Decision[];
  supersession_chain: Decision[];
}

export interface SearchResult {
  decision: Decision;
  score: number;
  snippet: string;
}

export interface GraphNode {
  id: string;
  title: string;
  status: DecisionStatus;
  tags: string[];
  made_by: string;
  wing?: string | null;
  domain?: string | null;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  description?: string;
}
