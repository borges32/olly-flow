import { Logger } from '@nestjs/common';

/**
 * Grupos do usuário no IdP (spec 009, FR-005; plan §2). A implementação padrão lê a claim
 * configurada (`OIDC_GROUPS_CLAIM`). O Entra ID, acima de ~200 grupos, troca a claim por uma
 * referência ao Microsoft Graph (*overage*, `_claim_names.groups`): um resolver que consulte o
 * Graph só entra quando a ADR-0005 confirmar o Entra ID como IdP institucional.
 */
export interface GroupResolver {
  resolve(payload: Record<string, unknown>): string[] | undefined;
}

export class ClaimGroupResolver implements GroupResolver {
  private readonly logger = new Logger('GroupResolver');

  constructor(private readonly claim: string) {}

  resolve(payload: Record<string, unknown>): string[] | undefined {
    const raw = payload[this.claim];
    if (Array.isArray(raw)) return raw.filter((g): g is string => typeof g === 'string');
    const names = payload._claim_names as Record<string, unknown> | undefined;
    if (names && this.claim in names) {
      this.logger.warn(
        `Token com grupos em excesso (overage) na claim ${this.claim}: os papéis por grupo não serão aplicados (ADR-0005)`,
      );
    }
    return undefined;
  }
}
