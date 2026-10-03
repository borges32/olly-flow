import type { Permission } from './rbac.js';

export type DependencyStatus = 'up' | 'down';

/** `GET /health`. `idp` indica se o emissor OIDC responde (caso de borda da spec 001). */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  db: DependencyStatus;
  redis: DependencyStatus;
  idp: DependencyStatus;
}

/** `GET /api/v1/me`. */
export interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  permissions: Permission[];
}

/** Corpo padrão de erro da API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}
