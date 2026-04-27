import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { ConfigError } from "../utils/errors.js";

const integerFromEnv = (fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "string") return Number.parseInt(value, 10);
    return value;
  }, z.number().int().positive());

const optionalString = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}, z.string().trim().min(1).optional());

const envSchema = z.object({
  LINEAR_API_KEY: optionalString,
  LINEAR_API_URL: z
    .preprocess((value) => value || "https://api.linear.app/graphql", z.string().url())
    .default("https://api.linear.app/graphql"),
  LINEAR_DEFAULT_TEAM: optionalString,
  LINEAR_DEFAULT_PROJECT: optionalString,
  LINEAR_WEBHOOK_SECRET: optionalString,
  LINEAR_LOCAL_BEARER_TOKEN: optionalString,
  LINEAR_HTTP_HOST: z.preprocess((value) => value || "127.0.0.1", z.string().min(1)).default("127.0.0.1"),
  LINEAR_HTTP_PORT: integerFromEnv(8787).default(8787),
  LINEAR_QUEUE_FILE: z.preprocess(
    (value) => value || ".linear-tool/queue.jsonl",
    z.string().min(1)
  ).default(".linear-tool/queue.jsonl"),
  LINEAR_LOG_LEVEL: z
    .preprocess((value) => value || "info", z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]))
    .default("info"),
  LINEAR_REQUEST_TIMEOUT_MS: integerFromEnv(15000).default(15000),
  LINEAR_MAX_RETRIES: integerFromEnv(3).default(3),
  LINEAR_CACHE_TTL_MS: integerFromEnv(300000).default(300000)
});

export type AppConfig = {
  apiKey?: string;
  apiUrl: string;
  defaultTeam?: string;
  defaultProject?: string;
  webhookSecret?: string;
  localBearerToken?: string;
  httpHost: string;
  httpPort: number;
  queueFile: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  requestTimeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
};

export type LoadConfigOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envFile?: string;
  requireApiKey?: boolean;
};

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const cwd = options.cwd ?? process.cwd();
  const envFile = options.envFile ?? path.join(cwd, ".env");

  if (!options.env) {
    loadDotenv({ path: envFile, quiet: true });
  }

  const source = options.env ?? process.env;
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new ConfigError("Invalid configuration", parsed.error.flatten());
  }

  if (options.requireApiKey && !parsed.data.LINEAR_API_KEY) {
    throw new ConfigError("LINEAR_API_KEY is required for Linear API operations");
  }

  const queueFile = path.isAbsolute(parsed.data.LINEAR_QUEUE_FILE)
    ? parsed.data.LINEAR_QUEUE_FILE
    : path.join(cwd, parsed.data.LINEAR_QUEUE_FILE);

  return {
    apiKey: parsed.data.LINEAR_API_KEY,
    apiUrl: parsed.data.LINEAR_API_URL,
    defaultTeam: parsed.data.LINEAR_DEFAULT_TEAM,
    defaultProject: parsed.data.LINEAR_DEFAULT_PROJECT,
    webhookSecret: parsed.data.LINEAR_WEBHOOK_SECRET,
    localBearerToken: parsed.data.LINEAR_LOCAL_BEARER_TOKEN,
    httpHost: parsed.data.LINEAR_HTTP_HOST,
    httpPort: parsed.data.LINEAR_HTTP_PORT,
    queueFile,
    logLevel: parsed.data.LINEAR_LOG_LEVEL,
    requestTimeoutMs: parsed.data.LINEAR_REQUEST_TIMEOUT_MS,
    maxRetries: parsed.data.LINEAR_MAX_RETRIES,
    cacheTtlMs: parsed.data.LINEAR_CACHE_TTL_MS
  };
}
