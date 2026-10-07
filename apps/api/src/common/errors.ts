import type { ApiIssue } from '@olly/shared-types';

/** Erros de domínio. O `DomainExceptionFilter` é o único ponto que os traduz para HTTP. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  /** Detalhes devolvidos ao cliente (nunca dados sensíveis). */
  issues?: ApiIssue[];

  constructor(message: string, options?: ErrorOptions & { issues?: ApiIssue[] }) {
    super(message, options);
    this.name = new.target.name;
    if (options?.issues) this.issues = options.issues;
  }
}

/** Corpo ou parâmetros da requisição fora do schema. */
export class ValidationError extends DomainError {
  readonly code = 'validation_failed';
  readonly httpStatus = 400;
}

/** Corpo bem formado, mas que viola regras de negócio (ex.: workflow com ciclo). */
export class UnprocessableError extends DomainError {
  readonly code = 'unprocessable';
  readonly httpStatus = 422;
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'unauthenticated';
  readonly httpStatus = 401;
}

export class PermissionDeniedError extends DomainError {
  readonly code = 'permission_denied';
  readonly httpStatus = 403;
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found';
  readonly httpStatus = 404;
}

export class ConflictError extends DomainError {
  readonly code = 'conflict';
  readonly httpStatus = 409;
}

export class DependencyUnavailableError extends DomainError {
  readonly code = 'dependency_unavailable';
  readonly httpStatus = 503;
}

/** Spec 014 (FR-007): senha definida pela administração precisa ser trocada antes. */
export class PasswordChangeRequiredError extends DomainError {
  readonly code = 'password_change_required';
  readonly httpStatus = 403;
}

export class TooManyRequestsError extends DomainError {
  readonly code = 'too_many_requests';
  readonly httpStatus = 429;
}
