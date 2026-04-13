/**
 * Playground scenarios - pre-built tasks visitors can try instantly.
 */

export interface PlaygroundScenario {
  id: string;
  name: string;
  description: string;
  task: string;
  agents: string[];
  highlight: 'role-differentiation' | 'contradictions' | 'procedures' | 'prediction' | 'skills';
  preload?: boolean;
}

export const SCENARIOS: PlaygroundScenario[] = [
  {
    id: 'auth-system-design',
    name: 'Auth system design',
    description: 'See how different agents get different context for the same task',
    task: 'Design the authentication system for a multi-tenant SaaS platform',
    agents: ['architect', 'security', 'backend'],
    highlight: 'role-differentiation',
    preload: true,
  },
  {
    id: 'database-migration-strategy',
    name: 'Database migration strategy',
    description: 'See contradiction detection in action',
    task: 'Plan the migration from MongoDB to PostgreSQL',
    agents: ['architect', 'backend'],
    highlight: 'contradictions',
  },
  {
    id: 'frontend-framework-selection',
    name: 'Frontend framework selection',
    description: 'See skill profiles drive agent recommendations',
    task: 'Choose a frontend framework for the admin dashboard',
    agents: ['frontend', 'architect'],
    highlight: 'skills',
  },
  {
    id: 'cicd-pipeline-optimization',
    name: 'CI/CD pipeline optimization',
    description: 'See team procedures emerge from workflows',
    task: 'Optimize the CI/CD pipeline for faster deployments',
    agents: ['devops', 'backend', 'reviewer'],
    highlight: 'procedures',
  },
  {
    id: 'security-audit-automation',
    name: 'Security audit automation',
    description: 'Predict the impact of a proposed security change',
    task: 'Automate the security audit process',
    agents: ['security', 'devops'],
    highlight: 'prediction',
  },
];

export function getScenario(id: string): PlaygroundScenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
