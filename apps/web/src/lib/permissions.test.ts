import { describe, expect, it } from 'vitest';
import { can, canAnywhere } from './permissions';

const perms = { global: [], projects: { p1: ['workflow:read' as const] } };

describe('spec 002 — FR-010/NFR-002: permissões no frontend', () => {
  it('FR-010: vale só no projeto em que o papel foi atribuído', () => {
    expect(can(perms, 'workflow:read', 'p1')).toBe(true);
    expect(can(perms, 'workflow:read', 'p2')).toBe(false);
    expect(can(perms, 'workflow:update', 'p1')).toBe(false);
    expect(can(perms, 'workflow:read')).toBe(false);
  });

  it('FR-010: permissão global vale em qualquer projeto', () => {
    const admin = { global: ['workflow:update' as const], projects: {} };
    expect(can(admin, 'workflow:update', 'qualquer')).toBe(true);
    expect(can(admin, 'workflow:update')).toBe(true);
  });

  it('FR-010: canAnywhere considera qualquer projeto', () => {
    expect(canAnywhere(perms, 'workflow:read')).toBe(true);
    expect(canAnywhere(perms, 'project:manage')).toBe(false);
    expect(can(undefined, 'workflow:read', 'p1')).toBe(false);
  });
});
