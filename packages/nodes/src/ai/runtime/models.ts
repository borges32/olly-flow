import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import type { ResolvedCredential } from '../../credentials/definitions.js';
import { FakeScriptedChatModel, type FakeModelStep } from './fake-model.js';
import type { ChatModelProvider } from './types.js';

/** Credencial → provedor (ADR-0008). */
export const PROVIDER_BY_CREDENTIAL: Record<string, ChatModelProvider> = {
  openAiCompatible: 'openai',
  anthropic: 'anthropic',
  googleGemini: 'google',
  fakeLlm: 'fake',
};

/** Endpoint compatível com a API OpenAI do Gemini: passa pelo `fetch` com anti-SSRF. */
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

export interface ModelOptions {
  model: string;
  /** Ausente: não vai ao provedor (o modelo usa o próprio padrão). */
  temperature?: number | undefined;
  topP?: number | undefined;
  /** 0 ou ausente: o padrão do provedor. */
  maxTokens?: number;
  timeoutMs: number;
  maxRetries: number;
  /** `fetch` com anti-SSRF (toda chamada de saída passa pelo filtro, constituição III.5). */
  fetch: typeof fetch;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** Instancia o modelo de chat do LangChain para a credencial (spec 011, FR-002). */
export function createChatModel(
  credential: ResolvedCredential,
  options: ModelOptions,
): BaseChatModel {
  const data = credential.data;
  const common = {
    model: options.model,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.topP !== undefined && { topP: options.topP }),
    ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
    maxRetries: options.maxRetries,
  };
  switch (credential.type) {
    case 'openAiCompatible':
    case 'googleGemini':
      return new ChatOpenAI({
        ...common,
        apiKey: String(data.apiKey),
        timeout: options.timeoutMs,
        configuration: {
          baseURL:
            str(data.baseURL) ??
            (credential.type === 'googleGemini' ? GEMINI_OPENAI_BASE_URL : undefined),
          ...(str(data.organization) && { organization: str(data.organization) }),
          fetch: options.fetch,
        },
      });
    case 'anthropic':
      return new ChatAnthropic({
        ...common,
        apiKey: String(data.apiKey),
        clientOptions: {
          ...(str(data.baseURL) && { baseURL: str(data.baseURL) }),
          timeout: options.timeoutMs,
          fetch: options.fetch,
        },
      });
    case 'fakeLlm': {
      const raw = data.script;
      let script: unknown;
      try {
        script = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
      } catch {
        throw new Error('Roteiro do modelo simulado: JSON inválido');
      }
      if (!Array.isArray(script)) throw new Error('Roteiro do modelo simulado: deve ser uma lista');
      return new FakeScriptedChatModel(script as FakeModelStep[]);
    }
    default:
      throw new Error(`Credencial do tipo ${credential.type} não serve para modelos de chat`);
  }
}
