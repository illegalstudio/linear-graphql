import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import type { AppConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { commentAddSchema, issueCreateSchema, issueSearchSchema, issueUpdateSchema } from "../domain/schemas.js";
import type { Runtime } from "../tools/linearTools.js";
import { createRuntime } from "../tools/linearTools.js";
import { AppError, AuthError, errorToJson, isAppError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { createLogger } from "../utils/logger.js";
import { handleLinearWebhook } from "../webhook/router.js";

const issueViewSchema = z.object({ id: z.string().trim().min(1) });
const queuePopSchema = z.object({ leaseMs: z.coerce.number().int().positive().optional() }).default({});
const queueCompleteSchema = z.object({ id: z.string().trim().min(1), claimToken: z.string().optional() });
const commentListSchema = z.object({ issue: z.string().trim().min(1), limit: z.coerce.number().int().min(1).max(100).optional() });

export function createHttpServer(runtime: Runtime, logger: Logger): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, {
          ok: true,
          service: "linear-graphql-tool",
          hasLinearApiKey: Boolean(runtime.config.apiKey),
          hasWebhookSecret: Boolean(runtime.config.webhookSecret),
          queueFile: runtime.config.queueFile
        });
        return;
      }

      const rawBody = await readBody(req);

      if (method === "POST" && url.pathname === "/hooks/linear") {
        const result = await handleLinearWebhook({
          rawBody,
          signature: header(req, "linear-signature"),
          config: runtime.config,
          queue: runtime.queue,
          logger
        });
        writeJson(res, 202, result);
        return;
      }

      requireLocalAuth(runtime.config, req);

      if (method === "POST" && url.pathname === "/issue/search") {
        writeJson(res, 200, await runtime.tools.searchIssues(issueSearchSchema.parse(parseJson(rawBody))));
        return;
      }

      if (method === "POST" && url.pathname === "/issue/view") {
        writeJson(res, 200, await runtime.tools.getIssue(issueViewSchema.parse(parseJson(rawBody))));
        return;
      }

      if (method === "POST" && url.pathname === "/issue/create") {
        writeJson(res, 201, await runtime.tools.createIssue(issueCreateSchema.parse(parseJson(rawBody))));
        return;
      }

      if (method === "POST" && url.pathname === "/issue/update") {
        writeJson(res, 200, await runtime.tools.updateIssue(issueUpdateSchema.parse(parseJson(rawBody))));
        return;
      }

      if (method === "POST" && url.pathname === "/comment/add") {
        writeJson(res, 201, await runtime.tools.addComment(commentAddSchema.parse(parseJson(rawBody))));
        return;
      }

      if (method === "POST" && url.pathname === "/comment/list") {
        writeJson(res, 200, await runtime.tools.listComments(commentListSchema.parse(parseJson(rawBody))));
        return;
      }

      if (method === "GET" && url.pathname === "/queue") {
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
        writeJson(res, 200, await runtime.queue.list(Number.isFinite(limit) ? limit : 50));
        return;
      }

      if (method === "POST" && url.pathname === "/queue/pop") {
        writeJson(res, 200, await runtime.tools.popQueue(queuePopSchema.parse(parseJson(rawBody))));
        return;
      }

      if (method === "POST" && url.pathname === "/queue/complete") {
        writeJson(res, 200, await runtime.tools.completeQueueItem(queueCompleteSchema.parse(parseJson(rawBody))));
        return;
      }

      writeJson(res, 404, { error: { code: "NOT_FOUND", message: `Route ${method} ${url.pathname} not found` } });
    } catch (error) {
      logger.error({ err: error }, "HTTP request failed");
      writeJson(res, httpStatusForError(error), errorToJson(error));
    }
  });
}

export async function startHttpServer(runtime: Runtime, logger: Logger): Promise<http.Server> {
  const server = createHttpServer(runtime, logger);
  await new Promise<void>((resolve) => {
    server.listen(runtime.config.httpPort, runtime.config.httpHost, resolve);
  });
  logger.info({ host: runtime.config.httpHost, port: runtime.config.httpPort }, "Linear tool HTTP server listening");
  return server;
}

function requireLocalAuth(config: AppConfig, req: IncomingMessage): void {
  if (!config.localBearerToken) return;
  const authorization = header(req, "authorization");
  if (authorization !== `Bearer ${config.localBearerToken}`) {
    throw new AuthError("Missing or invalid local bearer token");
  }
}

function parseJson(rawBody: string): unknown {
  if (!rawBody.trim()) return {};
  return JSON.parse(rawBody);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function httpStatusForError(error: unknown): number {
  if (error instanceof AuthError) return 401;
  if (isAppError(error)) {
    if (error.category === "user") return 400;
    if (error.category === "not_found") return 404;
    if (error.category === "config") return 500;
    if (error.category === "linear_api") return 502;
  }
  if (error instanceof z.ZodError) return 400;
  if (error instanceof SyntaxError) return 400;
  if (error instanceof AppError) return error.statusCode;
  return 500;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig({ requireApiKey: false });
  const logger = createLogger(config);
  startHttpServer(createRuntime(config, logger), logger).catch((error) => {
    logger.error({ err: error }, "Failed to start server");
    process.exitCode = 1;
  });
}
