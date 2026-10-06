import { createMasker, type Masker } from '@olly/engine';
import { DEFAULT_MASKING_RULES } from '@olly/shared-types';
import { IncomingMessage, ServerResponse } from 'node:http';
import { stdSerializers, type LoggerOptions } from 'pino';

/**
 * Mascaramento dos logs (spec 009, FR-014): começa com as regras padrão (FR-016) e passa a usar
 * as regras globais do banco assim que o `MaskingService` as carrega. Global de propósito: o
 * pino é configurado antes de o Nest montar os serviços.
 */
export const logMasking: { current: Masker } = {
  current: createMasker(DEFAULT_MASKING_RULES, { salt: '' }),
};

/**
 * O pino mascara (`formatters.log`) antes de serializar: `req`, `res` e `err` ainda são objetos
 * do Node, que o masker não percorre. A URL, a query e a mensagem do erro só existem depois dos
 * serializers; por isso eles também mascaram, sobre uma cópia simples do objeto serializado.
 */
const maskSerialized =
  (serialize: (value: never) => unknown) =>
  (value: unknown): unknown => {
    // Com o pino-http, o valor já chega serializado (objeto com protótipo próprio).
    const serialized: unknown =
      value instanceof Error || isNodeMessage(value) ? serialize(value as never) : value;
    return serialized !== null && typeof serialized === 'object'
      ? logMasking.current.mask({ ...serialized }).value
      : serialized;
  };

function isNodeMessage(value: unknown): boolean {
  return value instanceof IncomingMessage || value instanceof ServerResponse;
}

/** Opções do pino que mascaram o objeto e as mensagens de cada linha de log. */
export const maskingLogOptions: Pick<LoggerOptions, 'formatters' | 'hooks' | 'serializers'> = {
  serializers: {
    req: maskSerialized(stdSerializers.req),
    res: maskSerialized(stdSerializers.res),
    err: maskSerialized(stdSerializers.err),
  },
  formatters: {
    log: (object) => logMasking.current.mask(object).value,
  },
  hooks: {
    logMethod(args, method) {
      const masked = args.map((a: unknown) =>
        typeof a === 'string' ? logMasking.current.maskText(a) : a,
      ) as Parameters<typeof method>;
      method.apply(this, masked);
    },
  },
};
