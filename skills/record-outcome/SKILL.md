---
name: record-outcome
version: 1.0.0
description: Record a task outcome signal to close the learning loop.
triggers:
  - task completed
  - user reacts with /retry or error
  - explicit positive confirmation from user
mutating: true
tools: []
---

# Record Outcome

Infer outcome if not explicit:
- **Negative**: /retry command, tool-error rate > 2 in session, user explicitly corrects the agent, user says "that's wrong"
- **Positive**: user confirms ("yes", "exactly", "perfect"), long follow-up continuing the work, user implements the suggestion
- **Neutral**: session ends without clear signal

Post to `POST /api/hermes/outcomes` via the Hermes provider with:
```json
{
  "session_id": "<current session id>",
  "outcome": "positive|negative|neutral",
  "signal_source": "user_feedback|session_end|tool_error",
  "snippet_ids": ["<decision ids that were most relevant to this outcome>"]
}
```
