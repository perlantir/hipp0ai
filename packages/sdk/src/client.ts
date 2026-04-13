import {
  Hipp0ApiError,
  type Hipp0ClientOptions,
  type Project,
  type CreateProjectInput,
  type Agent,
  type CreateAgentInput,
  type Decision,
  type CreateDecisionInput,
  type UpdateDecisionInput,
  type SupersedeDecisionInput,
  type DecisionListFilters,
  type DecisionEdge,
  type CreateEdgeInput,
  type Artifact,
  type CreateArtifactInput,
  type SessionSummary,
  type CreateSessionInput,
  type Subscription,
  type CreateSubscriptionInput,
  type Notification,
  type CompileContextInput,
  type ContextPackage,
  type DistillInput,
  type DistilleryResult,
  type Contradiction,
  type ResolveContradictionInput,
  type CreateFeedbackInput,
  type RelevanceFeedback,
  type GraphResult,
  type ImpactAnalysis,
  type ProjectStats,
  type AuditEntry,
  type OutcomeResult,
  type ReportOutcomeInput,
  type TaskSession,
  type StartSessionInput,
  type RecordStepInput,
  type SessionState,
  type TeamRelevance,
  type ScoreTeamInput,
  type NextAgentSuggestion,
  type SessionPlan,
  type AcceptSuggestionInput,
  type AcceptSuggestionResult,
  type WhatChangedResponse,
  type DecodedDecision,
  type ConfidenceLevel,
  type SaveBeforeTrimInput,
  type SaveBeforeTrimResult,
  type CaptureInput,
  type CaptureResult,
  type CaptureStatusResult,
} from './types.js';

export class Hipp0Client {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultProjectId?: string;

  constructor(opts: Hipp0ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.defaultProjectId = opts.projectId;
  }

  /** Resolve a project id either from argument or constructor default. */
  private resolveProjectId(override?: string): string {
    const id = override ?? this.defaultProjectId;
    if (!id) {
      throw new Error(
        'project_id is required — pass it to this method or set projectId on the client.',
      );
    }
    return id;
  }

  /**
   * Convenience wrapper around compileContext that uses the default project id
   * configured on the client. Returns the raw response so callers can read
   * formatted_markdown or decisions directly.
   */
  compile(input: {
    agent_name: string;
    task_description: string;
    project_id?: string;
    max_tokens?: number;
    namespace?: string;
    format?: 'json' | 'h0c' | 'markdown' | 'condensed' | 'both';
  }): Promise<ContextPackage> {
    return this.compileContext({
      agent_name: input.agent_name,
      task_description: input.task_description,
      project_id: this.resolveProjectId(input.project_id),
      max_tokens: input.max_tokens,
      namespace: input.namespace,
      format: input.format ?? 'markdown',
    });
  }

  /**
   * Convenience wrapper around /api/capture for fire-and-forget auto-capture
   * of conversations or arbitrary content snippets.
   */
  capture(input: {
    agent_name: string;
    content: string;
    project_id?: string;
    session_id?: string;
    source?: string;
  }): Promise<CaptureResult> {
    return this.post<CaptureResult>('/api/capture', {
      agent_name: input.agent_name,
      project_id: this.resolveProjectId(input.project_id),
      content: input.content,
      session_id: input.session_id,
      source: input.source ?? 'auto',
    });
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (queryParams) {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined) search.set(k, String(v));
      }
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    }

    const opts: RequestInit = {
      method,
      headers: this.buildHeaders(),
    };

    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      throw new Hipp0ApiError(`Network error: ${(err as Error).message}`, 'NETWORK_ERROR', 0);
    }

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
      try {
        errorBody = (await res.json()) as typeof errorBody;
      } catch {
        // ignore parse errors
      }
      const code = errorBody.error?.code ?? 'API_ERROR';
      const message = errorBody.error?.message ?? res.statusText;
      throw new Hipp0ApiError(message, code, res.status, errorBody.error?.details);
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as unknown as T;
    }

    return res.json() as Promise<T>;
  }

  private get<T>(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>('GET', path, undefined, queryParams);
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  private delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // Health

  health(): Promise<{ status: string; version: string; timestamp: string }> {
    return this.get('/api/health');
  }

  // Projects

  createProject(input: CreateProjectInput): Promise<Project> {
    return this.post<Project>('/api/projects', input);
  }

  getProject(id: string): Promise<Project> {
    return this.get<Project>(`/api/projects/${id}`);
  }

  // Agents

  createAgent(projectId: string, input: CreateAgentInput): Promise<Agent> {
    return this.post<Agent>(`/api/projects/${projectId}/agents`, input);
  }

  listAgents(projectId: string): Promise<Agent[]> {
    return this.get<Agent[]>(`/api/projects/${projectId}/agents`);
  }

  // Decisions

  createDecision(projectId: string, input: CreateDecisionInput): Promise<Decision> {
    return this.post<Decision>(`/api/projects/${projectId}/decisions`, input);
  }

  getDecision(id: string): Promise<Decision> {
    return this.get<Decision>(`/api/decisions/${id}`);
  }

  listDecisions(projectId: string, filters?: DecisionListFilters): Promise<Decision[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (filters?.status) queryParams.status = filters.status;
    if (filters?.tags?.length) queryParams.tags = filters.tags.join(',');
    if (filters?.made_by) queryParams.made_by = filters.made_by;
    if (filters?.limit !== undefined) queryParams.limit = filters.limit;
    if (filters?.offset !== undefined) queryParams.offset = filters.offset;

    return this.get<Decision[]>(`/api/projects/${projectId}/decisions`, queryParams);
  }

  updateDecision(id: string, input: UpdateDecisionInput): Promise<Decision> {
    return this.patch<Decision>(`/api/decisions/${id}`, input);
  }

  searchDecisions(projectId: string, queryText: string, limit?: number): Promise<Decision[]> {
    return this.post<Decision[]>(`/api/projects/${projectId}/decisions/search`, {
      query: queryText,
      limit,
    });
  }

  supersedeDecision(
    id: string,
    input: SupersedeDecisionInput,
  ): Promise<{ newDecision: Decision; oldDecision: Decision }> {
    return this.post<{ newDecision: Decision; oldDecision: Decision }>(
      `/api/decisions/${id}/supersede`,
      input,
    );
  }

  getGraph(id: string, depth?: number): Promise<GraphResult> {
    return this.get<GraphResult>(
      `/api/decisions/${id}/graph`,
      depth !== undefined ? { depth } : undefined,
    );
  }

  getImpact(id: string): Promise<ImpactAnalysis> {
    return this.get<ImpactAnalysis>(`/api/decisions/${id}/impact`);
  }

  // Edges

  createEdge(decisionId: string, input: CreateEdgeInput): Promise<DecisionEdge> {
    return this.post<DecisionEdge>(`/api/decisions/${decisionId}/edges`, input);
  }

  listEdges(decisionId: string): Promise<DecisionEdge[]> {
    return this.get<DecisionEdge[]>(`/api/decisions/${decisionId}/edges`);
  }

  deleteEdge(edgeId: string): Promise<{ deleted: boolean; id: string }> {
    return this.delete<{ deleted: boolean; id: string }>(`/api/edges/${edgeId}`);
  }

  // Artifacts

  createArtifact(projectId: string, input: CreateArtifactInput): Promise<Artifact> {
    return this.post<Artifact>(`/api/projects/${projectId}/artifacts`, input);
  }

  listArtifacts(projectId: string): Promise<Artifact[]> {
    return this.get<Artifact[]>(`/api/projects/${projectId}/artifacts`);
  }

  // Context Compiler

  compileContext(input: CompileContextInput): Promise<ContextPackage> {
    const { format = 'h0c', namespace, task, ...rest } = input;
    // Map `task` → `task_description` for server compatibility
    const body = {
      ...rest,
      task_description: rest.task_description ?? task,
    };
    const queryParams: Record<string, string | undefined> = { format, namespace };
    return this.request<ContextPackage>('POST', '/api/compile', body, queryParams);
  }

  // Distillery

  distill(projectId: string, input: DistillInput): Promise<DistilleryResult> {
    return this.post<DistilleryResult>(`/api/projects/${projectId}/distill`, input);
  }

  distillSession(
    projectId: string,
    input: DistillInput & { topic?: string },
  ): Promise<DistilleryResult> {
    return this.post<DistilleryResult>(`/api/projects/${projectId}/distill/session`, input);
  }

  // Sessions

  createSession(projectId: string, input: CreateSessionInput): Promise<SessionSummary> {
    return this.post<SessionSummary>(`/api/projects/${projectId}/sessions`, input);
  }

  listSessions(projectId: string): Promise<SessionSummary[]> {
    return this.get<SessionSummary[]>(`/api/projects/${projectId}/sessions`);
  }

  // Notifications

  getNotifications(agentId: string, unreadOnly = false): Promise<Notification[]> {
    return this.get<Notification[]>(
      `/api/agents/${agentId}/notifications`,
      unreadOnly ? { unread: 'true' } : undefined,
    );
  }

  markNotificationRead(notificationId: string): Promise<Notification> {
    return this.patch<Notification>(`/api/notifications/${notificationId}/read`);
  }

  // Subscriptions

  createSubscription(agentId: string, input: CreateSubscriptionInput): Promise<Subscription> {
    return this.post<Subscription>(`/api/agents/${agentId}/subscriptions`, input);
  }

  listSubscriptions(agentId: string): Promise<Subscription[]> {
    return this.get<Subscription[]>(`/api/agents/${agentId}/subscriptions`);
  }

  deleteSubscription(subscriptionId: string): Promise<{ deleted: boolean; id: string }> {
    return this.delete<{ deleted: boolean; id: string }>(`/api/subscriptions/${subscriptionId}`);
  }

  // Contradictions

  getContradictions(
    projectId: string,
    status?: 'unresolved' | 'resolved' | 'dismissed',
  ): Promise<Contradiction[]> {
    return this.get<Contradiction[]>(
      `/api/projects/${projectId}/contradictions`,
      status ? { status } : undefined,
    );
  }

  resolveContradiction(id: string, input: ResolveContradictionInput): Promise<Contradiction> {
    return this.patch<Contradiction>(`/api/contradictions/${id}`, input);
  }

  // Ask Anything

  ask(
    projectId: string,
    question: string,
    agentName?: string,
  ): Promise<{ answer: string; sources: Array<{ id: string; title: string; score: number }>; tokens_used: number }> {
    return this.post('/api/distill/ask', {
      project_id: projectId,
      question,
      agent_name: agentName,
    });
  }

  // Outcomes

  reportOutcome(input: ReportOutcomeInput): Promise<OutcomeResult> {
    return this.post<OutcomeResult>('/api/outcomes', input);
  }

  getAgentOutcomes(agentId: string, limit?: number): Promise<OutcomeResult[]> {
    return this.get<OutcomeResult[]>(
      `/api/agents/${agentId}/outcomes`,
      limit !== undefined ? { limit } : undefined,
    );
  }

  getProjectOutcomeSummary(projectId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/api/projects/${projectId}/outcome-summary`);
  }

  // Feedback

  recordFeedback(input: CreateFeedbackInput): Promise<RelevanceFeedback> {
    return this.post<RelevanceFeedback>('/api/feedback', input);
  }

  // Audit

  getAuditLog(
    projectId: string,
    options?: { event_type?: string; limit?: number },
  ): Promise<AuditEntry[]> {
    return this.get<AuditEntry[]>(
      `/api/projects/${projectId}/audit`,
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  // Stats & Graph

  getProjectStats(projectId: string): Promise<ProjectStats> {
    return this.get<ProjectStats>(`/api/projects/${projectId}/stats`);
  }

  getProjectGraph(projectId: string): Promise<GraphResult> {
    return this.get<GraphResult>(`/api/projects/${projectId}/graph`);
  }

  // Governance

  checkPolicy(params: {
    projectId: string;
    agentName: string;
    plannedAction: string;
  }): Promise<{ compliant: boolean; violations: unknown[]; advisories: unknown[] }> {
    return this.post('/api/policies/check', {
      project_id: params.projectId,
      agent_name: params.agentName,
      planned_action: params.plannedAction,
    });
  }

  getProjectPolicies(projectId: string): Promise<unknown[]> {
    return this.get<unknown[]>(`/api/projects/${projectId}/policies`);
  }

  getProjectViolations(projectId: string, status?: string): Promise<unknown[]> {
    const qs = status ? { status } : undefined;
    return this.get<unknown[]>(
      `/api/projects/${projectId}/violations`,
      qs as Record<string, string | number | boolean | undefined>,
    );
  }

    // Task Sessions (Super Brain Phase 1)

  startSession(params: StartSessionInput): Promise<{ session_id: string; title: string }> {
    return this.post('/api/tasks/session/start', params);
  }

  recordStep(
    sessionId: string,
    params: RecordStepInput,
  ): Promise<{ step_id: string; step_number: number }> {
    return this.post(`/api/tasks/session/${sessionId}/step`, params);
  }

  getSessionState(sessionId: string): Promise<SessionState> {
    return this.get<SessionState>(`/api/tasks/session/${sessionId}/state`);
  }

  listTaskSessions(projectId: string, status?: string): Promise<TaskSession[]> {
    const qs = status ? { status } : undefined;
    return this.get<TaskSession[]>(
      `/api/projects/${projectId}/sessions-live`,
      qs as Record<string, string | number | boolean | undefined>,
    );
  }

  pauseSession(sessionId: string): Promise<TaskSession> {
    return this.post<TaskSession>(`/api/tasks/session/${sessionId}/pause`);
  }

  resumeSession(sessionId: string): Promise<TaskSession> {
    return this.post<TaskSession>(`/api/tasks/session/${sessionId}/resume`);
  }

  completeSession(sessionId: string): Promise<TaskSession> {
    return this.post<TaskSession>(`/api/tasks/session/${sessionId}/complete`);
  }

    // Smart Orchestrator (Super Brain Phase 3)

  suggestNextAgent(sessionId: string): Promise<NextAgentSuggestion> {
    return this.post<NextAgentSuggestion>(`/api/tasks/session/${sessionId}/suggest-next`);
  }

  getSessionPlan(sessionId: string): Promise<SessionPlan> {
    return this.post<SessionPlan>(`/api/tasks/session/${sessionId}/plan`);
  }

  acceptSuggestion(sessionId: string, params: AcceptSuggestionInput): Promise<AcceptSuggestionResult> {
    return this.post<AcceptSuggestionResult>(`/api/tasks/session/${sessionId}/accept-suggestion`, params);
  }

    // Team Scoring (Super Brain Phase 2)

  scoreTeam(params: ScoreTeamInput): Promise<TeamRelevance> {
    return this.post<TeamRelevance>(`/api/projects/${params.projectId}/team-score`, {
      task_description: params.taskDescription,
      session_id: params.sessionId,
    });
  }

    // Context Compression Survival

  saveBeforeTrim(params: SaveBeforeTrimInput): Promise<SaveBeforeTrimResult> {
    return this.post<SaveBeforeTrimResult>(
      `/api/tasks/session/${params.session_id}/checkpoint`,
      {
        agent_name: params.agent_name,
        context_summary: params.context_summary,
        important_decisions: params.important_decisions,
      },
    );
  }

    // Temporal Intelligence

  getChanges(projectId: string, since: string): Promise<WhatChangedResponse> {
    return this.get<WhatChangedResponse>('/api/decisions/changes', {
      project_id: projectId,
      since,
    });
  }

    // Passive Decision Capture

  autoCapture(input: CaptureInput): Promise<CaptureResult> {
    return this.post<CaptureResult>('/api/capture', {
      agent_name: input.agent_name,
      project_id: input.project_id,
      conversation: input.conversation,
      session_id: input.session_id,
      source: input.source,
    });
  }

  getCaptureStatus(captureId: string): Promise<CaptureStatusResult> {
    return this.get<CaptureStatusResult>(`/api/capture/${captureId}`);
  }

    // H0C Decode Utility

  /**
   * Parse an H0C-encoded string back to decision objects.
   * Works entirely client-side — no network call.
   */
  static decodeH0C(h0c: string): DecodedDecision[] {
    if (!h0c || h0c.trim().length === 0) return [];

    const lines = h0c.split('\n');
    const tagMap = new Map<number, string>();
    const decisions: DecodedDecision[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---' || trimmed === '(empty)') continue;
      if (trimmed.startsWith('#H0C')) continue;

      if (trimmed.startsWith('#TAGS:')) {
        const tagPart = trimmed.slice('#TAGS:'.length).trim();
        const entries = tagPart.split(/\s+/);
        for (const entry of entries) {
          const eqIdx = entry.indexOf('=');
          if (eqIdx > 0) {
            const idx = parseInt(entry.slice(0, eqIdx), 10);
            const tag = entry.slice(eqIdx + 1);
            if (!isNaN(idx) && tag) tagMap.set(idx, tag);
          }
        }
        continue;
      }

      const bracketMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (!bracketMatch) continue;

      const meta = bracketMatch[1]!;
      const rest = bracketMatch[2]!;
      const metaParts = meta.split('|');
      const scoreRaw = parseInt(metaParts[0] ?? '0', 10);
      const score = isNaN(scoreRaw) ? 0 : scoreRaw / 100;
      const confStr = metaParts[1]?.trim() ?? 'M';
      const confidence: ConfidenceLevel = confStr === 'H' ? 'high' : confStr === 'M' ? 'medium' : 'low';

      let made_by = '';
      let date = '';
      let namespace: string | undefined;
      for (let i = 2; i < metaParts.length; i++) {
        const part = metaParts[i]!.trim();
        if (part.startsWith('by:')) {
          made_by = part.slice(3);
        } else if (part.startsWith('ns:')) {
          namespace = part.slice(3);
        } else if (i === 2 && !part.startsWith('by:')) {
          made_by = part;
        } else {
          date = part;
        }
      }

      const segments = rest.split('|');
      const title = segments[0]?.trim() ?? '';
      let tags: string[] = [];
      let description = '';
      let reasoning: string | undefined;

      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i]!.trim();
        if (seg.startsWith('g:')) {
          tags = seg.slice(2).split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((idx) => !isNaN(idx))
            .map((idx) => tagMap.get(idx) ?? `tag-${idx}`);
        } else if (seg.startsWith('r:')) {
          reasoning = seg.slice(2).trim();
        } else {
          description = seg;
        }
      }

      decisions.push({ title, score, confidence, made_by, date, tags, description, ...(reasoning ? { reasoning } : {}), ...(namespace ? { namespace } : {}) });
    }

    return decisions;
  }
}
