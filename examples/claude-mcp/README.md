# Hipp0 MCP Server for Claude

Give Claude persistent decision memory in 2 steps.

## Setup

### 1. Start Hipp0

```bash
npx @hipp0/cli init my-project
cd my-project
source .env
```

### 2. Add to Claude

**Claude Desktop** - Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hipp0": {
      "command": "npx",
      "args": ["@hipp0/mcp@latest"],
      "env": {
        "HIPP0_API_URL": "http://localhost:3100",
        "HIPP0_API_KEY": "YOUR_API_KEY_FROM_STEP_1",
        "HIPP0_PROJECT_ID": "YOUR_PROJECT_ID_FROM_STEP_1"
      }
    }
  }
}
```

**Claude Code** - Add to `.claude/settings.json` or run:

```bash
claude mcp add hipp0 -- npx @hipp0/mcp@latest
```

### 3. Use it

Claude now has 21 tools for decision memory:

- **Record decisions**: "Record that we decided to use PostgreSQL for the database"
- **Get context**: "What decisions have been made about authentication?"
- **Check contradictions**: "Does this contradict any existing decisions?"
- **Track sessions**: "Summarize what we decided in this conversation"

## What Claude can do with Hipp0

| Tool | What it does |
|------|-------------|
| `hipp0_record_decision` | Save a decision with reasoning and tags |
| `hipp0_compile_context` | Get role-specific context for a task |
| `hipp0_list_decisions` | Browse past decisions |
| `hipp0_search_decisions` | Search by text, tags, or agent |
| `hipp0_check_contradictions` | Detect conflicting decisions |
| `hipp0_create_session` | Start a tracked conversation |
| `hipp0_distill` | Extract decisions from a conversation |

## One-liner setup (if Hipp0 is already running)

```bash
# Copy your values from .env
cat .env

# Then add the MCP server to Claude Desktop config
echo '{"mcpServers":{"hipp0":{"command":"npx","args":["@hipp0/mcp@latest"],"env":{"HIPP0_API_URL":"http://localhost:3100","HIPP0_API_KEY":"YOUR_KEY","HIPP0_PROJECT_ID":"YOUR_ID"}}}}' | python3 -m json.tool
```
