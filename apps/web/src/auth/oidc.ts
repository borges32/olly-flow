import { UserManager, WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';

export interface OidcEnv {
  authority: string;
  clientId: string;
  origin: string;
  storage: Storage;
}

/**
 * Configuração OIDC genérica (FR-007/FR-008): Authorization Code + PKCE (S256, padrão do
 * oidc-client-ts no fluxo `code`), renovação silenciosa por refresh token e logout pelo
 * `end_session_endpoint` descoberto no emissor. Nada aqui é específico de fornecedor.
 */
export function createOidcSettings({
  authority,
  clientId,
  origin,
  storage,
}: OidcEnv): UserManagerSettings {
  return {
    authority,
    client_id: clientId,
    redirect_uri: `${origin}/auth/callback`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    loadUserInfo: false,
    // sessionStorage: o token não sobrevive ao fechamento da aba nem é compartilhado entre abas.
    userStore: new WebStorageStateStore({ store: storage }),
  };
}

let userManager: UserManager | undefined;

export function getUserManager(): UserManager {
  userManager ??= new UserManager(
    createOidcSettings({
      authority: import.meta.env.VITE_OIDC_AUTHORITY,
      clientId: import.meta.env.VITE_OIDC_CLIENT_ID,
      origin: window.location.origin,
      storage: window.sessionStorage,
    }),
  );
  return userManager;
}
