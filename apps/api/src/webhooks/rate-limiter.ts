/**
 * Rate limit por rota numa janela fixa de 1 minuto, em memória (spec 005, FR-006, plan §10).
 * Com a fila da spec 006 e várias instâncias, passa a ser distribuído (Redis).
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Conta a chamada; `false` quando o limite da janela foi atingido. */
  hit(key: string, limit: number, windowMs = 60_000): boolean {
    const now = this.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count++;
    return current.count <= limit;
  }
}
