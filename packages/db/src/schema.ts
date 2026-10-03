import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

// Tipos espelham infra/migrations. Ao alterar uma tabela, atualize os dois.

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  external_id: string | null;
  email: string;
  name: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp | null;
}

export interface RolesTable {
  id: Generated<number>;
  name: string;
  permissions: string[];
}

export interface ProjectsTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Timestamp>;
}

export interface ProjectMembersTable {
  project_id: string;
  user_id: string;
  role_id: number;
  created_at: Generated<Timestamp>;
}

export interface AuditLogTable {
  /** BIGSERIAL: o driver `pg` devolve como string. */
  id: Generated<string>;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  /** JSONB: insira com `JSON.stringify`. */
  details: ColumnType<unknown, string | null | undefined, never>;
  ip: string | null;
  created_at: Generated<Timestamp>;
}

export interface Database {
  users: UsersTable;
  roles: RolesTable;
  projects: ProjectsTable;
  project_members: ProjectMembersTable;
  audit_log: AuditLogTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Role = Selectable<RolesTable>;
export type Project = Selectable<ProjectsTable>;
export type ProjectMember = Selectable<ProjectMembersTable>;
export type AuditLogEntry = Selectable<AuditLogTable>;
export type NewAuditLogEntry = Insertable<AuditLogTable>;
