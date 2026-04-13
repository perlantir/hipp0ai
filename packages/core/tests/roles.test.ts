// Role Templates Unit Tests

import { describe, it, expect } from 'vitest';
import {
  ROLE_TEMPLATES,
  ROLE_NAMES,
  getRoleProfile,
  getRoleNotificationContext,
  listRoles,
} from '../src/roles.js';
import type { RoleTemplate } from '../src/roles.js';

// All 16 expected role keys
const EXPECTED_ROLES = [
  'builder',
  'reviewer',
  'product',
  'docs',
  'launch',
  'ops',
  'blockchain',
  'challenge',
  'governor',
  'architect',
  'design',
  'qa',
  'devops',
  'analytics',
  'gtm',
  'security',
] as const;

  // Existence

describe('ROLE_TEMPLATES', () => {
  it('contains all 17 role templates', () => {
    expect(Object.keys(ROLE_TEMPLATES)).toHaveLength(17);
    for (const role of EXPECTED_ROLES) {
      expect(ROLE_TEMPLATES).toHaveProperty(role);
    }
  });

  it.each(EXPECTED_ROLES)('role "%s" has all required fields', (role) => {
    const template: RoleTemplate = ROLE_TEMPLATES[role];

    expect(template).toBeDefined();
    expect(typeof template.name).toBe('string');
    expect(template.name.length).toBeGreaterThan(0);

    expect(typeof template.description).toBe('string');
    expect(template.description.length).toBeGreaterThan(0);

    expect(typeof template.notification_context).toBe('string');
    expect(template.notification_context.length).toBeGreaterThan(0);

    // Profile checks
    expect(template.profile).toBeDefined();
    expect(typeof template.profile.weights).toBe('object');
    expect(typeof template.profile.decision_depth).toBe('number');
    expect(template.profile.decision_depth).toBeGreaterThanOrEqual(1);
    expect(['recent_first', 'validated_first', 'balanced']).toContain(
      template.profile.freshness_preference,
    );
    expect(typeof template.profile.include_superseded).toBe('boolean');
  });

  it.each(EXPECTED_ROLES)('role "%s" weights are in [0, 1]', (role) => {
    const weights = ROLE_TEMPLATES[role].profile.weights;
    for (const [tag, value] of Object.entries(weights)) {
      expect(
        value,
        `Weight for tag "${tag}" in role "${role}" must be in [0,1]`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        value,
        `Weight for tag "${tag}" in role "${role}" must be in [0,1]`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

  // ROLE_NAMES

describe('ROLE_NAMES', () => {
  it('contains exactly 17 entries', () => {
    expect(ROLE_NAMES).toHaveLength(17);
  });

  it('includes all expected role keys', () => {
    for (const role of EXPECTED_ROLES) {
      expect(ROLE_NAMES).toContain(role);
    }
  });
});

  // Spot-check individual role profiles

describe('individual role profiles', () => {
  it('builder has high implementation weight and recent_first preference', () => {
    const { profile } = ROLE_TEMPLATES.builder;
    expect(profile.weights.implementation).toBe(1.0);
    expect(profile.freshness_preference).toBe('recent_first');
    expect(profile.decision_depth).toBe(3);
  });

  it('reviewer includes superseded decisions', () => {
    expect(ROLE_TEMPLATES.reviewer.profile.include_superseded).toBe(true);
  });

  it('security role has high security weight and includes superseded', () => {
    const { profile } = ROLE_TEMPLATES.security;
    expect(profile.weights.security).toBe(1.0);
    expect(profile.include_superseded).toBe(true);
    expect(profile.freshness_preference).toBe('validated_first');
  });

  it('architect has architecture weight of 1.0', () => {
    expect(ROLE_TEMPLATES.architect.profile.weights.architecture).toBe(1.0);
  });

  it('product role has product weight of 1.0', () => {
    expect(ROLE_TEMPLATES.product.profile.weights.product).toBe(1.0);
  });
});

  // getRoleProfile

describe('getRoleProfile', () => {
  it('returns the correct profile for a known role', () => {
    const profile = getRoleProfile('builder');
    expect(profile).toEqual(ROLE_TEMPLATES.builder.profile);
  });

  it('falls back to builder profile for an unknown role', () => {
    const profile = getRoleProfile('nonexistent-role');
    expect(profile).toEqual(ROLE_TEMPLATES.builder.profile);
  });

  it('merges weight overrides into the base profile', () => {
    const profile = getRoleProfile('builder', {
      weights: { implementation: 0.1, custom_tag: 0.5 },
    });
    // The override replaces implementation
    expect(profile.weights.implementation).toBe(0.1);
    // New custom tag is added
    expect(profile.weights.custom_tag).toBe(0.5);
    // Other existing weights remain
    expect(profile.weights.architecture).toBe(0.9);
  });

  it('merges non-weight overrides (decision_depth, freshness_preference)', () => {
    const profile = getRoleProfile('builder', {
      decision_depth: 5,
      freshness_preference: 'validated_first',
    });
    expect(profile.decision_depth).toBe(5);
    expect(profile.freshness_preference).toBe('validated_first');
    // Weights should still come from the builder template
    expect(profile.weights.implementation).toBe(1.0);
  });

  it('merges include_superseded override', () => {
    // Builder defaults to false; override to true
    const profile = getRoleProfile('builder', { include_superseded: true });
    expect(profile.include_superseded).toBe(true);
  });

  it('returns a new object (not a reference mutation)', () => {
    const original = ROLE_TEMPLATES.architect.profile;
    const profile = getRoleProfile('architect', { decision_depth: 99 });
    // Original should not be mutated
    expect(original.decision_depth).toBe(3);
    expect(profile.decision_depth).toBe(99);
  });
});

  // getRoleNotificationContext

describe('getRoleNotificationContext', () => {
  it.each(EXPECTED_ROLES)('returns a non-empty string for role "%s"', (role) => {
    const ctx = getRoleNotificationContext(role);
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('returns the default message for an unknown role', () => {
    const ctx = getRoleNotificationContext('unknown-role');
    expect(ctx).toBe('A change has been made that may affect your work.');
  });

  it('returns specific context for builder', () => {
    const ctx = getRoleNotificationContext('builder');
    expect(ctx).toContain('implementation');
  });

  it('returns specific context for security', () => {
    const ctx = getRoleNotificationContext('security');
    expect(ctx.toLowerCase()).toContain('security');
  });
});

  // listRoles

describe('listRoles', () => {
  it('returns exactly 17 roles', () => {
    const roles = listRoles();
    expect(roles).toHaveLength(17);
  });

  it('each entry has name and description', () => {
    const roles = listRoles();
    for (const r of roles) {
      expect(typeof r.name).toBe('string');
      expect(r.name.length).toBeGreaterThan(0);
      expect(typeof r.description).toBe('string');
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it('includes all expected role keys as names', () => {
    const roles = listRoles();
    const names = roles.map((r) => r.name);
    for (const role of EXPECTED_ROLES) {
      expect(names).toContain(role);
    }
  });

  it('descriptions match the template descriptions', () => {
    const roles = listRoles();
    for (const { name, description } of roles) {
      expect(description).toBe(ROLE_TEMPLATES[name].description);
    }
  });
});
