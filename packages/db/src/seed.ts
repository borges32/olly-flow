import { DEFAULT_ROLE_PERMISSIONS, ROLE_NAMES } from '@olly/shared-types';
import type { Db } from './client.js';

/**
 * Cria ou atualiza os papéis padrão (FR-010). Idempotente: o seed é a fonte de verdade
 * das permissões dos papéis padrão.
 */
export async function seedRoles(db: Db): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (const name of ROLE_NAMES) {
      await trx
        .insertInto('roles')
        .values({ name, permissions: [...DEFAULT_ROLE_PERMISSIONS[name]] })
        .onConflict((oc) =>
          oc.column('name').doUpdateSet((eb) => ({ permissions: eb.ref('excluded.permissions') })),
        )
        .execute();
    }
  });
}
