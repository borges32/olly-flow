import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ValidationError } from './errors.js';

/** Valida corpo, query ou parâmetro com zod na fronteira da API (constituição, Art. III.6). */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new ValidationError('Requisição inválida', {
      issues: parsed.error.issues.map((i) => ({
        code: i.code,
        message: i.message,
        path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
      })),
    });
  }
}
