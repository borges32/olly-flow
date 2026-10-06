import { createMasker, type Masker } from '@olly/engine';
import { DEFAULT_MASKING_RULES } from '@olly/shared-types';
import type { LoggerOptions } from 'pino';

/**
 * Mascaramento dos logs (spec 009, FR-014): começa com as regras padrão (FR-016) e passa a usar
 * as regras globais do banco assim que o `MaskingService` as carrega. Global de propósito: o
 * pino é configurado antes de o Nest montar os serviços.
 */
export const logMasking: { current: Masker } = {
  current: createMasker(DEFAULT_MASKING_RULES, { salt: '' }),
};

/** Opções do pino que mascaram o objeto e as mensagens de cada linha de log. */
export const maskingLogOptions: Pick<LoggerOptions, 'formatters' | 'hooks'> = {
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
