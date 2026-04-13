import type { RelevanceProfile, FreshnessPreference } from './types.js';

export interface RoleTemplate {
  name: string;
  description: string;
  profile: RelevanceProfile;
  notification_context: string;
}

function createProfile(
  weights: Record<string, number>,
  opts: {
    depth?: number;
    freshness?: FreshnessPreference;
    superseded?: boolean;
  } = {},
): RelevanceProfile {
  return {
    weights,
    decision_depth: opts.depth ?? 2,
    freshness_preference: opts.freshness ?? 'balanced',
    include_superseded: opts.superseded ?? false,
  };
}

export const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  builder: {
    name: 'Builder',
    description: 'Implements features and writes code',
    profile: createProfile(
      {
        architecture: 0.9,
        implementation: 1.0,
        api: 0.9,
        database: 0.8,
        testing: 0.7,
        security: 0.6,
        performance: 0.7,
        infrastructure: 0.5,
        design: 0.4,
        product: 0.3,
        documentation: 0.3,
        launch: 0.1,
      },
      { depth: 3, freshness: 'recent_first' },
    ),
    notification_context:
      'Check if your implementation aligns with this change. Code changes may be needed.',
  },

  reviewer: {
    name: 'Reviewer',
    description: 'Reviews code and design decisions',
    profile: createProfile(
      {
        architecture: 0.9,
        implementation: 0.8,
        api: 0.8,
        testing: 0.9,
        security: 0.8,
        performance: 0.7,
        database: 0.6,
        design: 0.5,
        product: 0.4,
        documentation: 0.3,
        infrastructure: 0.3,
        launch: 0.1,
      },
      { depth: 2, freshness: 'validated_first', superseded: true },
    ),
    notification_context: 'Review criteria may have changed. Update your checklist.',
  },

  product: {
    name: 'Product',
    description: 'Defines requirements and priorities',
    profile: createProfile(
      {
        product: 1.0,
        design: 0.8,
        architecture: 0.6,
        api: 0.5,
        launch: 0.7,
        analytics: 0.7,
        testing: 0.3,
        security: 0.4,
        performance: 0.4,
        database: 0.2,
        infrastructure: 0.1,
        implementation: 0.3,
      },
      { depth: 1, freshness: 'balanced' },
    ),
    notification_context: 'Scope or requirements may have shifted. Verify alignment.',
  },

  docs: {
    name: 'Documentation',
    description: 'Writes and maintains documentation',
    profile: createProfile(
      {
        documentation: 1.0,
        api: 0.9,
        architecture: 0.7,
        product: 0.6,
        design: 0.5,
        implementation: 0.4,
        testing: 0.3,
        launch: 0.5,
        security: 0.3,
        database: 0.3,
        performance: 0.2,
        infrastructure: 0.2,
      },
      { depth: 2, freshness: 'balanced', superseded: true },
    ),
    notification_context: 'Documentation may need updating.',
  },

  launch: {
    name: 'Launch',
    description: 'Manages releases and public messaging',
    profile: createProfile(
      {
        launch: 1.0,
        product: 0.8,
        documentation: 0.7,
        design: 0.6,
        analytics: 0.5,
        infrastructure: 0.5,
        testing: 0.4,
        security: 0.4,
        api: 0.3,
        architecture: 0.2,
        implementation: 0.1,
        database: 0.1,
      },
      { depth: 1, freshness: 'recent_first' },
    ),
    notification_context: 'Public messaging may need updating.',
  },

  ops: {
    name: 'Operations',
    description: 'Manages infrastructure and deployment',
    profile: createProfile(
      {
        infrastructure: 1.0,
        performance: 0.9,
        security: 0.8,
        database: 0.7,
        api: 0.5,
        architecture: 0.6,
        testing: 0.4,
        implementation: 0.3,
        documentation: 0.3,
        product: 0.1,
        design: 0.1,
        launch: 0.3,
      },
      { depth: 2, freshness: 'validated_first' },
    ),
    notification_context: 'Infrastructure or deployment may be affected.',
  },

  blockchain: {
    name: 'Blockchain',
    description: 'Smart contracts and on-chain logic',
    profile: createProfile(
      {
        blockchain: 1.0,
        security: 0.9,
        architecture: 0.8,
        testing: 0.8,
        api: 0.6,
        implementation: 0.7,
        database: 0.4,
        performance: 0.6,
        documentation: 0.3,
        product: 0.2,
        design: 0.1,
        infrastructure: 0.5,
      },
      { depth: 3, freshness: 'validated_first' },
    ),
    notification_context:
      'Smart contract or on-chain logic may be affected. Review security implications.',
  },

  challenge: {
    name: 'Challenge',
    description: 'Stress tests ideas and finds flaws',
    profile: createProfile(
      {
        architecture: 0.9,
        security: 0.9,
        testing: 0.9,
        performance: 0.8,
        implementation: 0.7,
        api: 0.6,
        database: 0.6,
        product: 0.5,
        infrastructure: 0.5,
        design: 0.3,
        documentation: 0.2,
        launch: 0.1,
      },
      { depth: 3, freshness: 'balanced', superseded: true },
    ),
    notification_context: 'Assumptions or approach may have changed. Re-evaluate risk.',
  },

  legal: {
    name: 'Legal',
    description: 'Reviews legal, regulatory, and compliance implications',
    profile: createProfile(
      {
        legal: 1.0,
        compliance: 0.9,
        privacy: 0.9,
        security: 0.7,
        gambling: 0.8,
        'prediction-market': 0.8,
        terms: 0.8,
        ip: 0.7,
        trademark: 0.7,
        nda: 0.7,
        gdpr: 0.9,
        ccpa: 0.8,
        cftc: 0.9,
        sec: 0.8,
        coppa: 0.7,
        product: 0.4,
        architecture: 0.3,
        launch: 0.5,
      },
      { depth: 2, freshness: 'balanced' },
    ),
    notification_context: 'Review this change for legal, regulatory, or compliance implications.',
  },

  governor: {
    name: 'Governor',
    description: 'Orchestrates agent team and manages dispatches',
    profile: createProfile(
      {
        product: 0.8,
        architecture: 0.7,
        implementation: 0.5,
        testing: 0.5,
        security: 0.5,
        design: 0.5,
        launch: 0.6,
        documentation: 0.4,
        api: 0.4,
        database: 0.3,
        infrastructure: 0.4,
        performance: 0.4,
        analytics: 0.5,
        legal: 0.2,
        compliance: 0.3,
        gambling: 0.2,
        privacy: 0.2,
      },
      { depth: 2, freshness: 'recent_first' },
    ),
    notification_context: 'Project state has changed. Check impact on active dispatches.',
  },

  architect: {
    name: 'Architect',
    description: 'Designs system architecture and patterns',
    profile: createProfile(
      {
        architecture: 1.0,
        api: 0.9,
        database: 0.8,
        infrastructure: 0.7,
        security: 0.7,
        performance: 0.8,
        implementation: 0.6,
        testing: 0.5,
        product: 0.4,
        design: 0.3,
        documentation: 0.4,
        launch: 0.1,
      },
      { depth: 3, freshness: 'balanced', superseded: true },
    ),
    notification_context: 'System design may be affected. Check architecture alignment.',
  },

  design: {
    name: 'Design',
    description: 'UI/UX design and visual systems',
    profile: createProfile(
      {
        design: 1.0,
        product: 0.8,
        api: 0.5,
        documentation: 0.4,
        architecture: 0.3,
        implementation: 0.3,
        launch: 0.5,
        analytics: 0.4,
        testing: 0.2,
        security: 0.2,
        performance: 0.3,
        database: 0.1,
      },
      { depth: 1, freshness: 'recent_first' },
    ),
    notification_context: 'Design requirements or UX patterns may have changed.',
  },

  qa: {
    name: 'QA',
    description: 'Quality assurance and testing',
    profile: createProfile(
      {
        testing: 1.0,
        api: 0.8,
        implementation: 0.7,
        security: 0.6,
        performance: 0.7,
        architecture: 0.5,
        database: 0.4,
        product: 0.5,
        documentation: 0.3,
        design: 0.3,
        infrastructure: 0.3,
        launch: 0.2,
      },
      { depth: 2, freshness: 'recent_first' },
    ),
    notification_context: 'Test coverage may need updating. Review test plans.',
  },

  devops: {
    name: 'DevOps',
    description: 'CI/CD, deployment, and infrastructure automation',
    profile: createProfile(
      {
        infrastructure: 1.0,
        performance: 0.8,
        security: 0.7,
        testing: 0.6,
        database: 0.6,
        api: 0.5,
        architecture: 0.5,
        implementation: 0.4,
        documentation: 0.3,
        product: 0.1,
        design: 0.1,
        launch: 0.4,
      },
      { depth: 2, freshness: 'validated_first' },
    ),
    notification_context: 'Infrastructure or deployment may be affected.',
  },

  analytics: {
    name: 'Analytics',
    description: 'Data analysis and metrics tracking',
    profile: createProfile(
      {
        analytics: 1.0,
        database: 0.8,
        api: 0.6,
        product: 0.7,
        performance: 0.5,
        architecture: 0.4,
        testing: 0.3,
        security: 0.3,
        implementation: 0.3,
        documentation: 0.4,
        design: 0.2,
        launch: 0.3,
      },
      { depth: 1, freshness: 'recent_first' },
    ),
    notification_context: 'Data models or metrics may have changed. Update analytics.',
  },

  gtm: {
    name: 'Go-to-Market',
    description: 'Marketing, positioning, and go-to-market strategy',
    profile: createProfile(
      {
        launch: 0.9,
        product: 0.9,
        design: 0.6,
        analytics: 0.7,
        documentation: 0.5,
        api: 0.3,
        architecture: 0.2,
        testing: 0.2,
        security: 0.2,
        implementation: 0.1,
        database: 0.1,
        infrastructure: 0.1,
      },
      { depth: 1, freshness: 'recent_first' },
    ),
    notification_context: 'Product positioning or launch timeline may have changed.',
  },

  security: {
    name: 'Security',
    description: 'Security review and compliance',
    profile: createProfile(
      {
        security: 1.0,
        api: 0.8,
        architecture: 0.7,
        database: 0.7,
        infrastructure: 0.7,
        testing: 0.6,
        implementation: 0.5,
        performance: 0.4,
        documentation: 0.3,
        product: 0.2,
        design: 0.1,
        launch: 0.2,
      },
      { depth: 3, freshness: 'validated_first', superseded: true },
    ),
    notification_context: 'Security implications may have changed. Review auth and data exposure.',
  },
};

export const ROLE_NAMES = Object.keys(ROLE_TEMPLATES);

export function getRoleNotificationContext(role: string): string {
  const template = ROLE_TEMPLATES[role];
  return template?.notification_context ?? 'A change has been made that may affect your work.';
}

export function getRoleProfile(
  role: string,
  overrides?: Partial<RelevanceProfile>,
): RelevanceProfile {
  const template = ROLE_TEMPLATES[role];
  const base = template?.profile ?? ROLE_TEMPLATES.builder.profile;
  return {
    ...base,
    ...overrides,
    weights: { ...base.weights, ...overrides?.weights },
  };
}

export function listRoles(): Array<{ name: string; description: string }> {
  return Object.entries(ROLE_TEMPLATES).map(([key, tpl]) => ({
    name: key,
    description: tpl.description,
  }));
}
