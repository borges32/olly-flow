import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'olly:isPublic';
export const IS_AUTHENTICATED = 'olly:isAuthenticated';

/** Libera a rota do `AuthGuard` global. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Declara que a rota exige apenas um usuário autenticado, sem permissão específica
 * (constituição, Art. III.4). Rotas que exigem permissão usam o decorator da spec 002.
 * O guard já exige token em toda rota não pública; este decorator torna a decisão explícita
 * e é verificado pelo teste de cobertura de rotas.
 */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED, true);
