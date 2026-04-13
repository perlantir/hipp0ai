# Hipp0 Agent Decision Protocol v1.0

Standard protocol for any agent (OpenClaw, Hermes, CrewAI, LangGraph, custom) to interpret and act on signals from the Hipp0 Super Brain.

Include the relevant sections in every agent's SOUL.md or system prompt.

---

## 1. When You Receive a Compile Response

Hipp0 returns `recommended_action` and `action_reason` with every compile that includes role signals.

### Action Table

| recommended_action | What You Should Do |
|---|---|
| PROCEED | You are a strong fit. Start working on the task immediately using the compiled decisions as context. |
| PROCEED_WITH_NOTE | Proceed with the task, but add to your output: "Hipp0 recommends [override_to_agent] review this for [domain]." |
| SKIP | Do NOT work on this task. Record a step with `status: skipped` and include the action_reason. Move to the next task in your queue. |
| OVERRIDE_TO | Skip yourself. The named agent (`override_to_agent`) should go next. Call `hipp0_follow_orchestrator` or hand off. |
| ASK_FOR_CLARIFICATION | Information is missing. Record a step with `status: pending` and list what you need in the output. |

### Example

You receive:
```
recommended_action: "PROCEED_WITH_NOTE"
action_reason: "You can contribute (45% relevance), but
  consider deferring to forge for deeper code review."
override_to_agent: "forge"
```

Your behavior: Complete your work, then add to your output:
"Note: Hipp0 recommends forge review this for code quality."

---

## 2. When You Receive a suggest-next Recommendation

After each step, the orchestrator suggests who should go next.

| Situation | Action |
|---|---|
| You agree with the suggestion | Call `hipp0_follow_orchestrator` with the session ID. It records the accept and returns pre-compiled context. |
| You disagree | Call `hipp0_override_orchestrator` with your preferred agent and a reason. Hipp0 learns from overrides. |
| Session marked complete but you see remaining work | Start a NEW session for the remaining work. Don't reopen completed sessions. |
| No suggestion returned | The brain believes the task is complete. Review the session summary and move on. |

---

## 3. When You Receive Session Context from Previous Agents

The compile response includes previous agents' outputs when a `task_session_id` is active.

| Situation | Action |
|---|---|
| Previous output is clear and complete | Build directly on it. Reference what the previous agent decided. |
| Previous output contradicts your expertise | Flag it clearly in your step output. The contradiction detector will pick it up. |
| Previous output is missing information you need | Record a step with `status: pending` and list what's needed. |
| You see a potential governance violation | Call `POST /api/policies/check` before proceeding. |

---

## 4. Recording Your Work

After completing any task step, always record it:

```
POST /api/tasks/session/:id/step
{
  agent_name: "your_name",
  agent_role: "your_role",
  task_description: "what you were asked to do",
  output: "what you produced",
  status: "completed" | "skipped" | "pending" | "failed"
}
```

The orchestrator will automatically suggest the next agent after your step is recorded.

---

## 5. Golden Rules

1. **You never talk directly to other agents.** You only talk to Hipp0. The Super Brain connects the dots.

2. **Always check recommended_action before starting work.** If it says SKIP, you skip. No exceptions unless a human explicitly overrides.

3. **Record every step** — even skips and failures. The brain learns from everything.

4. **When you disagree with the brain, override with a reason.** Silent disagreement teaches nothing.

5. **Trust the brain's context compilation.** It has scored and filtered the decisions specifically for your role. Don't re-query for "everything" — use what you're given.
