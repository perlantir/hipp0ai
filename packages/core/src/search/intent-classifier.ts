export type SearchIntent = 'decision' | 'temporal' | 'entity' | 'general';

interface IntentRule {
  intent: SearchIntent;
  patterns: RegExp[];
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'temporal',
    patterns: [
      /\b(last|this|next)\s+(week|month|quarter|year|sprint)\b/i,
      /\b(in|since|before|after|during)\s+[A-Z][a-z]+(\s+\d{4})?\b/i,
      /\b(yesterday|today|recently|lately|ago)\b/i,
      /\b(when|date|time)\b.*\b(decided|changed|created|updated)\b/i,
    ],
  },
  {
    intent: 'entity',
    patterns: [
      /\b(who is|tell me about|what do we know about)\b/i,
      /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/,
      /\b(person|company|vendor|team|org)\b/i,
    ],
  },
  {
    intent: 'decision',
    patterns: [
      /\b(what was decided|why did we|what's the decision|decision about|decided to)\b/i,
      /\b(rationale|trade.?off|why|because|reason)\b/i,
      /\b(architecture|approach|strategy|policy)\b/i,
    ],
  },
];

export function classifyIntent(query: string): SearchIntent {
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(query))) {
      return rule.intent;
    }
  }
  return 'general';
}
