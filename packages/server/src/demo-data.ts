/**
 * Inlined demo data — no external JSON file dependency.
 * This eliminates the "demo-decisions.json not found" issue in Docker.
 */

export interface DemoAgent {
  name: string;
  role: string;
  desc: string;
}

export interface DemoDecision {
  title: string;
  desc: string;
  reasoning: string;
  alts: string[];
  tags: string[];
  affects: string[];
  confidence: string;
}

export interface DemoData {
  agents: DemoAgent[];
  decisions: DemoDecision[];
}

export const DEMO_DATA: DemoData = {
  "agents": [
    {
      "name": "architect",
      "role": "architect",
      "desc": "System design, scalability, infrastructure, database choices"
    },
    {
      "name": "frontend",
      "role": "builder",
      "desc": "UI, React, CSS, components, user experience, accessibility"
    },
    {
      "name": "backend",
      "role": "builder",
      "desc": "API, database, auth, server, performance, caching"
    },
    {
      "name": "security",
      "role": "reviewer",
      "desc": "Auth, encryption, OWASP, vulnerabilities, access control, secrets"
    },
    {
      "name": "marketer",
      "role": "marketer",
      "desc": "Positioning, launch, pricing, landing page, SEO, messaging"
    },
    {
      "name": "devops",
      "role": "ops",
      "desc": "Deployment, CI/CD, Docker, monitoring, infrastructure, scaling"
    }
  ],
  "decisions": [
    {
      "title": "Use microservices architecture with API gateway",
      "desc": "Break the system into independently deployable services communicating through an API gateway. This enables teams to work autonomously and deploy at different cadences.",
      "reasoning": "Microservices allow independent scaling and deployment. The API gateway provides a unified entry point for clients.",
      "alts": [
        "Monolithic architecture",
        "Modular monolith"
      ],
      "tags": [
        "architecture",
        "scalability",
        "infrastructure"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "PostgreSQL as primary database with pgvector for embeddings",
      "desc": "Use PostgreSQL 17 as the primary datastore with pgvector extension for vector similarity search on decision embeddings.",
      "reasoning": "PostgreSQL is battle-tested for relational data. pgvector avoids a separate vector DB while enabling semantic search.",
      "alts": [
        "MongoDB",
        "Pinecone + PostgreSQL"
      ],
      "tags": [
        "database",
        "architecture",
        "infrastructure"
      ],
      "affects": [
        "architect",
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "Redis for caching with 5-minute TTL",
      "desc": "Deploy Redis as an in-memory cache layer for frequently accessed data like compile results and project stats.",
      "reasoning": "Redis reduces database load for hot paths. 5-minute TTL balances freshness with performance.",
      "alts": [
        "Memcached",
        "In-memory Map"
      ],
      "tags": [
        "caching",
        "performance",
        "infrastructure"
      ],
      "affects": [
        "architect",
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "Event-driven communication between services via NATS",
      "desc": "Use NATS messaging for async communication between microservices instead of direct HTTP calls.",
      "reasoning": "Event-driven architecture decouples services and improves resilience. NATS is lightweight and fast.",
      "alts": [
        "RabbitMQ",
        "Apache Kafka",
        "Direct HTTP calls"
      ],
      "tags": [
        "architecture",
        "messaging",
        "infrastructure"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "medium"
    },
    {
      "title": "GraphQL for client-facing API, REST for internal services",
      "desc": "Expose a GraphQL API for frontend clients while using REST for service-to-service communication internally.",
      "reasoning": "GraphQL lets the frontend request exactly what it needs. REST is simpler for internal services.",
      "alts": [
        "REST for everything",
        "gRPC for internal"
      ],
      "tags": [
        "api",
        "architecture",
        "frontend"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "Monorepo with Turborepo for build orchestration",
      "desc": "Keep all packages in a single monorepo managed by Turborepo for efficient builds and shared dependencies.",
      "reasoning": "Monorepo ensures consistency across packages and simplifies dependency management. Turborepo provides intelligent caching.",
      "alts": [
        "Separate repos per service",
        "Nx",
        "Lerna"
      ],
      "tags": [
        "architecture",
        "tooling",
        "devops"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "WebSocket for real-time dashboard updates",
      "desc": "Use WebSocket connections to push real-time updates to the dashboard instead of polling.",
      "reasoning": "WebSockets eliminate polling overhead and provide instant updates for new decisions and contradictions.",
      "alts": [
        "Server-Sent Events",
        "Long polling"
      ],
      "tags": [
        "architecture",
        "real-time",
        "frontend"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "S3-compatible object storage for file uploads",
      "desc": "Store file uploads and exports in S3-compatible storage for scalability and durability.",
      "reasoning": "S3 provides unlimited storage with high durability. Compatible APIs mean easy migration between providers.",
      "alts": [
        "Local filesystem",
        "Google Cloud Storage"
      ],
      "tags": [
        "infrastructure",
        "storage",
        "architecture"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "Horizontal scaling with stateless application servers",
      "desc": "Design all application servers to be stateless so they can scale horizontally behind a load balancer.",
      "reasoning": "Stateless servers enable auto-scaling and zero-downtime deployments. Session state lives in Redis/DB.",
      "alts": [
        "Vertical scaling",
        "Sticky sessions"
      ],
      "tags": [
        "architecture",
        "scalability",
        "infrastructure"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "Feature flags for gradual rollouts",
      "desc": "Implement feature flags to control feature visibility and enable gradual rollouts to subsets of users.",
      "reasoning": "Feature flags reduce deployment risk and enable A/B testing without code changes.",
      "alts": [
        "Branch-based releases",
        "Environment-based flags"
      ],
      "tags": [
        "architecture",
        "deployment",
        "quality"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "medium"
    },
    {
      "title": "JWT authentication with 15-minute access tokens",
      "desc": "Use short-lived JWT access tokens (15 minutes) for API authentication with automatic refresh.",
      "reasoning": "Short-lived tokens limit the window of exposure if a token is compromised. Refresh tokens handle seamless renewal.",
      "alts": [
        "Session-based auth",
        "Long-lived tokens",
        "OAuth2 opaque tokens"
      ],
      "tags": [
        "security",
        "auth",
        "api"
      ],
      "affects": [
        "backend",
        "frontend",
        "security"
      ],
      "confidence": "high"
    },
    {
      "title": "Refresh token rotation with single-use tokens",
      "desc": "Each refresh token can only be used once. Using it issues a new refresh token and invalidates the old one.",
      "reasoning": "Single-use refresh tokens prevent replay attacks. If a token is stolen, the legitimate user's next refresh will fail and alert them.",
      "alts": [
        "Long-lived refresh tokens",
        "Session-based rotation"
      ],
      "tags": [
        "security",
        "auth"
      ],
      "affects": [
        "backend",
        "frontend",
        "security"
      ],
      "confidence": "high"
    },
    {
      "title": "Row Level Security on all multi-tenant tables",
      "desc": "Enable PostgreSQL Row Level Security policies to enforce tenant isolation at the database level.",
      "reasoning": "RLS provides defense-in-depth. Even if application code has a bug, the database itself prevents cross-tenant data access.",
      "alts": [
        "Application-level filtering only",
        "Separate databases per tenant"
      ],
      "tags": [
        "security",
        "database",
        "multi-tenancy"
      ],
      "affects": [
        "backend",
        "security"
      ],
      "confidence": "high"
    },
    {
      "title": "OWASP Top 10 compliance audit before launch",
      "desc": "Conduct a full OWASP Top 10 security audit covering injection, broken auth, XSS, CSRF, and other common vulnerabilities.",
      "reasoning": "OWASP Top 10 covers the most critical web application security risks. Addressing these before launch prevents common attack vectors.",
      "alts": [
        "Penetration testing only",
        "Bug bounty program"
      ],
      "tags": [
        "security",
        "compliance",
        "quality"
      ],
      "affects": [
        "backend",
        "security"
      ],
      "confidence": "high"
    },
    {
      "title": "Secrets management via environment variables, never in code",
      "desc": "All secrets (API keys, database passwords, signing keys) are stored in environment variables, never committed to source code.",
      "reasoning": "Secrets in code get leaked through git history. Environment variables are the standard for 12-factor apps.",
      "alts": [
        "HashiCorp Vault",
        "AWS Secrets Manager"
      ],
      "tags": [
        "security",
        "devops",
        "infrastructure"
      ],
      "affects": [
        "backend",
        "security"
      ],
      "confidence": "high"
    },
    {
      "title": "Rate limiting: 100 req/min per API key, 10 req/min for auth",
      "desc": "Enforce rate limits on all API endpoints to prevent abuse and protect expensive operations like authentication.",
      "reasoning": "Rate limiting prevents brute force attacks and protects server resources. Auth endpoints need stricter limits.",
      "alts": [
        "No rate limiting",
        "Per-IP limiting only"
      ],
      "tags": [
        "security",
        "api",
        "performance"
      ],
      "affects": [
        "backend",
        "frontend",
        "security"
      ],
      "confidence": "high"
    },
    {
      "title": "CORS restricted to specific origins, no wildcards",
      "desc": "Configure CORS to only allow requests from known frontend origins. Never use wildcard (*) in production.",
      "reasoning": "Wildcard CORS allows any website to make authenticated requests to the API, enabling CSRF-style attacks.",
      "alts": [
        "Wildcard CORS with token validation",
        "Proxy all requests"
      ],
      "tags": [
        "security",
        "api",
        "frontend"
      ],
      "affects": [
        "backend",
        "security"
      ],
      "confidence": "high"
    },
    {
      "title": "React 19 with Server Components for initial page loads",
      "desc": "Use React 19 with Server Components to improve initial page load performance by rendering on the server.",
      "reasoning": "Server Components reduce JavaScript bundle size and improve time-to-first-paint for data-heavy pages.",
      "alts": [
        "Next.js App Router",
        "Astro with React islands"
      ],
      "tags": [
        "frontend",
        "performance",
        "architecture"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Tailwind CSS with custom design tokens, no CSS modules",
      "desc": "Use Tailwind CSS for all styling with a custom theme configuration. No CSS modules or styled-components.",
      "reasoning": "Tailwind provides consistent, utility-first styling that's easy to maintain. Design tokens ensure brand consistency.",
      "alts": [
        "CSS Modules",
        "styled-components",
        "Vanilla Extract"
      ],
      "tags": [
        "frontend",
        "design",
        "tooling"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Shadcn/ui as component library base",
      "desc": "Use Shadcn/ui as the foundation for UI components, customizing as needed rather than building from scratch.",
      "reasoning": "Shadcn/ui provides accessible, well-tested components that can be fully customized. It's copy-paste, not a dependency.",
      "alts": [
        "Radix UI primitives",
        "Material UI",
        "Custom components"
      ],
      "tags": [
        "frontend",
        "design",
        "components"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Dark mode primary, light mode as toggle",
      "desc": "Ship with dark mode as the default theme with a toggle for light mode. Both themes use the same design tokens.",
      "reasoning": "Developer tools are predominantly used in dark mode. Supporting both via CSS variables adds minimal complexity.",
      "alts": [
        "Light mode only",
        "System preference only"
      ],
      "tags": [
        "frontend",
        "design",
        "accessibility"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "medium"
    },
    {
      "title": "Mobile-first responsive design with 768px breakpoint",
      "desc": "Design all pages mobile-first with progressive enhancement for larger screens at the 768px breakpoint.",
      "reasoning": "Mobile-first ensures the core experience works everywhere. Most users will access on desktop but mobile must not break.",
      "alts": [
        "Desktop-first with mobile adaptation",
        "Separate mobile app"
      ],
      "tags": [
        "frontend",
        "design",
        "accessibility"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Framer Motion for page transitions and micro-interactions",
      "desc": "Use Framer Motion for smooth page transitions, loading animations, and micro-interactions throughout the dashboard.",
      "reasoning": "Subtle animations improve perceived performance and make the product feel polished and professional.",
      "alts": [
        "CSS animations only",
        "React Spring",
        "No animations"
      ],
      "tags": [
        "frontend",
        "design",
        "performance"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "medium"
    },
    {
      "title": "React Query for server state, Zustand for client state",
      "desc": "Separate server state management (React Query) from client state (Zustand) for cleaner architecture.",
      "reasoning": "React Query handles caching, refetching, and optimistic updates for server data. Zustand is lightweight for UI state.",
      "alts": [
        "Redux Toolkit",
        "Jotai",
        "SWR + Context"
      ],
      "tags": [
        "frontend",
        "architecture",
        "state-management"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Hono framework for all API routes",
      "desc": "Use the Hono web framework for building API routes. It's fast, TypeScript-native, and works across runtimes.",
      "reasoning": "Hono is the fastest Node.js framework with excellent TypeScript support and middleware ecosystem.",
      "alts": [
        "Express",
        "Fastify",
        "Elysia"
      ],
      "tags": [
        "backend",
        "api",
        "tooling"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "Zod validation on all request bodies",
      "desc": "Validate every API request body with Zod schemas before processing. Reject unknown fields.",
      "reasoning": "Schema validation prevents invalid data from reaching business logic and provides clear error messages.",
      "alts": [
        "Joi",
        "AJV with JSON Schema",
        "Manual validation"
      ],
      "tags": [
        "backend",
        "api",
        "security"
      ],
      "affects": [
        "architect",
        "backend",
        "security"
      ],
      "confidence": "high"
    },
    {
      "title": "Structured JSON logging with correlation IDs",
      "desc": "All server logs are JSON-formatted with timestamps, levels, and correlation IDs that trace requests across services.",
      "reasoning": "Structured logs enable machine parsing and searching. Correlation IDs make debugging distributed requests possible.",
      "alts": [
        "Plain text logs",
        "Pino",
        "Winston"
      ],
      "tags": [
        "backend",
        "observability",
        "devops"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "Database connection pooling with PgBouncer",
      "desc": "Use PgBouncer for database connection pooling to handle high concurrency without exhausting PostgreSQL connections.",
      "reasoning": "PostgreSQL has a hard connection limit. PgBouncer multiplexes hundreds of app connections over a small pool.",
      "alts": [
        "Built-in pg pool",
        "pgcat"
      ],
      "tags": [
        "backend",
        "database",
        "performance"
      ],
      "affects": [
        "architect",
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "Pagination: cursor-based for feeds, offset for admin",
      "desc": "Use cursor-based pagination for user-facing feeds and offset-based for admin/dashboard views.",
      "reasoning": "Cursor pagination handles real-time data without skipping or duplicating. Offset is simpler for admin browsing.",
      "alts": [
        "Offset everywhere",
        "Keyset pagination"
      ],
      "tags": [
        "backend",
        "api",
        "performance"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "API versioning via URL path (/v1/)",
      "desc": "Version the API using URL path prefixes. Current version is /v1/. Breaking changes go in /v2/.",
      "reasoning": "URL-based versioning is explicit and easy to route. Clients see exactly which version they're using.",
      "alts": [
        "Header-based versioning",
        "No versioning"
      ],
      "tags": [
        "backend",
        "api",
        "architecture"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "medium"
    },
    {
      "title": "Webhook retry with exponential backoff (3 attempts)",
      "desc": "When delivering webhooks, retry failed deliveries with exponential backoff up to 3 attempts.",
      "reasoning": "Network issues cause temporary failures. Exponential backoff prevents overwhelming the receiver.",
      "alts": [
        "No retries",
        "Fixed interval retry",
        "Queue-based delivery"
      ],
      "tags": [
        "backend",
        "api",
        "reliability"
      ],
      "affects": [
        "architect",
        "backend"
      ],
      "confidence": "high"
    },
    {
      "title": "Docker Compose for local development",
      "desc": "Use Docker Compose to run all services locally with a single command. Matches production topology.",
      "reasoning": "Docker Compose ensures dev/prod parity and eliminates 'works on my machine' issues.",
      "alts": [
        "Native Node.js development",
        "Podman",
        "devcontainers"
      ],
      "tags": [
        "devops",
        "tooling",
        "infrastructure"
      ],
      "affects": [
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "Fly.io for production hosting with auto-scaling",
      "desc": "Deploy to Fly.io for production hosting with automatic scaling based on request load.",
      "reasoning": "Fly.io provides edge deployment, built-in TLS, and simple scaling. Better DX than AWS for small teams.",
      "alts": [
        "AWS ECS",
        "Railway",
        "Render"
      ],
      "tags": [
        "devops",
        "infrastructure",
        "deployment"
      ],
      "affects": [
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "GitHub Actions CI/CD: test, staging, production",
      "desc": "Use GitHub Actions for the full CI/CD pipeline: run tests on PR, deploy to staging on merge, promote to production manually.",
      "reasoning": "GitHub Actions integrates directly with the repo. The staging gate catches issues before production.",
      "alts": [
        "CircleCI",
        "GitLab CI",
        "Jenkins"
      ],
      "tags": [
        "devops",
        "ci-cd",
        "quality"
      ],
      "affects": [
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "Database backups: daily pg_dump to S3, 30-day retention",
      "desc": "Run automated daily PostgreSQL backups using pg_dump, store in S3 with 30-day retention.",
      "reasoning": "Daily backups protect against data loss. S3 provides durable storage. 30 days covers most recovery scenarios.",
      "alts": [
        "WAL-based continuous backup",
        "Manual backups"
      ],
      "tags": [
        "devops",
        "database",
        "infrastructure"
      ],
      "affects": [
        "architect",
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "Sentry for error tracking, Grafana for metrics",
      "desc": "Use Sentry for real-time error tracking and alerting. Grafana dashboards for system metrics and business KPIs.",
      "reasoning": "Sentry catches and groups errors automatically. Grafana provides customizable dashboards for monitoring.",
      "alts": [
        "Datadog",
        "New Relic",
        "Self-hosted ELK"
      ],
      "tags": [
        "devops",
        "observability",
        "infrastructure"
      ],
      "affects": [
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "Blue-green deployments for zero downtime",
      "desc": "Use blue-green deployment strategy to achieve zero-downtime deploys by running old and new versions simultaneously.",
      "reasoning": "Blue-green eliminates downtime during deploys and provides instant rollback by switching traffic back.",
      "alts": [
        "Rolling deployments",
        "Canary releases"
      ],
      "tags": [
        "devops",
        "deployment",
        "infrastructure"
      ],
      "affects": [
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "CDN for all static assets via Cloudflare",
      "desc": "Serve all static assets (JS, CSS, images) through Cloudflare CDN for global edge caching.",
      "reasoning": "CDN reduces latency for users worldwide and offloads bandwidth from origin servers.",
      "alts": [
        "AWS CloudFront",
        "Fastly",
        "No CDN"
      ],
      "tags": [
        "devops",
        "performance",
        "infrastructure"
      ],
      "affects": [
        "backend",
        "devops"
      ],
      "confidence": "high"
    },
    {
      "title": "Freemium model: free tier with upgrade prompts at limits",
      "desc": "Offer a generous free tier that covers individual use. Show upgrade prompts when users approach limits.",
      "reasoning": "Freemium maximizes adoption. Users who hit limits are already invested and more likely to convert.",
      "alts": [
        "Free trial only",
        "Paid from day one"
      ],
      "tags": [
        "business",
        "pricing",
        "marketing"
      ],
      "affects": [
        "architect",
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Pricing: Free / Pro $29/mo / Enterprise $299/mo",
      "desc": "Three pricing tiers targeting individual developers, small teams, and enterprises respectively.",
      "reasoning": "Three tiers cover the full market. $29 is impulse-buy territory for developers. $299 signals enterprise value.",
      "alts": [
        "Two tiers only",
        "Usage-based pricing",
        "$49/$149 tiers"
      ],
      "tags": [
        "business",
        "pricing"
      ],
      "affects": [
        "architect",
        "marketer"
      ],
      "confidence": "medium"
    },
    {
      "title": "Product Hunt launch targeting Tuesday morning",
      "desc": "Launch on Product Hunt on a Tuesday morning (10am ET) for maximum visibility and upvote potential.",
      "reasoning": "Tuesday is the highest-traffic day on Product Hunt. Morning launches get more time to accumulate upvotes.",
      "alts": [
        "Wednesday launch",
        "Thursday launch"
      ],
      "tags": [
        "marketing",
        "launch",
        "growth"
      ],
      "affects": [
        "marketer"
      ],
      "confidence": "medium"
    },
    {
      "title": "Landing page hero with live interactive demo",
      "desc": "The landing page hero section features an embedded interactive demo that lets visitors try the product without signing up.",
      "reasoning": "Interactive demos convert 3x better than screenshots or videos. Proving the product instantly builds trust.",
      "alts": [
        "Video demo",
        "Screenshot carousel",
        "Animated mockup"
      ],
      "tags": [
        "marketing",
        "frontend",
        "conversion"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "SEO targeting: AI agent memory, decision tracking",
      "desc": "Target long-tail SEO keywords around 'AI agent memory', 'decision tracking for AI', and 'context management'.",
      "reasoning": "These keywords have growing search volume with low competition. Content marketing builds organic traffic over time.",
      "alts": [
        "PPC advertising focus",
        "Social media focus"
      ],
      "tags": [
        "marketing",
        "seo",
        "growth"
      ],
      "affects": [
        "frontend",
        "marketer"
      ],
      "confidence": "medium"
    },
    {
      "title": "Developer documentation as primary marketing channel",
      "desc": "Invest heavily in developer documentation as the primary growth channel. Docs should be comprehensive, searchable, and example-rich.",
      "reasoning": "Developers evaluate tools by their docs. Great documentation reduces support load and drives word-of-mouth.",
      "alts": [
        "Blog content focus",
        "Video tutorial focus"
      ],
      "tags": [
        "marketing",
        "documentation",
        "growth"
      ],
      "affects": [
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Annual billing discount: 20%",
      "desc": "Offer a 20% discount for annual billing to incentivize longer commitments and improve revenue predictability.",
      "reasoning": "Annual billing reduces churn and improves cash flow. 20% is significant enough to motivate but not so much it devalues the product.",
      "alts": [
        "10% discount",
        "No annual option",
        "25% discount"
      ],
      "tags": [
        "business",
        "pricing"
      ],
      "affects": [
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Vitest for unit tests, Playwright for E2E",
      "desc": "Use Vitest for fast unit testing and Playwright for end-to-end browser testing.",
      "reasoning": "Vitest is the fastest test runner for Vite projects. Playwright provides reliable cross-browser E2E testing.",
      "alts": [
        "Jest + Cypress",
        "Jest + Puppeteer"
      ],
      "tags": [
        "testing",
        "quality",
        "tooling"
      ],
      "affects": [
        "backend",
        "devops",
        "frontend"
      ],
      "confidence": "high"
    },
    {
      "title": "80% code coverage minimum for core packages",
      "desc": "Enforce 80% code coverage on core business logic packages. Not enforced on UI components or scripts.",
      "reasoning": "80% coverage catches most regressions without making testing burdensome. Focus on core logic, not boilerplate.",
      "alts": [
        "90% coverage",
        "No coverage requirement"
      ],
      "tags": [
        "testing",
        "quality"
      ],
      "affects": [
        "backend",
        "devops",
        "frontend"
      ],
      "confidence": "high"
    },
    {
      "title": "Load testing: must handle 100 concurrent compiles",
      "desc": "The system must handle 100 concurrent compile requests with p95 latency under 200ms.",
      "reasoning": "Compile is the core operation. Under load, it must remain fast to avoid degraded user experience.",
      "alts": [
        "50 concurrent target",
        "No load testing"
      ],
      "tags": [
        "testing",
        "performance",
        "quality"
      ],
      "affects": [
        "backend",
        "devops",
        "frontend"
      ],
      "confidence": "high"
    },
    {
      "title": "Accessibility: WCAG 2.1 AA compliance",
      "desc": "All user-facing pages must meet WCAG 2.1 Level AA accessibility standards.",
      "reasoning": "Accessibility is both a legal requirement and a moral obligation. It also improves UX for all users.",
      "alts": [
        "WCAG 2.0 AA",
        "No accessibility requirements"
      ],
      "tags": [
        "quality",
        "frontend",
        "accessibility"
      ],
      "affects": [
        "backend",
        "devops",
        "frontend",
        "marketer"
      ],
      "confidence": "high"
    },
    {
      "title": "Performance budget: LCP < 2.5s, FID < 100ms",
      "desc": "Set performance budgets for Core Web Vitals: Largest Contentful Paint under 2.5 seconds, First Input Delay under 100ms.",
      "reasoning": "Core Web Vitals directly impact SEO ranking and user experience. These are Google's recommended thresholds.",
      "alts": [
        "No performance budget",
        "Stricter thresholds"
      ],
      "tags": [
        "quality",
        "frontend",
        "performance"
      ],
      "affects": [
        "backend",
        "devops",
        "frontend",
        "marketer"
      ],
      "confidence": "high"
    }
  ]
} as const;
