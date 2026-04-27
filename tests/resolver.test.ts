import { describe, expect, it } from "vitest";
import { EntityResolver } from "../src/domain/resolver.js";
import type { LinearApi } from "../src/client/linearApi.js";

describe("EntityResolver", () => {
  it("resolves teams, users, states, projects, and labels by human references", async () => {
    const resolver = new EntityResolver(fakeApi(), { cacheTtlMs: 60_000, defaultTeam: "ENG", defaultProject: "Roadmap" });

    await expect(resolver.resolveTeamId()).resolves.toBe("team-1");
    await expect(resolver.resolveUserId("alice@example.com")).resolves.toBe("user-1");
    await expect(resolver.resolveWorkflowStateId("In Progress", "ENG")).resolves.toBe("state-1");
    await expect(resolver.resolveProjectId()).resolves.toBe("project-1");
    await expect(resolver.resolveLabelId("Bug", "ENG")).resolves.toBe("label-1");
  });
});

export function fakeApi(overrides: Partial<LinearApi> = {}): LinearApi {
  return {
    viewer: async () => ({ id: "user-1", name: "Alice", email: "alice@example.com" }),
    listTeams: async () => [{ id: "team-1", key: "ENG", name: "Engineering" }],
    listTeamMembers: async () => [{ id: "user-1", name: "Alice", email: "alice@example.com" }],
    listUsers: async () => [{ id: "user-1", name: "Alice", email: "alice@example.com" }],
    listWorkflowStates: async () => [{ id: "state-1", name: "In Progress", team: { id: "team-1", key: "ENG", name: "Engineering" } }],
    listProjects: async () => [{ id: "project-1", name: "Roadmap", teams: [{ id: "team-1", key: "ENG", name: "Engineering" }] }],
    getProject: async (id) => ({ id, name: "Roadmap", teams: [{ id: "team-1", key: "ENG", name: "Engineering" }] }),
    createProject: async (input) => ({ id: "project-new", name: String(input.name), teams: [] }),
    listIssueLabels: async () => [{ id: "label-1", name: "Bug", team: { id: "team-1", key: "ENG", name: "Engineering" } }],
    searchIssues: async () => ({ nodes: [] }),
    getIssue: async () => null,
    createIssue: async () => {
      throw new Error("not implemented");
    },
    updateIssue: async () => {
      throw new Error("not implemented");
    },
    addComment: async () => {
      throw new Error("not implemented");
    },
    listComments: async () => [],
    ...overrides
  };
}
