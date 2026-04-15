/**
 * PDF and transcript ingestion utilities.
 * Extracts entity mentions and splits transcripts by speaker.
 * No LLM required - pure heuristic text analysis.
 */

export interface IngestResult {
  text_length: number;
  decision_signals_found: number;
  entity_mentions_found: number;
  source_type: 'pdf' | 'transcript';
}

export interface EntityMention {
  name: string;
  type: 'person' | 'company' | 'tool';
}

/**
 * Extract entity mentions from plain text using capitalized noun heuristics.
 */
export function extractEntityMentions(text: string): EntityMention[] {
  const entities: EntityMention[] = [];
  const seen = new Set<string>();

  // Person names: two+ capitalized words
  const personPattern = /\b([A-Z][a-z]+ (?:[A-Z][a-z]+ )*[A-Z][a-z]+)\b/g;
  for (const match of text.matchAll(personPattern)) {
    const name = match[1];
    if (!seen.has(name) && name.length < 50) {
      seen.add(name);
      entities.push({ name, type: 'person' });
    }
  }

  // Companies: words with company suffix indicators
  const companyPattern = /\b([A-Z][A-Za-z0-9]+(?: [A-Z][A-Za-z0-9]+)*(?:\s+(?:Inc|Corp|LLC|Ltd|Labs|AI|Capital|Ventures|Technologies|Systems|Platform|Network))?)\b/g;
  for (const match of text.matchAll(companyPattern)) {
    const name = match[1];
    if (
      !seen.has(name) &&
      name.length < 80 &&
      /Inc|Corp|LLC|Ltd|Labs|AI|Capital|Ventures/.test(name)
    ) {
      seen.add(name);
      entities.push({ name, type: 'company' });
    }
  }

  return entities.slice(0, 20);
}

export interface TranscriptBlock {
  speaker: string;
  text: string;
}

/**
 * Split a meeting transcript by speaker blocks.
 * Expected format: "Speaker Name: text content"
 */
export function splitTranscriptBySpeaker(transcript: string): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const lines = transcript.split('\n');
  let currentSpeaker = '';
  let currentText: string[] = [];

  for (const line of lines) {
    const speakerMatch = line.match(/^([A-Z][a-zA-Z ]+):\s*(.*)$/);
    if (speakerMatch) {
      if (currentSpeaker && currentText.length > 0) {
        blocks.push({ speaker: currentSpeaker, text: currentText.join(' ') });
      }
      currentSpeaker = speakerMatch[1].trim();
      currentText = [speakerMatch[2]];
    } else if (currentSpeaker) {
      currentText.push(line);
    }
  }

  if (currentSpeaker && currentText.length > 0) {
    blocks.push({ speaker: currentSpeaker, text: currentText.join(' ') });
  }

  return blocks;
}
