/** Caminho de webhook sem barras nas pontas (`/pedidos/` → `pedidos`). */
export function normalizePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '');
}

const SEGMENT = /^(?::[A-Za-z_][A-Za-z0-9_]*|[A-Za-z0-9._~-]+)$/;

/** Segmentos com letras, números, `.`, `_`, `~`, `-`, ou parâmetros `:nome`. */
export function isValidPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized !== '' && normalized.split('/').every((s) => SEGMENT.test(s));
}

/** Parâmetros capturados, ou `null` se o caminho não casa com o padrão. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const s = normalizePath(path).split('/');
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] ?? '';
    const value = s[i] ?? '';
    if (seg.startsWith(':')) {
      if (value === '') return null;
      try {
        params[seg.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (seg !== value) return null;
  }
  return params;
}

/** Rota estática vence rota com parâmetro (`clientes/novo` antes de `clientes/:id`). */
export const specificity = (pattern: string) =>
  pattern.split('/').filter((s) => !s.startsWith(':')).length;
