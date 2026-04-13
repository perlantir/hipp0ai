# CrewAI + Hipp0 Example: Software Architecture Team

A 3-agent team that remembers every decision across runs. Uses Hipp0 as the persistent memory layer so agents don't repeat themselves or contradict past decisions.

## What it does

Three agents collaborate on a software project:
- **Architect** - makes high-level design decisions
- **Builder** - implements based on architect's decisions
- **Reviewer** - reviews code against established decisions

Each agent's decisions are captured automatically. On subsequent runs, agents receive only the decisions relevant to their role (scored by Hipp0's 5-signal engine).

## Setup

```bash
# Start Hipp0 locally (one command)
npx @hipp0/cli init arch-team
cd arch-team
source .env

# Install Python deps
pip install crewai hipp0-memory hipp0-crewai

# Run the example
python main.py
```

## What you'll see

1. First run: Architect makes fresh decisions, builder implements from scratch
2. Second run: Builder already knows the architect's past decisions - no re-explaining needed
3. Third run: Reviewer catches contradictions with previous decisions automatically

## Environment variables

Set in `.env` by `hipp0 init`:
- `HIPP0_API_URL` - local server URL
- `HIPP0_API_KEY` - API key
- `HIPP0_PROJECT_ID` - project ID
- `OPENAI_API_KEY` - your OpenAI key (needed for CrewAI)
