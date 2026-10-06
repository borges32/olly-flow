import { createHash } from 'node:crypto';
import type { MaskingAction, MaskingDetector, MaskingRuleSpec } from '@olly/shared-types';

/**
 * Mascaramento de dados pessoais e sensíveis (spec 009, FR-014 a FR-016, plan §6).
 *
 * Aplicado somente ao que é gravado, transmitido ou registrado em log: os dados que trafegam
 * entre os nós nunca passam por aqui (FR-015). `mask` nunca altera o valor recebido; devolve uma
 * cópia (só dos ramos alterados) e se algo mudou.
 */

export const MASK = '***';

const digitsOf = (s: string) => s.replace(/\D/g, '');
const allSame = (d: string) => /^(\d)\1*$/.test(d);

export function isValidCpf(value: string): boolean {
  const d = digitsOf(value);
  if (d.length !== 11 || allSame(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export function isValidCnpj(value: string): boolean {
  const d = digitsOf(value);
  if (d.length !== 14 || allSame(d)) return false;
  const check = (len: number) => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

export function passesLuhn(value: string): boolean {
  const d = digitsOf(value);
  if (d.length < 13 || d.length > 19 || allSame(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

interface Detector {
  id: MaskingDetector;
  /** Pré-filtro (NFR-002): mínimo de dígitos no texto, ou um marcador que precisa aparecer. */
  minDigits?: number;
  marker?: string[];
  /** Ocorrências dentro de um texto (flag `g`). */
  regex: RegExp;
  valid?: (match: string) => boolean;
  partial: (match: string) => string;
}

const lastDigits = (s: string, n: number) => digitsOf(s).slice(-n);

/** Ordem de aplicação: dos padrões mais específicos aos mais genéricos. */
const DETECTORS: readonly Detector[] = [
  {
    id: 'jwt',
    marker: ['eyJ'],
    regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    partial: () => 'eyJ***',
  },
  {
    id: 'apiKey',
    marker: ['sk-', 'AKIA'],
    regex: /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/g,
    partial: (m) => `${m.slice(0, m.startsWith('sk-') ? 3 : 4)}***`,
  },
  {
    id: 'email',
    marker: ['@'],
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    partial: (m) => {
      const [user = '', domain = ''] = m.split('@');
      return `${user.slice(0, 1)}***@${domain}`;
    },
  },
  {
    id: 'cnpj',
    minDigits: 14,
    regex: /(?<![\d*])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d*])/g,
    valid: isValidCnpj,
    partial: (m) => `**.***.***/${digitsOf(m).slice(8, 12)}-**`,
  },
  {
    id: 'cpf',
    minDigits: 11,
    regex: /(?<![\d*])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d*])/g,
    valid: isValidCpf,
    partial: (m) => `***.***.${digitsOf(m).slice(6, 9)}-**`,
  },
  {
    id: 'card',
    minDigits: 13,
    regex: /(?<![\d*])\d(?:[ -]?\d){12,18}(?![\d*])/g,
    valid: passesLuhn,
    partial: (m) => `**** **** **** ${lastDigits(m, 4)}`,
  },
  {
    id: 'phone',
    minDigits: 10,
    regex: /(?<![\d*])(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}(?![\d*])/g,
    partial: (m) => `(**) *****-${lastDigits(m, 4)}`,
  },
];

const DETECTOR_BY_ID = new Map(DETECTORS.map((d) => [d.id, d]));

/** O texto pode conter o padrão do detector? (descarta rápido antes da regex). */
function quickMatch(d: Detector, text: string): boolean {
  if (d.marker) return d.marker.some((m) => text.includes(m));
  if (!d.minDigits || text.length < d.minDigits) return false;
  let digits = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57 && ++digits >= d.minDigits) return true;
  }
  return false;
}
/** O valor inteiro é deste tipo? (parcial de uma regra de campo). */
const WHOLE = DETECTORS.map((d) => ({ detector: d, regex: new RegExp(`^(?:${d.regex.source})$`) }));

export function isMaskingDetector(id: string): id is MaskingDetector {
  return DETECTOR_BY_ID.has(id as MaskingDetector);
}

/** Compila um glob (`*`, `?`) em regex, sem diferenciar maiúsculas. */
function globToRegex(glob: string, anchoredAtSegment: boolean): RegExp {
  const body = glob
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\/]/g, '\\$&')))
    .join('');
  return new RegExp(anchoredAtSegment ? `(?:^|\\.)${body}$` : `^${body}$`, 'i');
}

/** Valida o `matcher` de uma regra. Devolve a mensagem do problema ou `null`. */
export function maskingRuleProblem(rule: MaskingRuleSpec): string | null {
  if (rule.kind === 'pattern') {
    return isMaskingDetector(rule.matcher)
      ? null
      : `Detector desconhecido: use ${DETECTORS.map((d) => d.id).join(', ')}`;
  }
  const m = rule.matcher.trim();
  if (!m || m.length > 200) return 'Informe um nome ou caminho de campo (até 200 caracteres)';
  if (/^[*?.]+$/.test(m)) return 'O padrão do campo casaria com todos os campos';
  if (!/^[\w*?.-]+$/u.test(m)) return 'Use letras, números, _, -, . e os curingas * e ?';
  return null;
}

export interface MaskResult<T> {
  value: T;
  changed: boolean;
}

export interface Masker {
  /** Cópia de `value` mascarada. */
  mask<T>(value: T): MaskResult<T>;
  /** Só os detectores de valor (texto livre, como mensagens de log). */
  maskText(text: string): string;
  readonly empty: boolean;
}

interface CompiledField {
  regex: RegExp;
  /** Glob com `.`: compara com o caminho; sem `.`, só com o nome do campo. */
  byPath: boolean;
  action: MaskingAction;
}

const MAX_DEPTH = 64;
/** Caminhos de campo distintos lembrados por mascarador (as chaves se repetem entre itens). */
const FIELD_CACHE_MAX = 10_000;

export interface MaskerOptions {
  /** Salt da ação `hash` (OLLY_MASKING_SALT), por instalação. */
  salt: string;
}

/** Compila as regras ativas (FR-014). Regras inválidas são ignoradas. */
export function createMasker(rules: readonly MaskingRuleSpec[], options: MaskerOptions): Masker {
  const fields: CompiledField[] = [];
  const patterns = new Map<MaskingDetector, MaskingAction>();
  for (const rule of rules) {
    if (maskingRuleProblem(rule)) continue;
    if (rule.kind === 'pattern') {
      // Duas regras para o mesmo detector: vale a mais forte (redact > hash > partial).
      const current = patterns.get(rule.matcher as MaskingDetector);
      if (!current || strength(rule.action) > strength(current)) {
        patterns.set(rule.matcher as MaskingDetector, rule.action);
      }
    } else {
      const byPath = rule.matcher.includes('.');
      fields.push({ regex: globToRegex(rule.matcher, byPath), byPath, action: rule.action });
    }
  }
  const detectors = DETECTORS.filter((d) => patterns.has(d.id));
  const hash = (text: string) =>
    `sha256:${createHash('sha256').update(options.salt).update(text).digest('hex')}`;

  const apply = (action: MaskingAction, text: string, detector?: Detector): string => {
    if (action === 'redact') return MASK;
    if (action === 'hash') return hash(text);
    if (detector) return detector.partial(text);
    // Parcial genérico: o valor inteiro casa com algum detector? Senão, mantém os 4 últimos.
    const whole = WHOLE.find(
      ({ detector: d, regex }) =>
        quickMatch(d, text) && regex.test(text) && (!d.valid || d.valid(text)),
    );
    if (whole) return whole.detector.partial(text);
    return text.length > 8 ? `${MASK}${text.slice(-4)}` : MASK;
  };

  // Pré-filtro (NFR-002): a maioria dos textos não tem dígitos suficientes nem marcadores.
  const minDigits = Math.min(...detectors.map((d) => d.minDigits ?? Infinity));
  const markers = detectors.flatMap((d) => d.marker ?? []);
  const mayContain = (text: string): boolean => {
    for (const m of markers) if (text.includes(m)) return true;
    if (text.length < minDigits) return false;
    let digits = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 48 && c <= 57 && ++digits >= minDigits) return true;
    }
    return false;
  };

  const maskText = (text: string): string => {
    if (!mayContain(text)) return text;
    let out = text;
    for (const detector of detectors) {
      detector.regex.lastIndex = 0;
      if (!detector.regex.test(out)) continue;
      const action = patterns.get(detector.id) ?? 'redact';
      out = out.replace(detector.regex, (match) =>
        !detector.valid || detector.valid(match) ? apply(action, match, detector) : match,
      );
    }
    return out;
  };

  // NFR-002: regras por nome são resolvidas uma vez por nome de campo; o caminho só é montado
  // quando existe regra por caminho.
  const keyRules = fields.filter((f) => !f.byPath);
  const pathRules = fields.filter((f) => f.byPath);
  const keyCache = new Map<string, MaskingAction | null>();
  const pathCache = new Map<string, MaskingAction | null>();
  const lookup = (
    cache: Map<string, MaskingAction | null>,
    rules: CompiledField[],
    subject: string,
  ): MaskingAction | null => {
    const cached = cache.get(subject);
    if (cached !== undefined) return cached;
    const action = rules.find((f) => f.regex.test(subject))?.action ?? null;
    if (cache.size >= FIELD_CACHE_MAX) cache.clear();
    cache.set(subject, action);
    return action;
  };
  const fieldAction = (key: string, path: string | undefined): MaskingAction | undefined => {
    // Ordem das regras preservada: a primeira que casa vale.
    const byKey = keyRules.length ? lookup(keyCache, keyRules, key) : null;
    const byPath =
      path !== undefined && pathRules.length ? lookup(pathCache, pathRules, path) : null;
    if (byKey && byPath) {
      return fields.indexOf(keyRules.find((f) => f.action === byKey) as CompiledField) <=
        fields.indexOf(pathRules.find((f) => f.action === byPath) as CompiledField)
        ? byKey
        : byPath;
    }
    return byKey ?? byPath ?? undefined;
  };
  const usePaths = pathRules.length > 0;

  const maskWhole = (action: MaskingAction, value: unknown): unknown => {
    if (value === null || value === undefined || value === '') return value;
    if (typeof value === 'string') return apply(action, value);
    const json = toJson(value);
    // Cíclico, com BigInt ou sem representação JSON: ocultar é sempre seguro.
    return json === undefined ? MASK : apply(action, json);
  };

  // Objetos no caminho atual: uma referência ao próprio ancestral (ciclo) não é percorrida de
  // novo. Sem isso, com mais de uma referência, o custo é exponencial até MAX_DEPTH.
  const ancestors: object[] = [];

  const walk = (value: unknown, path: string | undefined, depth: number): unknown => {
    if (typeof value === 'string') return detectors.length ? maskText(value) : value;
    if (typeof value === 'number') {
      // CPF/CNPJ/cartão guardados como número.
      if (!detectors.length || !Number.isInteger(value) || Math.abs(value) < 1e10) return value;
      const text = String(value);
      const masked = maskText(text);
      return masked === text ? value : masked;
    }
    if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
    if (depth > 0 && ancestors.includes(value)) return value;
    if (Array.isArray(value)) {
      const list = value as unknown[];
      let copy: unknown[] | undefined;
      ancestors.push(list);
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const next = walk(item, path, depth + 1);
        if (next !== item) {
          copy ??= [...list];
          copy[i] = next;
        }
      }
      ancestors.pop();
      return copy ?? value;
    }
    // Só objetos simples (os dados de execução são JSON). Instâncias de classe, como o
    // req/res do Node que o pino-http registra antes dos serializers, ficam como estão.
    // O protótipo de um objeto simples é o `Object.prototype` de algum realm (inclusive o de uma
    // sandbox `vm`), cujo protótipo é nulo.
    const proto = Object.getPrototypeOf(value) as object | null;
    if (proto !== Object.prototype && proto !== null && Object.getPrototypeOf(proto) !== null) {
      return value;
    }
    let copy: Record<string, unknown> | undefined;
    ancestors.push(value);
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      const item = (value as Record<string, unknown>)[key];
      const childPath = usePaths ? (path ? `${path}.${key}` : key) : undefined;
      const action = fields.length ? fieldAction(key, childPath) : undefined;
      const next = action ? maskWhole(action, item) : walk(item, childPath, depth + 1);
      if (next !== item) {
        copy ??= { ...(value as Record<string, unknown>) };
        copy[key] = next;
      }
    }
    ancestors.pop();
    return copy ?? value;
  };

  const empty = fields.length === 0 && detectors.length === 0;
  return {
    empty,
    maskText: (text) => (detectors.length ? maskText(text) : text),
    mask<T>(value: T): MaskResult<T> {
      if (empty) return { value, changed: false };
      ancestors.length = 0;
      const next = walk(value, usePaths ? '' : undefined, 0) as T;
      return { value: next, changed: next !== value };
    },
  };
}

function toJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function strength(action: MaskingAction): number {
  return action === 'redact' ? 3 : action === 'hash' ? 2 : 1;
}

/** Mascarador que não faz nada (sem regras). */
export const NO_MASKING: Masker = createMasker([], { salt: '' });
