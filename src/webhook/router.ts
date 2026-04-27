import { createHash } from "node:crypto";
import type { AppConfig } from "../config/config.js";
import type { FileQueue, QueueItem } from "../queue/fileQueue.js";
import { AuthError, ConfigError, UserInputError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { silentLogger } from "../utils/logger.js";
import { verifyLinearSignature } from "./signature.js";

export type LinearWebhookPayload = {
  action?: string;
  type?: string;
  createdAt?: string;
  webhookTimestamp?: number;
  organizationId?: string;
  data?: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
  [key: string]: unknown;
};

export type RoutedLinearEvent = {
  queueType: string;
  priority: number;
  dedupKey: string;
  payload: {
    source: "linear";
    route: string;
    action?: string;
    type?: string;
    data?: Record<string, unknown>;
    updatedFrom?: Record<string, unknown>;
    receivedAt: string;
    raw: LinearWebhookPayload;
  };
};

export async function handleLinearWebhook(
  args: {
    rawBody: string;
    signature?: string;
    config: Pick<AppConfig, "webhookSecret">;
    queue: FileQueue;
    logger?: Logger;
  }
): Promise<{ item: QueueItem; deduped: boolean; route: string }> {
  const logger = args.logger ?? silentLogger;
  if (!args.config.webhookSecret) {
    throw new ConfigError("LINEAR_WEBHOOK_SECRET is required to receive Linear webhooks");
  }

  if (!verifyLinearSignature(args.rawBody, args.signature, args.config.webhookSecret)) {
    throw new AuthError("Invalid Linear webhook signature");
  }

  const payload = parsePayload(args.rawBody);
  const routed = routeLinearEvent(payload, args.rawBody);
  logger.info(
    { route: routed.payload.route, type: payload.type, action: payload.action, dedupKey: routed.dedupKey },
    "Received Linear webhook"
  );

  const result = await args.queue.enqueue({
    type: routed.queueType,
    priority: routed.priority,
    dedupKey: routed.dedupKey,
    payload: routed.payload
  });

  return { ...result, route: routed.payload.route };
}

export function routeLinearEvent(payload: LinearWebhookPayload, rawBody = JSON.stringify(payload)): RoutedLinearEvent {
  const type = typeof payload.type === "string" ? payload.type : "unknown";
  const action = typeof payload.action === "string" ? payload.action : "unknown";
  const normalizedType = type.toLowerCase();
  const normalizedAction = action.toLowerCase();
  const route = classifyRoute(normalizedType, normalizedAction, payload);
  const hash = createHash("sha256").update(rawBody).digest("hex").slice(0, 20);
  const objectId = typeof payload.data?.id === "string" ? payload.data.id : "unknown";
  const eventTime = payload.createdAt ?? payload.webhookTimestamp ?? "unknown";

  return {
    queueType: `linear.${route}`,
    priority: priorityForRoute(route),
    dedupKey: `linear:${normalizedType}:${normalizedAction}:${objectId}:${eventTime}:${hash}`,
    payload: {
      source: "linear",
      route,
      action,
      type,
      data: payload.data,
      updatedFrom: payload.updatedFrom,
      receivedAt: new Date().toISOString(),
      raw: payload
    }
  };
}

function parsePayload(rawBody: string): LinearWebhookPayload {
  try {
    const parsed = JSON.parse(rawBody) as LinearWebhookPayload;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("payload is not an object");
    }
    return parsed;
  } catch (error) {
    throw new UserInputError("Linear webhook payload is not valid JSON", { error });
  }
}

function classifyRoute(type: string, action: string, payload: LinearWebhookPayload): string {
  if (type === "issue") {
    if (action === "create") return "issue.created";
    if (action === "remove") return "issue.removed";
    if (action === "update") {
      if (payload.updatedFrom && "assigneeId" in payload.updatedFrom) return "issue.assignee_changed";
      if (payload.updatedFrom && "stateId" in payload.updatedFrom) return "issue.state_changed";
      return "issue.updated";
    }
  }

  if (type === "comment") {
    if (action === "create") return commentLooksLikeMention(payload) ? "comment.mention" : "comment.created";
    if (action === "update") return "comment.updated";
  }

  return `${type || "unknown"}.${action || "unknown"}`;
}

function commentLooksLikeMention(payload: LinearWebhookPayload): boolean {
  const body = payload.data?.body;
  return typeof body === "string" && /(^|\s)@[\w.-]+/.test(body);
}

function priorityForRoute(route: string): number {
  if (route === "comment.mention") return 90;
  if (route.startsWith("comment.")) return 60;
  if (route === "issue.created" || route === "issue.state_changed" || route === "issue.assignee_changed") return 50;
  if (route.startsWith("issue.")) return 30;
  return 0;
}
