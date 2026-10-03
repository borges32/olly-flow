/** Erros de domínio. O `DomainExceptionFilter` é o único ponto que os traduz para HTTP. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
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
