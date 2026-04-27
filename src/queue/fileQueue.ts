import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NotFoundError, UserInputError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { silentLogger } from "../utils/logger.js";

export type QueueStatus = "pending" | "claimed" | "completed" | "dead";

export type QueueItem = {
  id: string;
  type: string;
  payload: unknown;
  dedupKey?: string;
  priority: number;
  status: QueueStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  claimToken?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  lastError?: string;
};

export type EnqueueInput = {
  type: string;
  payload: unknown;
  dedupKey?: string;
  priority?: number;
  maxAttempts?: number;
  availableAt?: string;
};

type QueueRecord =
  | { op: "enqueue"; at: string; item: QueueItem }
  | { op: "claim"; at: string; id: string; claimToken: string; leaseExpiresAt: string; attempts: number }
  | { op: "complete"; at: string; id: string }
  | { op: "fail"; at: string; id: string; error: string; availableAt?: string; dead: boolean }
  | { op: "release"; at: string; id: string };

export class FileQueue {
  constructor(
    private readonly filePath: string,
    private readonly logger: Logger = silentLogger
  ) {}

  async enqueue(input: EnqueueInput): Promise<{ item: QueueItem; deduped: boolean }> {
    const items = await this.loadWithRecovery();
    if (input.dedupKey) {
      const existing = [...items.values()].find(
        (item) => item.dedupKey === input.dedupKey && item.status !== "completed" && item.status !== "dead"
      );
      if (existing) return { item: existing, deduped: true };
    }

    const now = new Date().toISOString();
    const item: QueueItem = {
      id: randomUUID(),
      type: input.type,
      payload: input.payload,
      dedupKey: input.dedupKey,
      priority: input.priority ?? 0,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      availableAt: input.availableAt ?? now,
      createdAt: now,
      updatedAt: now
    };

    await this.append({ op: "enqueue", at: now, item });
    return { item, deduped: false };
  }

  async peek(limit = 10): Promise<QueueItem[]> {
    const items = await this.loadWithRecovery();
    return sortAvailable([...items.values()]).slice(0, limit);
  }

  async list(limit = 50): Promise<QueueItem[]> {
    const items = await this.loadWithRecovery();
    return sortQueue([...items.values()]).slice(0, limit);
  }

  async pop(options: { leaseMs?: number } = {}): Promise<QueueItem | null> {
    const leaseMs = options.leaseMs ?? 5 * 60 * 1000;
    const items = await this.loadWithRecovery();
    const item = sortAvailable([...items.values()])[0];
    if (!item) return null;

    const now = new Date();
    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const attempts = item.attempts + 1;

    await this.append({
      op: "claim",
      at: now.toISOString(),
      id: item.id,
      claimToken,
      leaseExpiresAt,
      attempts
    });

    return {
      ...item,
      status: "claimed",
      attempts,
      claimedAt: now.toISOString(),
      claimToken,
      leaseExpiresAt,
      updatedAt: now.toISOString()
    };
  }

  async complete(id: string, claimToken?: string): Promise<QueueItem> {
    const items = await this.loadWithRecovery();
    const item = requireItem(items, id);
    ensureClaimToken(item, claimToken);
    const now = new Date().toISOString();
    await this.append({ op: "complete", at: now, id });
    return {
      ...item,
      status: "completed",
      completedAt: now,
      updatedAt: now
    };
  }

  async fail(id: string, error: string, options: { retry?: boolean; delayMs?: number; claimToken?: string } = {}): Promise<QueueItem> {
    const items = await this.loadWithRecovery();
    const item = requireItem(items, id);
    ensureClaimToken(item, options.claimToken);

    const now = new Date();
    const shouldRetry = options.retry ?? item.attempts < item.maxAttempts;
    const dead = !shouldRetry || item.attempts >= item.maxAttempts;
    const availableAt = dead
      ? undefined
      : new Date(now.getTime() + (options.delayMs ?? retryDelayMs(item.attempts))).toISOString();

    await this.append({
      op: "fail",
      at: now.toISOString(),
      id,
      error,
      availableAt,
      dead
    });

    return {
      ...item,
      status: dead ? "dead" : "pending",
      availableAt: availableAt ?? item.availableAt,
      claimToken: undefined,
      claimedAt: undefined,
      leaseExpiresAt: undefined,
      lastError: error,
      updatedAt: now.toISOString()
    };
  }

  private async loadWithRecovery(): Promise<Map<string, QueueItem>> {
    const items = await this.load();
    const now = Date.now();

    for (const item of items.values()) {
      if (item.status === "claimed" && item.leaseExpiresAt && Date.parse(item.leaseExpiresAt) <= now) {
        const at = new Date().toISOString();
        await this.append({ op: "release", at, id: item.id });
        item.status = "pending";
        item.claimToken = undefined;
        item.claimedAt = undefined;
        item.leaseExpiresAt = undefined;
        item.updatedAt = at;
        this.logger.warn({ id: item.id }, "Recovered expired queue claim");
      }
    }

    return items;
  }

  private async load(): Promise<Map<string, QueueItem>> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    let raw = "";
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw error;
    }

    const items = new Map<string, QueueItem>();
    const lines = raw.split("\n").filter(Boolean);
    for (const [index, line] of lines.entries()) {
      let record: QueueRecord;
      try {
        record = JSON.parse(line) as QueueRecord;
      } catch (error) {
        throw new UserInputError(`Queue file contains invalid JSONL at line ${index + 1}`, { file: this.filePath, error });
      }
      applyRecord(items, record);
    }
    return items;
  }

  private async append(record: QueueRecord): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}

function applyRecord(items: Map<string, QueueItem>, record: QueueRecord): void {
  if (record.op === "enqueue") {
    items.set(record.item.id, record.item);
    return;
  }

  const item = items.get(record.id);
  if (!item) return;

  if (record.op === "claim") {
    item.status = "claimed";
    item.claimToken = record.claimToken;
    item.claimedAt = record.at;
    item.leaseExpiresAt = record.leaseExpiresAt;
    item.attempts = record.attempts;
    item.updatedAt = record.at;
    return;
  }

  if (record.op === "complete") {
    item.status = "completed";
    item.completedAt = record.at;
    item.updatedAt = record.at;
    item.claimToken = undefined;
    item.claimedAt = undefined;
    item.leaseExpiresAt = undefined;
    return;
  }

  if (record.op === "fail") {
    item.status = record.dead ? "dead" : "pending";
    item.lastError = record.error;
    item.updatedAt = record.at;
    item.claimToken = undefined;
    item.claimedAt = undefined;
    item.leaseExpiresAt = undefined;
    if (record.availableAt) item.availableAt = record.availableAt;
    return;
  }

  if (record.op === "release") {
    item.status = "pending";
    item.updatedAt = record.at;
    item.claimToken = undefined;
    item.claimedAt = undefined;
    item.leaseExpiresAt = undefined;
  }
}

function sortAvailable(items: QueueItem[]): QueueItem[] {
  const now = Date.now();
  return sortQueue(items.filter((item) => item.status === "pending" && Date.parse(item.availableAt) <= now));
}

function sortQueue(items: QueueItem[]): QueueItem[] {
  return items.sort((a, b) => {
    if (a.status !== b.status) return statusRank(a.status) - statusRank(b.status);
    if (a.priority !== b.priority) return b.priority - a.priority;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

function statusRank(status: QueueStatus): number {
  if (status === "pending") return 0;
  if (status === "claimed") return 1;
  if (status === "dead") return 2;
  return 3;
}

function requireItem(items: Map<string, QueueItem>, id: string): QueueItem {
  const item = items.get(id);
  if (!item) throw new NotFoundError(`Queue item "${id}" was not found`);
  return item;
}

function ensureClaimToken(item: QueueItem, claimToken?: string): void {
  if (claimToken && item.claimToken && claimToken !== item.claimToken) {
    throw new UserInputError("Queue claim token does not match");
  }
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
}
