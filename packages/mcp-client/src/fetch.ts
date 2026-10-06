import { AsyncLocalStorage } from 'node:async_hooks';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpResultTooLargeError } from './errors.js';

/** Resposta do `fetch` com anti-SSRF (`HttpGuard.fetch` de `@olly/nodes`, spec 004). */
export interface GuardedFetchResponse {
  status: number;
  statusText: string;
  headers: { forEach(callback: (value: string, key: string) => void): void };
  body: ReadableStream<Uint8Array> | null;
}

export interface GuardedFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  signal?: AbortSignal | null;
  followRedirects: false;
}

export type GuardedFetch = (
  url: string | URL,
  init: GuardedFetchInit,
) => Promise<GuardedFetchResponse>;

/**
 * Chamada MCP em andamento. O POST de uma requisição sai no contexto assíncrono da chamada:
 * ao passar do limite, só aquela chamada é abortada (o SDK, sozinho, tentaria retomar o stream
 * e a chamada esperaria o timeout).
 */
export const mcpCallContext = new AsyncLocalStorage<{ fail(error: Error): void }>();

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * `fetch` dos transportes MCP (FR-004, SC-005): toda requisição passa pelo filtro anti-SSRF.
 * Os redirecionamentos ficam com o SDK (só na mesma origem), e cada salto volta a passar pelo
 * filtro. O corpo das respostas a POST (as que trazem os resultados) é limitado a
 * `maxBodyBytes` enquanto chega (FR-006): um resultado gigante nunca fica inteiro na memória.
 *
 * A resposta é convertida para a `Response` global: o SDK usa `instanceof Response`.
 */
export function guardedFetchLike(guarded: GuardedFetch, maxBodyBytes: number): FetchLike {
  return async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = headersRecord(init.headers);
    let body: string | null = null;
    if (typeof init.body === 'string') body = init.body;
    else if (init.body instanceof URLSearchParams) {
      // Requisições OAuth do SDK (token, registro): formulário, como o `fetch` faria.
      body = init.body.toString();
      headers['content-type'] ??= 'application/x-www-form-urlencoded;charset=UTF-8';
    } else if (init.body !== undefined && init.body !== null) {
      throw new TypeError('Corpo de requisição MCP não suportado');
    }
    const res = await guarded(url, {
      method,
      headers,
      body,
      signal: init.signal ?? null,
      followRedirects: false,
    });
    const responseHeaders = new Headers();
    res.headers.forEach((value, key) => {
      responseHeaders.append(key, value);
    });
    let stream: ReadableStream<Uint8Array> | null = NULL_BODY_STATUSES.has(res.status)
      ? null
      : res.body;
    if (stream && method === 'POST') {
      const call = mcpCallContext.getStore();
      stream = stream.pipeThrough(byteLimit(maxBodyBytes, (error) => call?.fail(error)));
    }
    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  };
}

function headersRecord(input: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(input).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Interrompe o stream ao passar do limite. */
export function byteLimit(
  limit: number,
  onExceeded?: (error: McpResultTooLargeError) => void,
): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > limit) {
        const error = new McpResultTooLargeError(limit);
        onExceeded?.(error);
        controller.error(error);
      } else controller.enqueue(chunk);
    },
  });
}
