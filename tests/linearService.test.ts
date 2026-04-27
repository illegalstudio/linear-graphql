import { describe, expect, it } from "vitest";
import { LinearService } from "../src/domain/linearService.js";
import type { LinearIssue } from "../src/domain/types.js";
import { fakeApi } from "./resolver.test.js";

const baseIssue: LinearIssue = {
  id: "issue-1",
  identifier: "ENG-123",
  title: "Fix bug",
  team: { id: "team-1", key: "ENG", name: "Engineering" },
  state: { id: "state-1", name: "In Progress" },
  labels: { nodes: [{ id: "label-existing", name: "Existing" }] }
};

describe("LinearService", () => {
  it("creates issues after resolving human references", async () => {
    let mutationInput: Record<string, unknown> | undefined;
    const service = new LinearService(
      fakeApi({
        createIssue: async (input) => {
          mutationInput = input;
          return { ...baseIssue, title: String(input.title) };
        }
      }),
      { cacheTtlMs: 60_000, defaultTeam: "ENG", defaultProject: undefined }
    );

    const issue = await service.createIssue({
      title: "New issue",
      labels: ["Bug"],
      status: "In Progress",
      assignee: "alice@example.com"
    });

    expect(issue.identifier).toBe("ENG-123");
    expect(mutationInput).toMatchObject({
      title: "New issue",
      teamId: "team-1",
      stateId: "state-1",
      assigneeId: "user-1",
      labelIds: ["label-1"]
    });
  });

  it("adds labels without removing existing labels", async () => {
    let mutationInput: Record<string, unknown> | undefined;
    const service = new LinearService(
      fakeApi({
        getIssue: async () => baseIssue,
        updateIssue: async (_id, input) => {
          mutationInput = input;
          return {
            ...baseIssue,
            labels: {
              nodes: [
                { id: "label-existing", name: "Existing" },
                { id: "label-1", name: "Bug" }
              ]
            }
          };
        }
      }),
      { cacheTtlMs: 60_000, defaultTeam: "ENG", defaultProject: undefined }
    );

    const issue = await service.addLabel("ENG-123", "Bug");

    expect(issue.labels.map((label) => label.id)).toEqual(["label-existing", "label-1"]);
    expect(mutationInput).toEqual({ labelIds: ["label-existing", "label-1"] });
  });
});
