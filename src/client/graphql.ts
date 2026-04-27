import { setTimeout as sleep } from "node:timers/promises";
import type { AppConfig } from "../config/config.js";
import { ConfigError, LinearApiError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { silentLogger } from "../utils/logger.js";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{
    message: string;
    path?: Array<string | number>;
    extensions?: Record<string, unknown>;
  }>;
};

export type GraphQLClientOptions = Pick<AppConfig, "apiKey" | "apiUrl" | "requestTimeoutMs" | "maxRetries"> & {
  logger?: Logger;
};

export class LinearGraphQLClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly logger: Logger;

  constructor(options: GraphQLClientOptions) {
    if (!options.apiKey) {
      throw new ConfigError("LINEAR_API_KEY is required for Linear API operations");
    }
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl;
    this.timeoutMs = options.requestTimeoutMs;
    this.maxRetries = options.maxRetries;
    this.logger = options.logger ?? silentLogger;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(this.apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: this.apiKey
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal
        });

        const rateLimit = readRateLimitHeaders(response.headers);
        const text = await response.text();
        const body = parseGraphQLBody<T>(text);

        if (!response.ok) {
          const code = firstGraphQLErrorCode(body);
          throw new LinearApiError(graphQLErrorMessage(body) ?? `Linear API returned HTTP ${response.status}`, {
            code: code ?? "LINEAR_HTTP_ERROR",
            httpStatus: response.status,
            details: body,
            rateLimit
          });
        }

        if (body.errors?.length) {
          const code = firstGraphQLErrorCode(body);
          throw new LinearApiError(graphQLErrorMessage(body) ?? "Linear API returned GraphQL errors", {
            code: code ?? "LINEAR_GRAPHQL_ERROR",
            details: body.errors,
            rateLimit
          });
        }

        if (!body.data) {
          throw new LinearApiError("Linear API response did not include data", { details: body, rateLimit });
        }

        return body.data;
      } catch (error) {
        lastError = error;
        clearTimeout(timeout);

        if (!shouldRetry(error) || attempt >= this.maxRetries) {
          throw normalizeRequestError(error);
        }

        const delayMs = retryDelay(attempt);
        this.logger.warn({ err: error, attempt, delayMs }, "Retrying Linear GraphQL request");
        await sleep(delayMs);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw normalizeRequestError(lastError);
  }
}

function parseGraphQLBody<T>(text: string): GraphQLResponse<T> {
  try {
    return JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    throw new LinearApiError("Linear API returned non-JSON response", { details: text.slice(0, 500) });
  }
}

function firstGraphQLErrorCode(body: GraphQLResponse<unknown>): string | undefined {
  const code = body.errors?.[0]?.extensions?.code;
  return typeof code === "string" ? code : undefined;
}

function graphQLErrorMessage(body: GraphQLResponse<unknown>): string | undefined {
  if (!body.errors?.length) return undefined;
  return body.errors.map((error) => error.message).join("; ");
}

function readRateLimitHeaders(headers: Headers): Record<string, string | undefined> {
  return {
    requestLimit: headers.get("x-ratelimit-requests-limit") ?? undefined,
    requestRemaining: headers.get("x-ratelimit-requests-remaining") ?? undefined,
    requestReset: headers.get("x-ratelimit-requests-reset") ?? undefined,
    complexity: headers.get("x-complexity") ?? undefined,
    complexityLimit: headers.get("x-ratelimit-complexity-limit") ?? undefined,
    complexityRemaining: headers.get("x-ratelimit-complexity-remaining") ?? undefined,
    complexityReset: headers.get("x-ratelimit-complexity-reset") ?? undefined
  };
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof LinearApiError) {
    if (error.httpStatus && error.httpStatus >= 500) return true;
    return error.code === "INTERNAL_SERVER_ERROR" || error.code === "SERVER_ERROR";
  }

  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.includes("fetch failed");
  }

  return false;
}

function normalizeRequestError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new LinearApiError("Linear request failed", { details: error });
}

function retryDelay(attempt: number): number {
  const base = 300 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(base + jitter, 5000);
}
