const PREFIX = 'OLLY_EXPOSED_';

/** `$env` (FR-005): só variáveis `OLLY_EXPOSED_*`, sem o prefixo. O resto do ambiente nunca chega às expressões. */
export function exposedEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) =>
      key.startsWith(PREFIX) && key.length > PREFIX.length && value !== undefined
        ? [[key.slice(PREFIX.length), value]]
        : [],
    ),
  );
}
