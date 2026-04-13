# LangGraph + Hipp0 Example: Research Agent with Memory

A LangGraph agent that persists decisions across sessions using Hipp0 as the checkpoint and memory layer.

## What it does

A research agent that:
1. Receives a research topic
2. Checks Hipp0 for past decisions about that topic
3. Makes new decisions (technology choices, approach decisions)
4. Saves checkpoints to Hipp0 so the next run picks up where it left off

## Setup

```bash
# Start Hipp0 locally
npx @hipp0/cli init research-agent
cd research-agent
source .env

# Install Python deps
pip install langgraph langchain-openai hipp0-memory hipp0-langgraph

# Run
export OPENAI_API_KEY=sk-...
python main.py "What database should we use for our analytics pipeline?"
python main.py "How should we handle real-time data ingestion?"
```

On the second run, the agent already knows the database decision from the first run.

## Environment variables

- `HIPP0_API_URL` - local server URL (set by `hipp0 init`)
- `HIPP0_API_KEY` - API key
- `HIPP0_PROJECT_ID` - project ID
- `OPENAI_API_KEY` - your OpenAI key
