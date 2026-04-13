# Review Queue

The review queue holds decisions that require human approval before becoming active in the decision graph. Pending decisions are excluded from context compilation until approved.

## What Triggers Review

A decision enters the review queue when it is created with:
- `status = 'pending'`, or
- `review_status = 'pending_review'`

While pending, the decision:
- Is **not** included in context compilation results
- Does **not** trigger webhooks or contradiction checks
- Does **not** generate embeddings
- Appears in the Review Queue dashboard view with a badge count

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:id/review-queue` | List all decisions pending review |
| `POST` | `/api/decisions/:id/approve` | Approve a pending decision |
| `POST` | `/api/decisions/:id/reject` | Reject a pending decision |

## Approve Flow

```bash
curl -X POST http://localhost:3100/api/decisions/<DECISION_ID>/approve \
  -H "Authorization: Bearer <API_KEY>"
```

Approval triggers all normally-deferred creation side-effects:

1. Sets `status = 'active'` and `review_status = 'approved'`
2. Fires `propagateChange(decision, 'decision_created')` — subscription notifications
3. Dispatches webhooks with `decision_created` event (includes `approved_from_review: true` in data)
4. Runs `checkForContradictions(decision)` — contradiction detection
5. Generates and stores the decision embedding (fire-and-forget)
6. Logs audit event `decision_approved`

## Reject Flow

```bash
curl -X POST http://localhost:3100/api/decisions/<DECISION_ID>/reject \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Conflicts with existing architecture decision" }'
```

Rejection:

1. Sets `status = 'reverted'` and `review_status = 'rejected'`
2. Stores `rejection_reason` in the decision's `metadata`
3. Logs audit event `decision_rejected`
4. Does **not** fire webhooks or notifications

The `reason` field is optional but recommended for audit trails.

## Decision Status Values

| Status | Meaning |
|--------|---------|
| `active` | Live in the graph, included in compilation |
| `superseded` | Replaced by a newer decision |
| `reverted` | Rolled back or rejected |
| `pending` | Awaiting review, excluded from compilation |

## Dashboard

Access the review queue at `#review-queue` in the dashboard. Features include:

- List of all pending decisions with metadata (title, author, tags, created date)
- **Approve** button — activates the decision and triggers all side-effects
- **Reject** button — with optional reason field
- **Edit** — modify the decision before approving
- Badge count in the sidebar showing outstanding review items
