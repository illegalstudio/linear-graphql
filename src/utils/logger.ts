import pino from "pino";
import type { AppConfig } from "../config/config.js";

export type Logger = pino.Logger;

export function createLogger(config?: Pick<AppConfig, "logLevel">): Logger {
  return pino({
    level: config?.logLevel ?? process.env.LINEAR_LOG_LEVEL ?? "info",
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export const silentLogger = pino({ level: "silent", base: undefined });
