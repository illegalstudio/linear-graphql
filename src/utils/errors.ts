export type ErrorCategory = "config" | "user" | "auth" | "linear_api" | "runtime" | "not_found";

export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, options: { category: ErrorCategory; code: string; statusCode?: number; details?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.category = options.category;
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { category: "config", code: "CONFIG_ERROR", statusCode: 78, details });
  }
}

export class UserInputError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { category: "user", code: "USER_INPUT_ERROR", statusCode: 2, details });
  }
}

export class AuthError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { category: "auth", code: "AUTH_ERROR", statusCode: 77, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { category: "not_found", code: "NOT_FOUND", statusCode: 404, details });
  }
}

export class LinearApiError extends AppError {
  readonly httpStatus?: number;
  readonly rateLimit?: Record<string, string | undefined>;

  constructor(
    message: string,
    options: { code?: string; httpStatus?: number; details?: unknown; rateLimit?: Record<string, string | undefined> } = {}
  ) {
    super(message, {
      category: "linear_api",
      code: options.code ?? "LINEAR_API_ERROR",
      statusCode: options.httpStatus ?? 70,
      details: options.details
    });
    this.httpStatus = options.httpStatus;
    this.rateLimit = options.rateLimit;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function errorToJson(error: unknown): Record<string, unknown> {
  if (isAppError(error)) {
    return {
      error: {
        code: error.code,
        category: error.category,
        message: error.message,
        details: error.details
      }
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        code: "RUNTIME_ERROR",
        category: "runtime",
        message: error.message
      }
    };
  }

  return {
    error: {
      code: "UNKNOWN_ERROR",
      category: "runtime",
      message: String(error)
    }
  };
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof ConfigError) return 78;
  if (error instanceof AuthError) return 77;
  if (error instanceof UserInputError) return 2;
  if (error instanceof LinearApiError) return 70;
  if (error instanceof NotFoundError) return 4;
  return 1;
}
