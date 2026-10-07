/**
 * Spec 014: primeiro usuário, usuários locais e login pelo IdP opcional.
 */

/** `GET /auth/config` (público): o que a tela de entrada deve oferecer. */
export interface AuthConfig {
  /** Nenhum usuário: a plataforma oferece o cadastro do primeiro usuário (FR-001). */
  setupRequired: boolean;
  /** Login pelo IdP (OIDC) ativado na instalação (FR-010). */
  idpEnabled: boolean;
}

/** `POST /auth/setup` e `POST /auth/local/login`: sessão local (token opaco, `Bearer`). */
export interface LocalSessionResponse {
  token: string;
  expiresAt: string;
  /** Senha definida pela administração: trocar antes de usar a plataforma (FR-007). */
  mustChangePassword: boolean;
}

export interface SetupRequest {
  name: string;
  email: string;
  password: string;
}

export interface LocalLoginRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Origem do usuário: senha local, IdP ou os dois (conta vinculada, FR-015). */
export type UserOrigin = 'local' | 'idp' | 'linked';

/** `POST /admin/users` (FR-006): usuário local, com troca obrigatória da senha. */
export interface CreateLocalUserRequest {
  name: string;
  email: string;
  password: string;
  isAdmin?: boolean;
}

/** `PATCH /admin/users/:id`. */
export interface UpdateUserRequest {
  name?: string;
  email?: string;
  isAdmin?: boolean;
}

/** `PUT /admin/users/:id/password` (redefinição pela administração). */
export interface ResetPasswordRequest {
  password: string;
}

/** Política de senha (NFR-001), também exibida nos formulários. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
