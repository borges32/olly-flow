import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, Headers, fetch, type RequestInit, type Response } from 'undici';

/**
 * Filtro anti-SSRF de toda chamada HTTP de saída (spec 004, FR-008, plan §4; reutilizado pelo
 * MCP na spec 010). Só endereços públicos (`unicast`) são aceitos, salvo allowlist: loopback,
 * privados, link-local, CGNAT, ULA, não especificado, reservados, multicast, broadcast e
 * endereços IPv6 que embutem IPv4 (6to4, Teredo, NAT64) ficam bloqueados.
 */
export class SsrfBlockedError extends Error {
  override name = 'SsrfBlockedError';
  constructor(
    readonly host: string,
    reason: string,
  ) {
    super(`Destino bloqueado pelo filtro de rede (${host}): ${reason}`);
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;

export interface HttpGuardOptions {
  /** Hosts e CIDRs internos liberados (`OLLY_HTTP_ALLOWLIST`). */
  allowlist?: readonly string[];
  /** Resolução de nomes (padrão: `dns.lookup` com todos os endereços). Substituível em testes. */
  resolve?: Resolver;
}

interface Allowlist {
  hosts: Set<string>;
  cidrs: [ipaddr.IPv4 | ipaddr.IPv6, number][];
}

export function parseAllowlist(entries: readonly string[] = []): Allowlist {
  const hosts = new Set<string>();
  const cidrs: Allowlist['cidrs'] = [];
  for (const raw of entries.map((e) => e.trim()).filter(Boolean)) {
    if (raw.includes('/')) cidrs.push(ipaddr.parseCIDR(raw));
    else if (ipaddr.isValid(raw)) {
      const ip = ipaddr.parse(raw);
      cidrs.push([ip, ip.kind() === 'ipv4' ? 32 : 128]);
    } else hosts.add(raw.toLowerCase());
  }
  return { hosts, cidrs };
}

/** Endereço IPv4 de um IPv6 mapeado (`::ffff:a.b.c.d`), para julgar pelo IPv4. */
function normalize(address: string): ipaddr.IPv4 | ipaddr.IPv6 {
  const ip = ipaddr.parse(address);
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (ip as ipaddr.IPv6).toIPv4Address();
  }
  return ip;
}

function inAllowlist(ip: ipaddr.IPv4 | ipaddr.IPv6, allowlist: Allowlist): boolean {
  return allowlist.cidrs.some(([net, bits]) => net.kind() === ip.kind() && ip.match(net, bits));
}

/** Motivo do bloqueio, ou `null` se o endereço pode ser acessado. */
export function blockedReason(address: string, allowlist: Allowlist): string | null {
  if (!ipaddr.isValid(address)) return 'endereço inválido';
  const ip = normalize(address);
  if (inAllowlist(ip, allowlist)) return null;
  const range = ip.range();
  return range === 'unicast' ? null : `endereço ${ip.toString()} é de rede ${range}`;
}

const defaultResolve: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
      if (err) reject(err);
      else resolve(addresses.map((a) => a.address));
    });
  });

const stripBrackets = (host: string) => host.replace(/^\[(.*)\]$/, '$1');

export interface HttpGuard {
  /** Lança `SsrfBlockedError` se a URL não pode ser acessada (protocolo, host ou algum IP). */
  assertDestinationAllowed(url: string | URL): Promise<void>;
  /** `fetch` que conecta só em IPs validados e revalida cada redirect. */
  fetch(url: string | URL, init?: GuardedRequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface GuardedRequestInit extends Omit<RequestInit, 'redirect' | 'dispatcher'> {
  followRedirects?: boolean;
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const AUTH_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

export function createHttpGuard(options: HttpGuardOptions = {}): HttpGuard {
  const allowlist = parseAllowlist(options.allowlist);
  const resolve = options.resolve ?? defaultResolve;

  /** Endereços validados para conectar; lança se algum resolvido for bloqueado. */
  async function validatedAddresses(hostname: string): Promise<string[]> {
    const host = stripBrackets(hostname).toLowerCase();
    const allowedHost = allowlist.hosts.has(host);
    const addresses = isIP(host) ? [host] : await resolve(host);
    if (addresses.length === 0) throw new SsrfBlockedError(host, 'o nome não resolve');
    if (allowedHost) return addresses;
    for (const address of addresses) {
      const reason = blockedReason(address, allowlist);
      // Qualquer IP bloqueado barra o destino: o resolvedor poderia escolher justamente esse.
      if (reason) throw new SsrfBlockedError(host, reason);
    }
    return addresses;
  }

  async function assertDestinationAllowed(url: string | URL): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new SsrfBlockedError(String(url), 'URL inválida');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SsrfBlockedError(parsed.host, `protocolo ${parsed.protocol} não permitido`);
    }
    await validatedAddresses(parsed.hostname);
  }

  // A conexão usa o mesmo filtro no `lookup`: o IP conectado é o validado, mesmo que o DNS
  // mude entre a verificação e a conexão (DNS rebinding).
  const agent = new Agent({
    connect: {
      lookup: (hostname, opts, callback) => {
        validatedAddresses(hostname).then(
          (addresses) => {
            const entries = addresses.map((address) => ({
              address,
              family: isIP(address) === 6 ? 6 : 4,
            }));
            if ((opts as { all?: boolean }).all) callback(null, entries);
            else {
              const [first] = entries;
              if (first) callback(null, first.address, first.family);
              else callback(new SsrfBlockedError(hostname, 'o nome não resolve'), '', 4);
            }
          },
          (err: unknown) => {
            callback(err instanceof Error ? err : new Error(String(err)), '', 4);
          },
        );
      },
    },
  });

  async function guardedFetch(
    input: string | URL,
    init: GuardedRequestInit = {},
  ): Promise<Response> {
    const { followRedirects = true, maxRedirects = 5, ...rest } = init;
    let url = new URL(input);
    let method = (rest.method ?? 'GET').toUpperCase();
    let body = rest.body;
    const headers = new Headers(rest.headers);
    for (let redirects = 0; ; redirects++) {
      await assertDestinationAllowed(url);
      const response = await fetch(url, {
        ...rest,
        method,
        headers,
        body: body ?? null,
        redirect: 'manual',
        dispatcher: agent,
      });
      const location = response.headers.get('location');
      if (!followRedirects || !REDIRECT_STATUSES.has(response.status) || !location) {
        return response;
      }
      await response.body?.cancel();
      if (redirects >= maxRedirects) {
        throw new Error(`Redirecionamentos demais (limite: ${maxRedirects})`);
      }
      const next = new URL(location, url);
      // Credenciais não seguem para outra origem.
      if (next.origin !== url.origin) for (const h of AUTH_HEADERS) headers.delete(h);
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === 'POST')
      ) {
        method = 'GET';
        body = undefined;
        headers.delete('content-type');
        headers.delete('content-length');
      }
      url = next;
    }
  }

  return {
    assertDestinationAllowed,
    fetch: guardedFetch,
    close: () => agent.close(),
  };
}
