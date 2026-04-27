import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/config.js";
import { ConfigError } from "../src/utils/errors.js";

describe("config validation", () => {
  it("requires LINEAR_API_KEY when requested", () => {
    expect(() => loadConfig({ env: {}, requireApiKey: true })).toThrow(ConfigError);
  });

  it("loads defaults and resolves queue path", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "linear-config-"));
    const config = loadConfig({ cwd, env: { LINEAR_API_KEY: "key" }, requireApiKey: true });

    expect(config.apiUrl).toBe("https://api.linear.app/graphql");
    expect(config.httpPort).toBe(8787);
    expect(config.queueFile).toBe(path.join(cwd, ".linear-tool/queue.jsonl"));
  });

  it("rejects invalid numeric values", () => {
    expect(() => loadConfig({ env: { LINEAR_HTTP_PORT: "not-a-number" } })).toThrow(ConfigError);
  });
});
