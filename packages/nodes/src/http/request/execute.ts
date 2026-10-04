import type { BinaryRef, Item, NodeOutput } from '@olly/shared-types';
import { FormData, Headers, type Response } from 'undici';
import type { ResolvedCredential } from '../../credentials/definitions.js';
import { NodeExecutionError, NodeParameterError, errorJson } from '../../errors.js';
import type { HttpGuard } from '../../shared/http-guard.js';
import type { NodeContext, NodeExecuteInput } from '../../types.js';
import { applyHttpCredential, type OAuth2TokenCache } from '../auth.js';

export interface HttpRequestDeps {
  guard: HttpGuard;
  oauth: OAuth2TokenCache;
  /** `OLLY_HTTP_MAX_RESPONSE_MB` em bytes (NFR-001). */
  maxResponseBytes: number;
}

interface NameValue {
  name?: unknown;
  value?: unknown;
  parameterType?: unknown;
}

interface Options {
  timeout: number;
  followRedirects: boolean;
  maxRedirects: number;
  fullResponse: boolean;
  responseFormat: 'auto' | 'json' | 'text' | 'binary';
  outputBinaryField: string;
  neverError: boolean;
  batchSize: number;
  batchIntervalMs: number;
}

const BODYLESS = new Set(['GET', 'HEAD']);
const ERROR_SNIPPET = 500;

const text = (v: unknown) =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v);

function list(raw: unknown, param: string): NameValue[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new NodeParameterError(param, 'deve ser uma lista');
  return raw as NameValue[];
}

function readOptions(raw: unknown): Options {
  const o = (raw ?? {}) as Partial<Record<keyof Options, unknown>>;
  const int = (v: unknown, fallback: number, min: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback;
  const format = o.responseFormat;
  return {
    timeout: int(o.timeout, 30_000, 1),
    followRedirects: o.followRedirects !== false,
    maxRedirects: int(o.maxRedirects, 5, 0),
    fullResponse: o.fullResponse === true,
    responseFormat: format === 'json' || format === 'text' || format === 'binary' ? format : 'auto',
    outputBinaryField:
      typeof o.outputBinaryField === 'string' && o.outputBinaryField ? o.outputBinaryField : 'data',
    neverError: o.neverError === true,
    batchSize: int(o.batchSize, 1, 1),
    batchIntervalMs: int(o.batchIntervalMs, 0, 0),
  };
}

/** Lê o corpo abortando acima do limite (NFR-001): a resposta nunca fica inteira na memória além dele. */
async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? NaN);
  const tooBig = () =>
    new NodeExecutionError(`Resposta acima do limite de ${Math.round(limit / 1024 / 1024)} MB`, {
      httpCode: response.status,
    });
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw tooBig();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) {
    total += (chunk as Uint8Array).byteLength;
    if (total > limit) {
      await response.body.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function detectFormat(contentType: string, body: Buffer): 'json' | 'text' | 'binary' {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (
    body.length === 0 ||
    ct.startsWith('text/') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('x-www-form-urlencoded')
  ) {
    return 'text';
  }
  return 'binary';
}

function fileNameOf(response: Response, url: URL): string | undefined {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (match?.[1]) return decodeURIComponent(match[1]);
  const last = url.pathname.split('/').filter(Boolean).pop();
  return last ? decodeURIComponent(last) : undefined;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error('Execução cancelada'));
      },
      { once: true },
    );
  });
}

async function buildBody(
  ctx: NodeContext,
  item: Item,
  i: number,
  headers: Headers,
): Promise<string | Uint8Array | FormData | URLSearchParams | undefined> {
  if (ctx.getParam('sendBody', i) !== true) return undefined;
  const contentType = text(ctx.getParam('contentType', i)) || 'json';
  const binaryOf = async (field: string) => {
    const ref = item.binary?.[field];
    if (!ref)
      throw new NodeParameterError(field, `o item ${i} não tem a propriedade binária "${field}"`);
    return { ref, data: await ctx.helpers.getBinary(ref) };
  };
  switch (contentType) {
    case 'json': {
      const raw = ctx.getParam('jsonBody', i);
      let value: unknown = raw;
      if (typeof raw === 'string') {
        try {
          value = raw.trim() === '' ? {} : JSON.parse(raw);
        } catch {
          throw new NodeParameterError('jsonBody', 'JSON inválido');
        }
      }
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      return JSON.stringify(value);
    }
    case 'form-urlencoded': {
      const form = new URLSearchParams();
      for (const p of list(ctx.getParam('bodyParameters', i), 'bodyParameters'))
        form.append(text(p.name), text(p.value));
      return form;
    }
    case 'multipart': {
      const form = new FormData();
      for (const p of list(ctx.getParam('bodyParameters', i), 'bodyParameters')) {
        if (p.parameterType === 'binary') {
          const { ref, data } = await binaryOf(text(p.value));
          form.append(
            text(p.name),
            new Blob([data], { type: ref.mimeType }),
            ref.fileName ?? 'arquivo',
          );
        } else form.append(text(p.name), text(p.value));
      }
      return form;
    }
    case 'raw':
      headers.set('content-type', text(ctx.getParam('rawContentType', i)) || 'text/plain');
      return text(ctx.getParam('rawBody', i));
    case 'binary': {
      const { ref, data } = await binaryOf(text(ctx.getParam('inputBinaryField', i)) || 'data');
      if (!headers.has('content-type')) headers.set('content-type', ref.mimeType);
      return data;
    }
    default:
      throw new NodeParameterError(
        'contentType',
        `tipo desconhecido ${JSON.stringify(contentType)}`,
      );
  }
}

async function requestItem(
  ctx: NodeContext,
  item: Item,
  i: number,
  deps: HttpRequestDeps,
  credential: () => Promise<ResolvedCredential>,
): Promise<Item[]> {
  const method = (text(ctx.getParam('method', i)) || 'GET').toUpperCase();
  const rawUrl = text(ctx.getParam('url', i)).trim();
  if (!rawUrl) throw new NodeParameterError('url', 'informe a URL');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NodeParameterError('url', `URL inválida: ${rawUrl}`);
  }
  const options = readOptions(ctx.getParam('options', i));
  const headers = new Headers();
  for (const p of list(ctx.getParam('queryParameters', i), 'queryParameters'))
    url.searchParams.append(text(p.name), text(p.value));
  for (const p of list(ctx.getParam('headers', i), 'headers'))
    headers.set(text(p.name), text(p.value));

  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(options.timeout)]);
  if (ctx.getParam('authentication', i) === 'credential') {
    await applyHttpCredential(
      await credential(),
      { headers, url },
      {
        guard: deps.guard,
        oauth: deps.oauth,
        signal,
        registerSecret: (v) => {
          ctx.helpers.registerSecret(v);
        },
      },
    );
  }
  const body = BODYLESS.has(method) ? undefined : await buildBody(ctx, item, i, headers);

  let response: Response;
  try {
    response = await deps.guard.fetch(url, {
      method,
      headers,
      ...(body !== undefined && { body }),
      signal,
      followRedirects: options.followRedirects,
      maxRedirects: options.maxRedirects,
    });
  } catch (error) {
    if (signal.aborted && !ctx.signal.aborted) {
      throw new NodeExecutionError(`Tempo limite da requisição excedido (${options.timeout} ms)`);
    }
    // O fetch do undici embrulha a causa (ex.: bloqueio do filtro de rede no lookup).
    const cause = (error as { cause?: unknown }).cause;
    throw cause instanceof Error ? cause : error;
  }
  const raw = await readLimited(response, deps.maxResponseBytes);
  const contentType = response.headers.get('content-type') ?? '';

  if (response.status >= 400 && !options.neverError) {
    throw new NodeExecutionError(`A requisição falhou com status ${response.status}`, {
      httpCode: response.status,
      description: raw.subarray(0, ERROR_SNIPPET).toString('utf8'),
    });
  }

  const format =
    options.responseFormat === 'auto' ? detectFormat(contentType, raw) : options.responseFormat;
  const meta = () => ({
    statusCode: response.status,
    statusMessage: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  });
  const paired = { pairedItem: { item: i } };

  if (format === 'binary') {
    const fileName = fileNameOf(response, url);
    const ref: BinaryRef = await ctx.helpers.putBinary(new Uint8Array(raw), {
      mimeType: contentType.split(';')[0]?.trim() || 'application/octet-stream',
      ...(fileName && { fileName }),
    });
    return [
      {
        json: options.fullResponse ? meta() : {},
        binary: { [options.outputBinaryField]: ref },
        ...paired,
      },
    ];
  }

  let parsed: unknown = raw.toString('utf8');
  if (format === 'json') {
    try {
      parsed = raw.length === 0 ? {} : JSON.parse(parsed as string);
    } catch {
      throw new NodeExecutionError('A resposta não é um JSON válido', {
        httpCode: response.status,
        description: raw.subarray(0, ERROR_SNIPPET).toString('utf8'),
      });
    }
  }
  if (options.fullResponse) return [{ json: { ...meta(), body: parsed }, ...paired }];
  // Lista de objetos: um item por elemento, como no N8N.
  if (
    Array.isArray(parsed) &&
    parsed.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x))
  ) {
    return (parsed as Record<string, unknown>[]).map((json) => ({ json, ...paired }));
  }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return [{ json: parsed as Record<string, unknown>, ...paired }];
  }
  return [{ json: { data: parsed }, ...paired }];
}

/**
 * Uma requisição por item, em lotes (`batchSize` simultâneas, `batchIntervalMs` entre lotes).
 * Com `onError: continue`, o item que falha vira `{ json: { error } }` e os demais seguem.
 */
export async function executeHttpRequest(
  input: NodeExecuteInput,
  ctx: NodeContext,
  deps: HttpRequestDeps,
): Promise<NodeOutput> {
  const items = input.items.length > 0 ? input.items : [{ json: {} }];
  let cached: Promise<ResolvedCredential> | undefined;
  const credential = () => (cached ??= ctx.getCredential());
  const continueOnFail = ctx.node.settings?.onError === 'continue';
  const { batchSize, batchIntervalMs } = readOptions(ctx.getParam('options', 0));

  const results: Item[][] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    if (start > 0) await wait(batchIntervalMs, ctx.signal);
    const batch = items.slice(start, start + batchSize).map(async (item, offset) => {
      const i = start + offset;
      try {
        return await requestItem(ctx, item, i, deps, credential);
      } catch (error) {
        if (!continueOnFail || ctx.signal.aborted) throw error;
        return [{ json: errorJson(error), pairedItem: { item: i } }];
      }
    });
    results.push(...(await Promise.all(batch)));
  }
  return { main: results.flat() };
}
