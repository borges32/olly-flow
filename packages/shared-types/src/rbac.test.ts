import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_NAMES, isPermission } from './index.js';

describe('FR-010: matriz padrão de papéis', () => {
  it('FR-010: define exatamente os papéis admin, editor, executor e viewer', () => {
    expect([...ROLE_NAMES].sort()).toEqual(['admin', 'editor', 'executor', 'viewer']);
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort()).toEqual([...ROLE_NAMES].sort());
  });

  it('FR-010: admin tem todas as permissões', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.admin].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('FR-010: editor tem todas exceto user:manage, project:manage e audit:read', () => {
    const missing = PERMISSIONS.filter((p) => !DEFAULT_ROLE_PERMISSIONS.editor.includes(p));
    expect(missing.sort()).toEqual(['audit:read', 'project:manage', 'user:manage']);
  });

  it('FR-010: executor e viewer têm as permissões da matriz', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.executor].sort()).toEqual([
      'execution:read',
      'workflow:execute',
      'workflow:read',
    ]);
    expect([...DEFAULT_ROLE_PERMISSIONS.viewer].sort()).toEqual([
      'execution:read',
      'workflow:read',
    ]);
  });

  it('FR-010: toda permissão de papel pertence ao catálogo', () => {
    for (const perms of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) expect(isPermission(p)).toBe(true);
    }
    expect(isPermission('workflow:destroy')).toBe(false);
  });
});
