---
name: entity-ingest
version: 1.0.0
description: Ingest a PDF or meeting transcript and extract decisions and entity mentions.
triggers:
  - "ingest this PDF"
  - "process this transcript"
  - user provides a document
mutating: true
tools: [hipp0_auto_capture]
---

# Entity Ingest

## For PDFs
1. Extract text from PDF (use the `/api/ingest/pdf` endpoint).
2. Run signal-detector over the extracted text.
3. Extract entity mentions and call `POST /api/entities` for each notable entity.

## For Meeting Transcripts
1. Split by speaker: `Speaker Name: <text>` blocks.
2. For each speaker block, run signal-detector.
3. Create/update entity page for each speaker (type: 'person').
4. Add a timeline entry to each speaker's page: meeting date and key statements.
5. Capture any decisions made in the meeting.
