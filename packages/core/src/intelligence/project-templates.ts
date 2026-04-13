/**
 * Project Templates - pre-built starter projects with realistic decisions.
 *
 * When a user creates a new project, they can apply a template to seed
 * 20-30 starter decisions, agents, and tags. Gives a useful first-run
 * experience instead of an empty graph.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

export interface TemplateAgent {
  name: string;
  role: string;
}

export interface TemplateDecision {
  title: string;
  description: string;
  reasoning: string;
  made_by: string;
  tags: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  agents: TemplateAgent[];
  decisions: TemplateDecision[];
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const TEMPLATES: ProjectTemplate[] = [
  // -------------------------------------------------------------------------
  // 1. SaaS Web App
  // -------------------------------------------------------------------------
  {
    id: 'saas-webapp',
    name: 'SaaS Web App',
    description: 'Multi-tenant SaaS platform with auth, dashboard, and billing',
    tags: ['webapp', 'saas', 'typescript'],
    agents: [
      { name: 'architect', role: 'System architect designing the stack' },
      { name: 'backend', role: 'Backend engineer building APIs' },
      { name: 'frontend', role: 'Frontend engineer building the UI' },
      { name: 'security', role: 'Security reviewer' },
      { name: 'devops', role: 'DevOps engineer handling deployment' },
    ],
    decisions: [
      { title: 'Use PostgreSQL with pgvector', description: 'Primary datastore.', reasoning: 'Relational + vector search in one.', made_by: 'architect', tags: ['database', 'infrastructure'], confidence: 'high' },
      { title: 'JWT for stateless API auth', description: 'Signed JWTs instead of sessions.', reasoning: 'Stateless enables horizontal scaling.', made_by: 'architect', tags: ['auth', 'api'], confidence: 'high' },
      { title: 'Refresh tokens in HTTP-only cookies', description: 'Server-managed refresh tokens.', reasoning: 'Prevents XSS token theft.', made_by: 'security', tags: ['auth', 'security'], confidence: 'high' },
      { title: 'bcrypt cost 12 for passwords', description: 'Industry standard hashing.', reasoning: 'Resistant to GPU attacks.', made_by: 'security', tags: ['auth', 'security'], confidence: 'high' },
      { title: 'Rate limit login to 5/min/IP', description: 'Sliding window rate limit.', reasoning: 'Mitigates brute force.', made_by: 'security', tags: ['auth', 'rate-limit'], confidence: 'high' },
      { title: 'REST API under /v1', description: 'Versioned routes for future breaking changes.', reasoning: 'Allows evolution without breaking clients.', made_by: 'backend', tags: ['api', 'versioning'], confidence: 'high' },
      { title: 'Zod validation on all bodies', description: 'Type-safe request validation.', reasoning: 'Catches bad input at the boundary.', made_by: 'backend', tags: ['api', 'validation'], confidence: 'high' },
      { title: 'Cursor-based pagination', description: 'Opaque cursors instead of offset.', reasoning: 'Stable across inserts, efficient.', made_by: 'backend', tags: ['api', 'performance'], confidence: 'high' },
      { title: 'Redis for session cache', description: 'Hot cache for sessions and rate limits.', reasoning: 'Sub-ms reads.', made_by: 'backend', tags: ['cache', 'performance'], confidence: 'medium' },
      { title: 'React + Vite for dashboard', description: 'Modern tooling.', reasoning: 'Fast HMR, team knows React.', made_by: 'frontend', tags: ['frontend', 'tooling'], confidence: 'high' },
      { title: 'Tailwind CSS for styling', description: 'Utility-first CSS.', reasoning: 'Fast iteration, consistent.', made_by: 'frontend', tags: ['frontend', 'css'], confidence: 'high' },
      { title: 'TanStack Query for server state', description: 'Request cache + optimistic updates.', reasoning: 'Eliminates boilerplate.', made_by: 'frontend', tags: ['frontend', 'state'], confidence: 'high' },
      { title: 'Stripe for subscriptions', description: 'Use Stripe Billing for SaaS plans.', reasoning: 'Handles taxes, invoicing, dunning.', made_by: 'backend', tags: ['billing', 'stripe'], confidence: 'high' },
      { title: 'TypeScript strict mode everywhere', description: 'Catches bugs at compile time.', reasoning: 'Worth the setup cost.', made_by: 'architect', tags: ['tooling'], confidence: 'high' },
      { title: 'Docker Compose for local dev', description: 'Full stack in containers.', reasoning: 'Consistent dev environment.', made_by: 'devops', tags: ['docker', 'devops'], confidence: 'high' },
      { title: 'GitHub Actions for CI/CD', description: 'Automated build, test, deploy.', reasoning: 'Tight GitHub integration.', made_by: 'devops', tags: ['ci', 'devops'], confidence: 'high' },
      { title: 'Deploy to VPS with Docker', description: 'Single-node Docker deployment.', reasoning: 'Simpler than K8s at current scale.', made_by: 'devops', tags: ['deployment', 'docker'], confidence: 'medium' },
      { title: 'Cloudflare for DNS and DDoS', description: 'CF in front of origin.', reasoning: 'Free DDoS + CDN.', made_by: 'devops', tags: ['dns', 'security'], confidence: 'high' },
      { title: 'Structured JSON logging with pino', description: 'Ship to Datadog.', reasoning: 'Machine-parseable logs.', made_by: 'devops', tags: ['logging'], confidence: 'high' },
      { title: 'Vitest for testing', description: 'Unified test runner.', reasoning: 'Fast, ESM-native.', made_by: 'backend', tags: ['testing'], confidence: 'high' },
      { title: 'Audit log for all writes', description: 'Record every mutation.', reasoning: 'Compliance + debugging.', made_by: 'backend', tags: ['audit', 'compliance'], confidence: 'high' },
      { title: 'PostgreSQL backups to S3 every 6h', description: 'Automated pg_dump.', reasoning: 'Reasonable RPO.', made_by: 'devops', tags: ['backup'], confidence: 'high' },
      { title: 'Feature flags via env vars', description: 'Simple boolean flags.', reasoning: 'No external service needed yet.', made_by: 'architect', tags: ['feature-flags'], confidence: 'medium' },
      { title: 'Sentry for error tracking', description: 'Frontend + backend errors.', reasoning: 'Catches prod issues fast.', made_by: 'devops', tags: ['monitoring'], confidence: 'high' },
      { title: '99.9% uptime SLO', description: 'Error budget = 0.1%.', reasoning: 'Balances reliability vs velocity.', made_by: 'devops', tags: ['slo'], confidence: 'medium' },
    ],
  },

  // -------------------------------------------------------------------------
  // 2. ML Pipeline
  // -------------------------------------------------------------------------
  {
    id: 'ml-pipeline',
    name: 'ML Pipeline',
    description: 'Machine learning pipeline with data, training, and serving',
    tags: ['ml', 'python', 'pytorch'],
    agents: [
      { name: 'data_engineer', role: 'Data engineer building pipelines' },
      { name: 'ml_engineer', role: 'ML engineer training models' },
      { name: 'mlops', role: 'MLOps engineer deploying models' },
      { name: 'researcher', role: 'Research scientist evaluating approaches' },
    ],
    decisions: [
      { title: 'Use PyTorch for model training', description: 'Primary ML framework.', reasoning: 'Best ecosystem, research-friendly.', made_by: 'ml_engineer', tags: ['framework', 'pytorch'], confidence: 'high' },
      { title: 'Parquet for feature store', description: 'Columnar format for features.', reasoning: 'Fast analytical reads.', made_by: 'data_engineer', tags: ['storage', 'features'], confidence: 'high' },
      { title: 'MLflow for experiment tracking', description: 'Track runs, params, metrics.', reasoning: 'Open source, UI included.', made_by: 'ml_engineer', tags: ['tracking'], confidence: 'high' },
      { title: 'DVC for data versioning', description: 'Version control for large datasets.', reasoning: 'Git-like for data.', made_by: 'data_engineer', tags: ['versioning', 'data'], confidence: 'high' },
      { title: 'Airflow for orchestration', description: 'DAG-based pipeline scheduler.', reasoning: 'Mature, handles dependencies.', made_by: 'data_engineer', tags: ['orchestration'], confidence: 'medium' },
      { title: 'TorchServe for model serving', description: 'Production inference server.', reasoning: 'Native PyTorch, batching support.', made_by: 'mlops', tags: ['serving'], confidence: 'medium' },
      { title: '80/10/10 train/val/test split', description: 'Standard data split.', reasoning: 'Enough val for hyperparams, test for final.', made_by: 'researcher', tags: ['training'], confidence: 'high' },
      { title: 'AdamW optimizer with weight decay', description: 'Default optimizer choice.', reasoning: 'Better than Adam for most transformers.', made_by: 'ml_engineer', tags: ['training', 'optimizer'], confidence: 'high' },
      { title: 'Gradient clipping at norm 1.0', description: 'Prevents exploding gradients.', reasoning: 'Stabilizes training.', made_by: 'ml_engineer', tags: ['training'], confidence: 'high' },
      { title: 'Mixed precision (fp16) training', description: 'Use torch.cuda.amp.', reasoning: '2x speedup, same accuracy.', made_by: 'ml_engineer', tags: ['training', 'performance'], confidence: 'high' },
      { title: 'Wandb for production monitoring', description: 'Track deployed model metrics.', reasoning: 'Detects drift.', made_by: 'mlops', tags: ['monitoring'], confidence: 'medium' },
      { title: 'S3 for model artifacts', description: 'Versioned artifact storage.', reasoning: 'Cheap, reliable.', made_by: 'mlops', tags: ['storage'], confidence: 'high' },
      { title: 'Docker for model packaging', description: 'Container per model version.', reasoning: 'Reproducibility.', made_by: 'mlops', tags: ['packaging'], confidence: 'high' },
      { title: 'A/B test new models in prod', description: '10% traffic to new model first.', reasoning: 'Catch regressions early.', made_by: 'mlops', tags: ['deployment'], confidence: 'high' },
      { title: 'Ray for distributed training', description: 'Multi-GPU with Ray Train.', reasoning: 'Simpler than raw torch DDP.', made_by: 'ml_engineer', tags: ['distributed'], confidence: 'medium' },
      { title: 'Pytest + property-based testing', description: 'Hypothesis for edge cases.', reasoning: 'Catches bugs random tests miss.', made_by: 'ml_engineer', tags: ['testing'], confidence: 'high' },
      { title: 'Feature drift monitoring', description: 'Track input distribution changes.', reasoning: 'Early warning before accuracy drops.', made_by: 'mlops', tags: ['monitoring'], confidence: 'high' },
      { title: 'Model card for each release', description: 'Document training data, biases, metrics.', reasoning: 'Responsible ML practice.', made_by: 'researcher', tags: ['documentation'], confidence: 'high' },
      { title: 'Rolling retraining weekly', description: 'Retrain on new data every week.', reasoning: 'Keeps model fresh.', made_by: 'mlops', tags: ['training'], confidence: 'medium' },
      { title: 'BentoML for model packaging', description: 'Framework-agnostic serving.', reasoning: 'Supports multiple runtimes.', made_by: 'mlops', tags: ['serving'], confidence: 'medium' },
    ],
  },

  // -------------------------------------------------------------------------
  // 3. Documentation Site
  // -------------------------------------------------------------------------
  {
    id: 'docs-site',
    name: 'Documentation Site',
    description: 'Technical documentation website with search and versioning',
    tags: ['docs', 'nextjs', 'mdx'],
    agents: [
      { name: 'writer', role: 'Technical writer producing content' },
      { name: 'dev', role: 'Developer building the site' },
      { name: 'designer', role: 'Designer creating the look' },
    ],
    decisions: [
      { title: 'Next.js with App Router for docs', description: 'SSR + static generation.', reasoning: 'Fast, SEO-friendly.', made_by: 'dev', tags: ['framework', 'nextjs'], confidence: 'high' },
      { title: 'MDX for content files', description: 'Markdown with React components.', reasoning: 'Rich content + version control.', made_by: 'dev', tags: ['content', 'mdx'], confidence: 'high' },
      { title: 'Algolia DocSearch for search', description: 'Free for open source.', reasoning: 'Best-in-class docs search.', made_by: 'dev', tags: ['search'], confidence: 'high' },
      { title: 'Contentlayer for content pipeline', description: 'Type-safe content loading.', reasoning: 'Compile-time checks.', made_by: 'dev', tags: ['build'], confidence: 'medium' },
      { title: 'Tailwind + Typography plugin', description: 'Prose styling for markdown.', reasoning: 'Great defaults.', made_by: 'designer', tags: ['styling'], confidence: 'high' },
      { title: 'Shiki for syntax highlighting', description: 'VS Code themes.', reasoning: 'Accurate highlighting, themes.', made_by: 'dev', tags: ['code'], confidence: 'high' },
      { title: 'OpenGraph images per page', description: 'Auto-generate preview images.', reasoning: 'Better social sharing.', made_by: 'designer', tags: ['seo'], confidence: 'medium' },
      { title: 'Table of contents sidebar', description: 'Auto-generate from h2/h3.', reasoning: 'Standard docs UX.', made_by: 'designer', tags: ['navigation'], confidence: 'high' },
      { title: 'Dark mode support', description: 'Theme toggle with system default.', reasoning: 'Developer preference.', made_by: 'designer', tags: ['theming'], confidence: 'high' },
      { title: 'Version dropdown for API docs', description: 'Switch between v1, v2, etc.', reasoning: 'Users on old versions need access.', made_by: 'writer', tags: ['versioning'], confidence: 'high' },
      { title: 'Vercel for hosting', description: 'Zero-config Next.js deploys.', reasoning: 'Built by same team.', made_by: 'dev', tags: ['deployment'], confidence: 'high' },
      { title: 'Analytics via Plausible', description: 'Privacy-friendly analytics.', reasoning: 'No cookies, GDPR-safe.', made_by: 'dev', tags: ['analytics'], confidence: 'high' },
      { title: 'Edit on GitHub link per page', description: 'Direct edit path from docs.', reasoning: 'Encourages community contributions.', made_by: 'writer', tags: ['community'], confidence: 'high' },
      { title: 'Feedback widget per page', description: 'Thumbs up/down + comment.', reasoning: 'Know which pages are unhelpful.', made_by: 'writer', tags: ['feedback'], confidence: 'medium' },
      { title: 'Automated screenshot tests', description: 'Playwright visual regression.', reasoning: 'Catch layout breaks.', made_by: 'dev', tags: ['testing'], confidence: 'medium' },
      { title: 'Structured data for SEO', description: 'JSON-LD for each page.', reasoning: 'Better Google results.', made_by: 'dev', tags: ['seo'], confidence: 'high' },
      { title: 'Sitemap + robots.txt', description: 'Auto-generated from routes.', reasoning: 'Crawling table stakes.', made_by: 'dev', tags: ['seo'], confidence: 'high' },
      { title: 'PR preview deploys', description: 'Vercel auto-deploys every PR.', reasoning: 'Review changes before merge.', made_by: 'dev', tags: ['ci'], confidence: 'high' },
      { title: 'Changelog on /changelog', description: 'Auto-generated from Git tags.', reasoning: 'Users want release history.', made_by: 'writer', tags: ['changelog'], confidence: 'high' },
      { title: 'Code copy button on all snippets', description: 'One-click copy.', reasoning: 'Basic UX expectation.', made_by: 'designer', tags: ['ux'], confidence: 'high' },
    ],
  },

  // -------------------------------------------------------------------------
  // 4. Mobile App
  // -------------------------------------------------------------------------
  {
    id: 'mobile-app',
    name: 'Mobile App',
    description: 'Cross-platform mobile app with React Native',
    tags: ['mobile', 'react-native', 'ios', 'android'],
    agents: [
      { name: 'mobile_lead', role: 'Mobile lead setting direction' },
      { name: 'ios_dev', role: 'iOS developer' },
      { name: 'android_dev', role: 'Android developer' },
      { name: 'backend', role: 'Backend API engineer' },
    ],
    decisions: [
      { title: 'React Native with Expo SDK', description: 'Cross-platform with Expo managed workflow.', reasoning: 'Fastest to ship on both platforms.', made_by: 'mobile_lead', tags: ['framework'], confidence: 'high' },
      { title: 'TypeScript across the app', description: 'Strict mode enabled.', reasoning: 'Catches bugs.', made_by: 'mobile_lead', tags: ['tooling'], confidence: 'high' },
      { title: 'React Navigation for routing', description: 'Stack + bottom tabs pattern.', reasoning: 'De facto standard.', made_by: 'mobile_lead', tags: ['navigation'], confidence: 'high' },
      { title: 'Zustand for state management', description: 'Simple global state.', reasoning: 'Less boilerplate than Redux.', made_by: 'mobile_lead', tags: ['state'], confidence: 'high' },
      { title: 'React Query for server state', description: 'Cache + optimistic updates.', reasoning: 'Eliminates manual fetch logic.', made_by: 'mobile_lead', tags: ['state', 'api'], confidence: 'high' },
      { title: 'Expo Push Notifications', description: 'Cross-platform push.', reasoning: 'Works with APNs + FCM.', made_by: 'mobile_lead', tags: ['notifications'], confidence: 'high' },
      { title: 'AsyncStorage for persistence', description: 'Key-value local storage.', reasoning: 'Simple, built-in.', made_by: 'mobile_lead', tags: ['storage'], confidence: 'medium' },
      { title: 'Biometric auth via expo-local-authentication', description: 'Face ID / Touch ID.', reasoning: 'Better UX than passwords.', made_by: 'ios_dev', tags: ['auth', 'security'], confidence: 'high' },
      { title: 'Sentry for crash reporting', description: 'Crash + error tracking.', reasoning: 'Mobile crashes are opaque without it.', made_by: 'mobile_lead', tags: ['monitoring'], confidence: 'high' },
      { title: 'EAS Build for cloud builds', description: 'Managed CI for iOS/Android.', reasoning: 'No local Xcode/Android Studio needed.', made_by: 'mobile_lead', tags: ['ci'], confidence: 'high' },
      { title: 'OTA updates via Expo Updates', description: 'Push JS updates without app store.', reasoning: 'Fast fixes for critical bugs.', made_by: 'mobile_lead', tags: ['deployment'], confidence: 'high' },
      { title: 'TestFlight for iOS beta', description: 'Apple standard beta distribution.', reasoning: 'Required for App Store testing.', made_by: 'ios_dev', tags: ['testing'], confidence: 'high' },
      { title: 'Google Play Internal Testing', description: 'Android beta distribution.', reasoning: 'Fast internal iteration.', made_by: 'android_dev', tags: ['testing'], confidence: 'high' },
      { title: 'Reanimated for gestures', description: 'Native-thread animations.', reasoning: '60fps guaranteed.', made_by: 'mobile_lead', tags: ['ui'], confidence: 'high' },
      { title: 'Tamagui for design system', description: 'Performant cross-platform UI.', reasoning: 'Single codebase, native look.', made_by: 'mobile_lead', tags: ['ui', 'design'], confidence: 'medium' },
      { title: 'Hermes JS engine', description: 'Optimized for React Native.', reasoning: 'Faster startup, smaller bundle.', made_by: 'mobile_lead', tags: ['performance'], confidence: 'high' },
      { title: 'Fastlane for release automation', description: 'Automated store submission.', reasoning: 'Removes manual work.', made_by: 'mobile_lead', tags: ['deployment'], confidence: 'medium' },
      { title: 'i18n with expo-localization', description: 'Multi-language support.', reasoning: 'Required for international.', made_by: 'mobile_lead', tags: ['i18n'], confidence: 'medium' },
      { title: 'Privacy manifest for iOS 17', description: 'Required for App Store.', reasoning: 'Apple enforcement.', made_by: 'ios_dev', tags: ['privacy'], confidence: 'high' },
      { title: 'Deep links via expo-linking', description: 'Universal links + custom schemes.', reasoning: 'Enables sharing and auth flows.', made_by: 'mobile_lead', tags: ['deep-links'], confidence: 'high' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listTemplates(): ProjectTemplate[] {
  return TEMPLATES;
}

export function getTemplate(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export interface ApplyTemplateResult {
  agents_created: number;
  decisions_created: number;
}

export async function applyTemplate(
  projectId: string,
  templateId: string,
): Promise<ApplyTemplateResult> {
  const template = getTemplate(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const db = getDb();
  let agents_created = 0;
  let decisions_created = 0;

  // Insert agents (skip if already exists)
  for (const agent of template.agents) {
    try {
      await db.query(
        `INSERT INTO agents (id, project_id, name, role, relevance_profile, context_budget_tokens)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_id, name) DO NOTHING`,
        [
          randomUUID(),
          projectId,
          agent.name,
          agent.role,
          JSON.stringify({
            weights: {},
            decision_depth: 2,
            freshness_preference: 'balanced',
            include_superseded: false,
          }),
          50000,
        ],
      );
      agents_created++;
    } catch (err) {
      console.warn(
        `[templates] Could not create agent ${agent.name}:`,
        (err as Error).message,
      );
    }
  }

  // Insert decisions
  for (const d of template.decisions) {
    try {
      await db.query(
        `INSERT INTO decisions
         (id, project_id, title, description, reasoning, made_by, source, confidence,
          status, alternatives_considered, affects, tags, assumptions, open_questions,
          dependencies, metadata)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, 'active', '[]', '[]', ?, '[]', '[]', '[]', ?)`,
        [
          randomUUID(),
          projectId,
          d.title,
          d.description,
          d.reasoning,
          d.made_by,
          d.confidence,
          JSON.stringify(d.tags),
          JSON.stringify({ template: templateId }),
        ],
      );
      decisions_created++;
    } catch (err) {
      console.warn(
        `[templates] Could not create decision "${d.title}":`,
        (err as Error).message,
      );
    }
  }

  return { agents_created, decisions_created };
}
