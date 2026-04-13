# Getting Started with Hipp0

Welcome. This tutorial takes about 10 minutes and walks you from "never heard of Hipp0" to "I have it running locally, I recorded decisions, I compiled context for an agent, and I know where to go next."

No Docker. No database setup. No cloud account. Just `npx` and a terminal.

---

## 1. What is Hipp0? (60 seconds)

AI agents are stateless. They forget. Every time you kick off a new task, the agent starts from zero -- it doesn't remember the database you picked last week, the auth scheme the architect agreed on, or the dead-end approach you already tried and rejected. On a team of agents this is even worse: the builder contradicts the architect, the reviewer re-litigates decisions that were settled days ago, and nobody has the full picture.

Hipp0 is a persistent decision memory system for AI agent teams. Every decision an agent makes -- architecture choices, tool selections, trade-offs, rejected alternatives -- gets captured, scored, and served back as role-differentiated context the next time it's needed. A builder agent asking "how should I implement the data layer?" gets the database decisions first. A frontend agent asking the same question gets UI-relevant context first. Same memory, different views, because different roles care about different things.

```
    Agent 1 --> [Hipp0 Memory] <-- Agent 2
       |              ^              |
       `-- records -->|<-- recalls --'
```

Think of it as a shared hippocampus for your agent team. One API, any framework, any model.

### A few concepts to have in your head

You don't need to memorize these, but knowing they exist will make the rest of the tutorial make sense:

- **Decision** -- an atomic unit of memory. Has a title, reasoning, tags, an author (agent role), and a confidence score. Recorded once, retrieved many times.
- **Agent role** -- a label like `architect`, `builder`, `frontend`, `reviewer`, `security`. Not a specific agent instance -- a role. Hipp0 uses roles to differentiate context.
- **Compile** -- the act of asking Hipp0 "given this task and this role, what past decisions should this agent know about?" Returns a ranked markdown document.
- **5-signal scoring** -- the engine that ranks decisions during compilation. Combines tag overlap, role affinity, recency, confidence, and semantic similarity. Configurable weights.
- **Project** -- a namespace. Every decision belongs to a project. You typically have one project per codebase or per team.

---

## 2. Install (2 minutes)

The fastest way in. This creates a local SQLite database, starts the Hipp0 server on port 3100, creates a project, and writes a `.env` file with your credentials.

```bash
npx @hipp0/cli init my-first-project
cd my-first-project
source .env
```

Here's what each line does:

- `npx @hipp0/cli init my-first-project` -- downloads the CLI, scaffolds a new directory, creates `hipp0.db` (SQLite), starts the local server, creates a project, and writes `.env` with `HIPP0_API_URL`, `HIPP0_API_KEY`, and `HIPP0_PROJECT_ID`.
- `cd my-first-project` -- move into the new directory.
- `source .env` -- export the credentials into your current shell so the `hipp0` CLI knows where to talk and how to authenticate.

![Hipp0 init running](images/getting-started-01-init.png)

*You should see a banner, "Server running on http://localhost:3100", a new project ID printed to the terminal, and a message that `.env` was written. If the port is in use, Hipp0 will pick the next available one and tell you.*

### Verify it's working

```bash
hipp0 status
```

You should see a green check, your project ID, and the server URL. If you see "command not found: hipp0", run `source .env` again, or prefix commands with `npx @hipp0/cli` instead.

---

## 3. Record your first decision (1 minute)

Decisions are the unit of memory in Hipp0. A decision is anything worth remembering -- a choice you made, a tool you picked, a trade-off you weighed, a path you rejected.

```bash
hipp0 add "Use PostgreSQL with pgvector" --by architect --tags database,infrastructure --reason "Need vector search without a separate service"
```

Breaking it down:

- `"Use PostgreSQL with pgvector"` -- the decision title. Keep it short and imperative.
- `--by architect` -- who made the decision. This is the agent role (not a human username). Roles matter because Hipp0 uses them to differentiate context.
- `--tags database,infrastructure` -- comma-separated tags. These drive tag-based matching at compile time.
- `--reason "..."` -- the reasoning behind the decision. This is what other agents will see when they recall it.

![Decision recorded](images/getting-started-02-add.png)

*You should see "Decision recorded" with a decision ID, a confidence score, and the extracted tags. The record took a few milliseconds.*

### Add a few more so context compilation has something to work with

```bash
hipp0 add "JWT for API auth" --by architect --tags auth,api
hipp0 add "React + Vite for dashboard" --by frontend --tags frontend,tooling
hipp0 add "pnpm workspaces for monorepo" --by architect --tags tooling,monorepo
hipp0 add "Zustand for client state" --by frontend --tags frontend,state
```

Five decisions is enough to feel the role-differentiation in the next step. You can list everything you've recorded so far:

```bash
hipp0 list
```

---

## 4. Compile context for an agent (2 minutes)

This is the core trick. When an agent is about to work on a task, you compile a context package for it -- a markdown document containing the past decisions most relevant to that agent and that task, ranked by Hipp0's 5-signal scoring engine.

```bash
hipp0 compile builder "implement the database layer"
```

You'll see a markdown document scroll by. It looks roughly like this:

```markdown
# Context for builder: implement the database layer

## Highly relevant decisions

### Use PostgreSQL with pgvector
- Made by: architect
- Tags: database, infrastructure
- Reasoning: Need vector search without a separate service
- Score: 0.94

### JWT for API auth
- Made by: architect
- Tags: auth, api
- Score: 0.61

## Also consider
- pnpm workspaces for monorepo
```

![Compile output](images/getting-started-03-compile.png)

*The first decision (PostgreSQL) is ranked highest because the task mentions "database" and the decision is tagged `database`. The frontend decisions are deprioritized or filtered out entirely because the builder role rarely consumes them.*

### Now run the same task as a different agent

```bash
hipp0 compile frontend "implement the database layer"
```

The output is *different*. The frontend agent gets a smaller, differently-ranked context -- database decisions are still there (it's a database task after all) but with lower scores, and anything tagged `frontend` or `tooling` that touches the same task gets promoted. This is what "role-differentiated context" means: the same memory, filtered and re-scored through a role-specific lens.

![Different agent different context](images/getting-started-04-roles.png)

*Notice the Score column changes per agent, and some decisions present in the builder output are absent from the frontend output (and vice versa). This is the 5-signal scoring engine at work -- it considers tag overlap, role affinity, recency, confidence, and semantic similarity.*

### Pipe compiled context straight into your agent

```bash
hipp0 compile builder "implement refresh token rotation" > context.md
```

Then read `context.md` into your agent's system prompt, or use the SDK to inject it automatically (see section 6).

---

## 5. Open the dashboard (1 minute)

Everything you just did has a visual counterpart. Open your browser to:

```
http://localhost:3100/dashboard
```

![Dashboard home](images/getting-started-05-dashboard.png)

*You should see your project, a recent activity feed with the five decisions you just recorded, and a left-hand nav with four top-level sections.*

### What each section does

- **Memory -> Decisions** -- a searchable, filterable table of every decision you've recorded. Click a row to see full reasoning, tags, and a provenance trail. This is where you'll spend most of your time browsing.
- **Memory -> Decision Graph** -- an interactive force-directed graph of how decisions relate to one another. Edges represent dependencies ("decision A enables decision B", "decision C contradicts decision D"). Useful for spotting clusters and orphans.
- **Intelligence -> Agent Skills** -- once you have outcome data (success/failure feedback on compiled contexts), this view tells you which agent is empirically best at which domain. Early on it will be empty -- that's expected.
- **Experiments -> What-If Simulator** -- change a past decision, see which future decisions and outcomes would have been affected. Useful before making a big refactor.

Poke around. Click a decision. Open the graph. You won't break anything -- it's your local SQLite database and everything you do is reversible.

---

## 6. Integrate with your agent framework (2 minutes)

The CLI is great for exploration, but in production you want your agents to record and recall decisions without you in the loop. Three main paths depending on your language and framework:

### Python (zero config auto-instrumentation)

```python
import hipp0_memory
hipp0_memory.auto()

# Your existing OpenAI / Anthropic code now auto-captures decisions
# and auto-injects context. No other changes needed.
from openai import OpenAI
client = OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Design the auth layer"}],
)
```

One line (`hipp0_memory.auto()`) monkey-patches the OpenAI and Anthropic SDKs. Every chat completion now automatically captures the conversation for decision extraction and injects relevant past context before each call. Fire-and-forget -- it never blocks or crashes your agent if the server is unreachable.

Reads `HIPP0_API_URL`, `HIPP0_API_KEY`, and `HIPP0_PROJECT_ID` from your environment (which you already set by running `source .env`).

### TypeScript

```typescript
import { auto } from '@hipp0/sdk/auto';
auto();

// Same deal -- your existing code picks up memory
import OpenAI from 'openai';
const client = new OpenAI();
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Design the auth layer' }],
});
```

### CrewAI (explicit callback)

If you're already using a multi-agent framework, you usually want an explicit integration point so you control exactly when decisions are captured. Here's CrewAI:

```python
import os
from crewai import Crew
from hipp0_sdk import Hipp0Client
from hipp0_crewai import Hipp0CrewCallback

client = Hipp0Client()
cb = Hipp0CrewCallback(client=client, project_id=os.environ['HIPP0_PROJECT_ID'])

crew = Crew(
    agents=[architect, builder, reviewer],
    tasks=[design_task, build_task, review_task],
    task_callback=cb.on_task_complete,
)
crew.kickoff()
```

`Hipp0CrewCallback.on_task_complete` runs after every CrewAI task, extracts any decisions that were made, records them under the agent that made them, and makes them available to every subsequent task in the crew.

### LangGraph (checkpointer)

For LangGraph, you plug Hipp0 in as a checkpointer so session state and decisions both live in the same memory layer:

```python
from hipp0_sdk import Hipp0Client
from hipp0_langgraph import Hipp0Checkpointer

client = Hipp0Client()
checkpointer = Hipp0Checkpointer(
    client=client,
    project_id=os.environ['HIPP0_PROJECT_ID'],
    agent_name="orchestrator",
)
app = graph.compile(checkpointer=checkpointer)
```

Similar adapters exist for LangChain (`hipp0-langchain`), AutoGen (`hipp0-autogen`), and OpenAI Agents (`hipp0-openai-agents`). See `docs/framework-guides/` for the full set.

### CLI quick reference

A handful of commands you'll use constantly. All of them assume `source .env` has been run.

| Command | What it does |
|---------|--------------|
| `hipp0 init <name>` | Scaffold a new project, start the server, write `.env` |
| `hipp0 start` | Start the local server (if it isn't already running) |
| `hipp0 status` | Show server status and current project info |
| `hipp0 add "<title>" --by <role> --tags a,b` | Record a decision |
| `hipp0 list` | List all decisions in the current project |
| `hipp0 show <decision-id>` | Print full detail on a single decision |
| `hipp0 compile <role> "<task>"` | Compile ranked context for a role + task |
| `hipp0 search "<query>"` | Full-text search across decisions |
| `hipp0 contradictions` | Find contradictory decisions in the project |
| `hipp0 logs` | Tail server logs |

For the full flag reference on each command, see [CLI](cli.md).

---

## 7. Next steps

You now have enough to be productive. Here's where to go depending on what you want to do next:

- **Try the hosted playground** at [hipp0.ai/playground](https://hipp0.ai/playground). Nothing to install -- it's an ephemeral sandboxed database pre-seeded with 50 decisions across 6 agents and 5 demo scenarios. Good for sharing with teammates or exploring scenarios you haven't built out yet locally.
- **Add Hipp0 to Claude Desktop** -- the MCP server exposes 21 tools (record, compile, search, contradictions, sessions, distill, ...) that Claude can call directly. See [MCP Setup](mcp-setup.md).
- **Understand the scoring engine** -- the 5 signals are tag overlap, role affinity, recency, confidence, and semantic similarity. See [Architecture](architecture.md) for the full breakdown including the weights and how to tune them.
- **Read the API reference** -- every CLI command maps to a REST endpoint. See [API Reference](api-reference.md).
- **Run the benchmarks** -- `npx tsx benchmarks/runner.ts --suite all` runs the full reproducible benchmark suite against your local instance. See [Benchmarks](benchmarks.md).
- **Explore H0C token compression** -- request compiled context with `?format=h0c` or `?format=ultra` to shrink token counts 8x to 33x. See [H0C Format](h0c-format.md).

---

## Troubleshooting common errors

These are the ten things most likely to trip up a new user. Check here first.

### 1. `command not found: hipp0`

You didn't source the `.env` file, or it was sourced in a different shell. Run:

```bash
source .env
```

Or just prefix every command with `npx @hipp0/cli` instead:

```bash
npx @hipp0/cli add "Use PostgreSQL" --by architect --tags database
```

### 2. `ECONNREFUSED 127.0.0.1:3100`

The server isn't running. `hipp0 init` starts it once, but if you closed your terminal or rebooted, restart it:

```bash
hipp0 start
```

You can also run it in the foreground for logs:

```bash
hipp0 start --foreground
```

### 3. `HIPP0_PROJECT_ID not set`

Same root cause as #1 -- you didn't `source .env`. Check with:

```bash
echo $HIPP0_PROJECT_ID
```

If it prints nothing, run `source .env` from your project directory.

### 4. `401 Unauthorized`

Your `HIPP0_API_KEY` is missing, wrong, or stale. If you recreated the project, the old key is invalid. Check that `.env` matches the server's current credentials:

```bash
cat .env | grep HIPP0_API_KEY
```

If it's empty or different from what the server expects, re-run `hipp0 init` or manually set `HIPP0_AUTH_REQUIRED=false` in `.env` for local-dev-only mode.

### 5. `Port 3100 already in use`

Something else is running on port 3100. Either stop it, or start Hipp0 on a different port:

```bash
HIPP0_PORT=3101 hipp0 start
```

Remember to update `HIPP0_API_URL` in `.env` to match.

### 6. `hipp0 compile` returns zero decisions

You haven't recorded any decisions yet, or the role/task combination has no matches. Run `hipp0 list` to confirm decisions exist. If they do, try a broader task description or an agent role that matches one of your recorded `--by` values.

### 7. `SQLITE_BUSY: database is locked`

Two processes are writing to `hipp0.db` at the same time. Usually this means you started the server twice. Check:

```bash
ps aux | grep hipp0
```

Kill the duplicate, then run `hipp0 start` once.

### 8. Dashboard shows "Failed to fetch"

The dashboard is served from the same port as the API (3100). If you see a fetch error in the browser, the API call is failing. Open DevTools, check the Network tab -- a 401 means your dashboard session lost its auth cookie (log in again), and a 500 means check the server logs (`hipp0 logs`).

### 9. `hipp0_memory.auto()` doesn't seem to capture anything

Three things to verify:

1. Your environment has all three env vars set: `HIPP0_API_URL`, `HIPP0_API_KEY`, `HIPP0_PROJECT_ID`. Run `env | grep HIPP0`.
2. `auto()` is called before you import and instantiate the OpenAI/Anthropic client. Order matters because monkey-patching only affects imports that happen after the patch.
3. The server is actually reachable. Auto-instrumentation is fire-and-forget, so failures are silent by design. Enable verbose mode with `HIPP0_DEBUG=true` to see captured events on stderr.

### 10. `docker compose up` says `ANTHROPIC_API_KEY is required`

If you're using the Docker Compose path instead of `npx @hipp0/cli init`, you need to provide an Anthropic API key for the Distillery (the background service that auto-extracts decisions from raw conversations). Copy the example env file and add your key:

```bash
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
docker compose up -d
```

If you're not using Docker, you can ignore this -- the local `npx` path runs everything you need without an Anthropic key for basic decision recording and compilation.

---

## A note on the screenshots

The screenshots in this guide are placeholders. To see the real UI, follow the steps above -- everything runs locally on your machine, so every screen in this tutorial is something you can reach in under 10 minutes. The placeholder paths live in `docs/images/` and will be filled in as the dashboard stabilizes.

If you want to contribute your own screenshots, the convention is `getting-started-NN-description.png` where `NN` is the step number. Pull requests welcome.

---

**Next:** [Architecture](architecture.md) -- the 5-signal scoring engine, the decision graph, and how everything fits together.
