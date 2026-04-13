#!/usr/bin/env python3
"""
Hipp0 Calibration Seed Script
Reads conversations.json and feeds them to the import API for distillery extraction.

Usage:
    pip install requests
    python3 scripts/seed_decisions.py
"""

import json
import sys
import time
import requests

API_BASE = "http://localhost:3100"
CONVERSATIONS_FILE = "/opt/hipp0/data/conversations.json"
BATCH_SIZE = 3
BATCH_SLEEP = 2
REQUEST_TIMEOUT = 120


def extract_text(conversation):
    """Extract text content from a conversation object, handling multiple formats."""
    # Try different field names for the messages/content
    messages = (
        conversation.get("messages")
        or conversation.get("chat_messages")
        or conversation.get("transcript")
        or conversation.get("conversation")
    )

    if messages is None:
        # Maybe the conversation itself is a string
        if isinstance(conversation, str):
            return conversation
        # Try to just serialize whatever we have
        return json.dumps(conversation, default=str)[:10000]

    if isinstance(messages, str):
        return messages

    parts = []
    for msg in messages:
        role = msg.get("role", msg.get("sender", "unknown"))
        content = msg.get("content", msg.get("text", ""))

        # Handle Claude API format where content is a list of blocks
        if isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict):
                    text_parts.append(block.get("text", block.get("content", "")))
                elif isinstance(block, str):
                    text_parts.append(block)
            content = "\n".join(filter(None, text_parts))

        if content:
            parts.append(f"{role}: {content}")

    return "\n\n".join(parts)


def get_project_id():
    """Fetch the first project ID from the API."""
    try:
        resp = requests.get(f"{API_BASE}/api/projects", timeout=10)
        resp.raise_for_status()
        projects = resp.json()
        if not projects:
            print("ERROR: No projects found. Create a project first.")
            sys.exit(1)
        project_id = projects[0]["id"]
        print(f"Using project: {projects[0].get('name', project_id)} ({project_id})")
        return project_id
    except requests.exceptions.ConnectionError:
        print(f"ERROR: Cannot connect to {API_BASE}. Is the server running?")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR fetching projects: {e}")
        sys.exit(1)


def load_conversations(filepath):
    """Load conversations from JSON file."""
    print(f"Loading conversations from {filepath}...")
    try:
        with open(filepath, "r") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: File not found: {filepath}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in {filepath}: {e}")
        sys.exit(1)

    if isinstance(data, list):
        return data
    elif isinstance(data, dict):
        # Try common wrapper keys
        for key in ["conversations", "data", "items", "results", "messages"]:
            if key in data and isinstance(data[key], list):
                return data[key]
        # Single conversation object
        return [data]
    else:
        print(f"ERROR: Unexpected data type: {type(data)}")
        sys.exit(1)


def main():
    print("=" * 60)
    print("Hipp0 Calibration Seed Script")
    print("=" * 60)
    print()

    # Get project
    project_id = get_project_id()
    print()

    # Load conversations
    conversations = load_conversations(CONVERSATIONS_FILE)
    total = len(conversations)
    print(f"Found {total} conversations")
    print()

    # Estimate time
    num_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    est_minutes = (num_batches * (REQUEST_TIMEOUT / 3 + BATCH_SLEEP)) / 60
    est_fast_minutes = (num_batches * (10 + BATCH_SLEEP)) / 60
    print(f"Batch size: {BATCH_SIZE}")
    print(f"Total batches: {num_batches}")
    print(f"Estimated time: {est_fast_minutes:.0f}–{est_minutes:.0f} minutes")
    print(f"  (depends on distillery LLM response time)")
    print()

    # Confirm
    confirm = input("Start feeding conversations to distillery? [y/N] ").strip().lower()
    if confirm not in ("y", "yes"):
        print("Aborted.")
        sys.exit(0)

    print()
    print("Starting extraction...")
    print("-" * 60)

    total_decisions = 0
    total_errors = 0
    total_skipped = 0
    start_time = time.time()

    for i in range(0, total, BATCH_SIZE):
        batch = conversations[i : i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1

        # Prepare batch payload
        items = []
        for conv in batch:
            text = extract_text(conv)
            if not text or len(text.strip()) < 50:
                total_skipped += 1
                continue
            items.append({
                "type": "conversation",
                "content": text[:50000],  # Cap at 50K chars per conversation
                "source": conv.get("id", conv.get("title", f"conversation-{i}")),
            })

        if not items:
            print(f"  Batch {batch_num}/{num_batches}: skipped (no valid content)")
            continue

        print(f"  Batch {batch_num}/{num_batches}: sending {len(items)} conversations...", end=" ", flush=True)

        try:
            resp = requests.post(
                f"{API_BASE}/api/projects/{project_id}/import",
                json={"items": items},
                timeout=REQUEST_TIMEOUT,
            )

            if resp.status_code == 200:
                result = resp.json()
                extracted = result.get("decisions_created", result.get("extracted", result.get("count", 0)))
                total_decisions += extracted
                print(f"✓ {extracted} decisions extracted (total: {total_decisions})")
            else:
                total_errors += 1
                error_text = resp.text[:200]
                print(f"✗ HTTP {resp.status_code}: {error_text}")

        except requests.exceptions.Timeout:
            total_errors += 1
            print("✗ timeout (120s)")
        except requests.exceptions.ConnectionError:
            total_errors += 1
            print("✗ connection error")
        except Exception as e:
            total_errors += 1
            print(f"✗ error: {e}")

        # Sleep between batches
        if i + BATCH_SIZE < total:
            time.sleep(BATCH_SLEEP)

    elapsed = time.time() - start_time
    print("-" * 60)
    print()
    print(f"Done in {elapsed / 60:.1f} minutes")
    print(f"  Conversations processed: {total}")
    print(f"  Conversations skipped:   {total_skipped}")
    print(f"  Batches with errors:     {total_errors}")
    print(f"  Total decisions extracted: {total_decisions}")


if __name__ == "__main__":
    main()
