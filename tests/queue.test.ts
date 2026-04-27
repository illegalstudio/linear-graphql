import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileQueue } from "../src/queue/fileQueue.js";

describe("FileQueue", () => {
  it("enqueues, deduplicates, claims, and completes items", async () => {
    const queue = new FileQueue(queuePath());

    const first = await queue.enqueue({ type: "linear.issue.created", payload: { id: 1 }, dedupKey: "a", priority: 10 });
    const second = await queue.enqueue({ type: "linear.issue.created", payload: { id: 1 }, dedupKey: "a", priority: 10 });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.item.id).toBe(first.item.id);

    const claimed = await queue.pop({ leaseMs: 60_000 });
    expect(claimed?.status).toBe("claimed");

    const completed = await queue.complete(claimed!.id, claimed!.claimToken);
    expect(completed.status).toBe("completed");
    expect(await queue.peek()).toEqual([]);
  });

  it("recovers expired claims", async () => {
    const queue = new FileQueue(queuePath());
    await queue.enqueue({ type: "event", payload: {}, priority: 1 });

    const claimed = await queue.pop({ leaseMs: 1 });
    expect(claimed).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const visible = await queue.peek();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.status).toBe("pending");
  });
});

function queuePath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "linear-queue-")), "queue.jsonl");
}
