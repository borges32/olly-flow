import type { ApiErrorBody } from '@olly/shared-types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  getAccessToken: () => string | undefined;
  /** 401: sessão inválida; o app leva ao login. */
  onUnauthorized: () => void;
  /** 403: o app avisa que o acesso foi negado. */
  onForbidden: (message: string) => void;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? '';

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = options.getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown =
      res.status === 204 ? undefined : await res.json().catch(() => undefined);
    if (res.ok) return payload as T;

    const err = isApiErrorBody(payload) ? payload.error : undefined;
    const error = new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? res.statusText,
      err?.requestId,
    );
    if (res.status === 401) options.onUnauthorized();
    if (res.status === 403) options.onForbidden(error.message);
    throw error;
  }

  return { request, get: (path) => request('GET', path) };
}
