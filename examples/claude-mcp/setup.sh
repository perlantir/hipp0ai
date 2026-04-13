#!/bin/bash
# Hipp0 MCP Setup for Claude Desktop
# Reads .env from current directory and adds Hipp0 to Claude's MCP config.
#
# Usage: bash setup.sh

set -e

# Read .env
if [ ! -f .env ]; then
  echo "Error: No .env file found. Run 'npx @hipp0/cli init my-project' first."
  exit 1
fi

source .env

if [ -z "$HIPP0_API_URL" ] || [ -z "$HIPP0_API_KEY" ]; then
  echo "Error: .env missing HIPP0_API_URL or HIPP0_API_KEY"
  exit 1
fi

# Detect OS and config path
if [ "$(uname)" = "Darwin" ]; then
  CONFIG_DIR="$HOME/Library/Application Support/Claude"
else
  CONFIG_DIR="$HOME/.config/Claude"
fi

CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"
mkdir -p "$CONFIG_DIR"

# Build the MCP server entry
HIPP0_MCP=$(cat <<MCPEOF
{
  "command": "npx",
  "args": ["@hipp0/mcp@latest"],
  "env": {
    "HIPP0_API_URL": "$HIPP0_API_URL",
    "HIPP0_API_KEY": "$HIPP0_API_KEY",
    "HIPP0_PROJECT_ID": "${HIPP0_PROJECT_ID:-}"
  }
}
MCPEOF
)

if [ -f "$CONFIG_FILE" ]; then
  # Merge with existing config
  python3 -c "
import json, sys

with open('$CONFIG_FILE') as f:
    config = json.load(f)

config.setdefault('mcpServers', {})
config['mcpServers']['hipp0'] = json.loads('''$HIPP0_MCP''')

with open('$CONFIG_FILE', 'w') as f:
    json.dump(config, f, indent=2)

print('Updated:', '$CONFIG_FILE')
"
else
  # Create new config
  python3 -c "
import json
config = {'mcpServers': {'hipp0': json.loads('''$HIPP0_MCP''')}}
with open('$CONFIG_FILE', 'w') as f:
    json.dump(config, f, indent=2)
print('Created:', '$CONFIG_FILE')
"
fi

echo ""
echo "Hipp0 MCP server added to Claude Desktop!"
echo "Restart Claude Desktop to pick up the changes."
echo ""
echo "  API:     $HIPP0_API_URL"
echo "  Project: ${HIPP0_PROJECT_ID:-not set}"
