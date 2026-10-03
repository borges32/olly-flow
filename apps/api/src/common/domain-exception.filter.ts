import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorBody } from '@olly/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from './errors.js';

const HTTP_CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'bad_request',
  [HttpStatus.UNAUTHORIZED]: 'unauthenticated',
  [HttpStatus.FORBIDDEN]: 'permission_denied',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'method_not_allowed',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'payload_too_large',
  [HttpStatus.TOO_MANY_REQUESTS]: 'too_many_requests',
};

/** Mapeia `DomainError` e `HttpException` para o corpo padrão; o resto vira 500 sem detalhes. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { status, code, message } = this.describe(exception);

    if (status >= 500) {
      this.logger.error({ err: exception, requestId: request.id }, message);
    }
    const body: ApiErrorBody = { error: { code, message, requestId: request.id } };
    void reply.status(status).send(body);
  }

  private describe(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof DomainError) {
      return { status: exception.httpStatus, code: exception.code, message: exception.message };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: HTTP_CODES[status] ?? (status >= 500 ? 'internal_error' : 'http_error'),
        message: status >= 500 ? 'Erro interno do servidor' : exception.message,
      };
    }
    return { status: 500, code: 'internal_error', message: 'Erro interno do servidor' };
  }
}
