import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { routeLinearEvent } from "../src/webhook/router.js";
import { verifyLinearSignature } from "../src/webhook/signature.js";

describe("webhook signature verification", () => {
  it("accepts valid Linear HMAC signatures", () => {
    const body = JSON.stringify({ type: "Issue", action: "create", data: { id: "issue-1" } });
    const secret = "secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyLinearSignature(body, signature, secret)).toBe(true);
  });

  it("rejects invalid signatures", () => {
    expect(verifyLinearSignature("{}", "deadbeef", "secret")).toBe(false);
  });
});

describe("webhook routing", () => {
  it("routes state changes distinctly", () => {
    const routed = routeLinearEvent({
      type: "Issue",
      action: "update",
      createdAt: "2026-04-27T10:00:00.000Z",
      data: { id: "issue-1" },
      updatedFrom: { stateId: "old-state" }
    });

    expect(routed.queueType).toBe("linear.issue.state_changed");
    expect(routed.priority).toBeGreaterThan(0);
  });
});
