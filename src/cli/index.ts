#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { issueCreateSchema, issueSearchSchema, issueUpdateSchema, projectCreateSchema } from "../domain/schemas.js";
import type { CleanIssue } from "../domain/types.js";
import type { QueueItem } from "../queue/fileQueue.js";
import { createRuntime } from "../tools/linearTools.js";
import { errorToJson, exitCodeForError } from "../utils/errors.js";
import { createLogger, silentLogger } from "../utils/logger.js";
import { startHttpServer } from "../http/server.js";

type GlobalOptions = {
  json?: boolean;
};

const program = new Command();

program
  .name("linear-tool")
  .description("Linear GraphQL CLI, local HTTP API, webhook inbox, and agent tool surface")
  .option("--json", "print machine-readable JSON")
  .showHelpAfterError();

const issue = program.command("issue").description("Search, view, create, and update Linear issues");

issue
  .command("search [query]")
  .description("Search issues with optional filters")
  .option("--team <team>", "team key, name, or UUID")
  .option("--assignee <user>", "assignee email, name, me, or UUID")
  .option("--status <status>", "workflow state name or UUID")
  .option("--priority <priority>", "priority 0-4")
  .option("--project <project>", "project name or UUID")
  .option("--created-after <date>", "ISO date/datetime lower bound")
  .option("--created-before <date>", "ISO date/datetime upper bound")
  .option("--updated-after <date>", "ISO date/datetime lower bound")
  .option("--updated-before <date>", "ISO date/datetime upper bound")
  .option("--limit <n>", "max results", "25")
  .option("--after <cursor>", "pagination cursor")
  .action((query, options) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.searchIssues(
        issueSearchSchema.parse({
          query,
          team: options.team,
          assignee: options.assignee,
          status: options.status,
          priority: options.priority,
          project: options.project,
          createdAfter: options.createdAfter,
          createdBefore: options.createdBefore,
          updatedAfter: options.updatedAfter,
          updatedBefore: options.updatedBefore,
          limit: options.limit,
          after: options.after
        })
      );
    }, printIssueSearch)
  );

issue
  .command("view <id>")
  .description("View an issue by UUID or identifier, e.g. ENG-123")
  .action((id) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.getIssue({ id });
    }, printIssue)
  );

issue
  .command("create")
  .alias("cr")
  .description("Create an issue")
  .requiredOption("--title <title>", "issue title")
  .option("--description <markdown>", "issue description")
  .option("--team <team>", "team key, name, or UUID")
  .option("--status <status>", "workflow state name or UUID")
  .option("--assignee <user>", "assignee email, name, me, or UUID")
  .option("--project <project>", "project name or UUID")
  .option("--priority <priority>", "priority 0-4")
  .option("--label <label>", "label name or UUID, repeatable", collect)
  .option("--parent <issue>", "parent issue identifier or UUID")
  .action((options) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.createIssue(
        issueCreateSchema.parse({
          title: options.title,
          description: options.description,
          team: options.team,
          status: options.status,
          assignee: options.assignee,
          project: options.project,
          priority: options.priority,
          labels: options.label ?? [],
          parent: options.parent
        })
      );
    }, printIssue)
  );

issue
  .command("update <id>")
  .description("Update issue fields")
  .option("--title <title>", "new issue title")
  .option("--description <markdown>", "new issue description")
  .option("--status <status>", "workflow state name or UUID")
  .option("--assignee <user>", "assignee email, name, me, or UUID")
  .option("--unassign", "remove assignee")
  .option("--project <project>", "project name or UUID")
  .option("--clear-project", "remove project")
  .option("--priority <priority>", "priority 0-4")
  .option("--label <label>", "replace labels; repeatable", collect)
  .option("--parent <issue>", "parent issue identifier or UUID")
  .option("--clear-parent", "remove parent issue")
  .action((id, options) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.updateIssue(
        issueUpdateSchema.parse({
          id,
          title: options.title,
          description: options.description,
          status: options.status,
          assignee: options.unassign ? null : options.assignee,
          project: options.clearProject ? null : options.project,
          priority: options.priority,
          labels: options.label,
          parent: options.clearParent ? null : options.parent
        })
      );
    }, printIssue)
  );

issue
  .command("state <id> <status>")
  .description("Move an issue to a workflow state")
  .action((id, status) =>
    run(async () => {
      const { service } = runtime(true);
      return service!.setIssueState(id, status);
    }, printIssue)
  );

issue
  .command("assign <id> [assignee]")
  .description("Assign or unassign an issue")
  .option("--clear", "remove assignee")
  .action((id, assignee, options) =>
    run(async () => {
      const { service } = runtime(true);
      return service!.assignIssue(id, options.clear ? null : assignee);
    }, printIssue)
  );

const issueLabel = issue.command("label").description("Manage issue labels");
issueLabel
  .command("add <id> <label>")
  .description("Add a label to an issue")
  .action((id, label) =>
    run(async () => {
      const { service } = runtime(true);
      return service!.addLabel(id, label);
    }, printIssue)
  );

issueLabel
  .command("remove <id> <label>")
  .description("Remove a label from an issue")
  .action((id, label) =>
    run(async () => {
      const { service } = runtime(true);
      return service!.removeLabel(id, label);
    }, printIssue)
  );

issue
  .command("project <id> [project]")
  .description("Link or unlink an issue from a project")
  .option("--clear", "remove project")
  .action((id, project, options) =>
    run(async () => {
      const { service } = runtime(true);
      return service!.linkIssueToProject(id, options.clear ? null : project);
    }, printIssue)
  );

issue
  .command("priority <id> <priority>")
  .description("Set issue priority: 0 none, 1 urgent, 2 high, 3 normal, 4 low")
  .action((id, priority) =>
    run(async () => {
      const { service } = runtime(true);
      return service!.setIssuePriority(id, Number.parseInt(priority, 10));
    }, printIssue)
  );

issue
  .command("parent <id> [parent]")
  .description("Set or clear an issue parent")
  .option("--clear", "remove parent")
  .action((id, parent, options) =>
    run(async () => {
      const { service } = runtime(true);
      return service!.setIssueParent(id, options.clear ? null : parent);
    }, printIssue)
  );

const comment = program.command("comment").description("Manage issue comments");

comment
  .command("add <issue>")
  .description("Add a comment to an issue")
  .requiredOption("--body <markdown>", "comment body")
  .action((issueId, options) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.addComment({ issue: issueId, body: options.body });
    }, printComment)
  );

comment
  .command("list <issue>")
  .description("List comments for an issue")
  .option("--limit <n>", "max comments", "50")
  .action((issueId, options) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.listComments({ issue: issueId, limit: Number.parseInt(options.limit, 10) });
    }, printComments)
  );

const team = program.command("team").description("Linear team operations");

team
  .command("list")
  .description("List teams")
  .action(() =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.listTeams();
    }, printTeams)
  );

team
  .command("members <team>")
  .description("List team members")
  .action((teamRef) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.listTeamMembers({ team: teamRef });
    }, printUsers)
  );

const project = program.command("project").description("Linear project operations");

project
  .command("list")
  .description("List projects")
  .action(() =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.listProjects();
    }, printProjects)
  );

project
  .command("view <project>")
  .description("View a project")
  .action((projectRef) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.getProject({ project: projectRef });
    }, printProject)
  );

project
  .command("create")
  .description("Create a project")
  .requiredOption("--name <name>", "project name")
  .requiredOption("--team <team>", "team key, name, or UUID; repeatable", collectRequired)
  .option("--description <text>", "project description")
  .option("--content <markdown>", "project content markdown")
  .option("--priority <priority>", "priority 0-4")
  .option("--state <state>", "project state")
  .action((options) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.createProject(
        projectCreateSchema.parse({
          name: options.name,
          teams: options.team,
          description: options.description,
          content: options.content,
          priority: options.priority,
          state: options.state
        })
      );
    }, printProject)
  );

program
  .command("workflow")
  .description("Workflow state operations")
  .command("list")
  .option("--team <team>", "team key, name, or UUID")
  .description("List workflow states")
  .action((options) =>
    run(async () => {
      const { tools } = runtime(true);
      return tools.listWorkflowStates({ team: options.team });
    }, printWorkflowStates)
  );

const queue = program.command("queue").description("Local persistent work queue");

queue
  .command("peek")
  .description("Show pending available queue items without claiming")
  .option("--limit <n>", "max items", "10")
  .action((options) =>
    run(async () => {
      const { tools } = runtime(false);
      return tools.peekQueue({ limit: Number.parseInt(options.limit, 10) });
    }, printQueue)
  );

queue
  .command("pop")
  .description("Claim one pending queue item")
  .option("--lease-ms <ms>", "claim lease duration in milliseconds")
  .action((options) =>
    run(async () => {
      const { tools } = runtime(false);
      return tools.popQueue({ leaseMs: options.leaseMs ? Number.parseInt(options.leaseMs, 10) : undefined });
    }, printMaybeQueueItem)
  );

queue
  .command("complete <id>")
  .description("Complete a queue item")
  .option("--claim-token <token>", "claim token returned by queue pop")
  .action((id, options) =>
    run(async () => {
      const { tools } = runtime(false);
      return tools.completeQueueItem({ id, claimToken: options.claimToken });
    }, printQueueItem)
  );

queue
  .command("fail <id>")
  .description("Fail a queue item and optionally retry it")
  .requiredOption("--error <message>", "failure message")
  .option("--no-retry", "do not retry")
  .option("--delay-ms <ms>", "retry delay")
  .option("--claim-token <token>", "claim token returned by queue pop")
  .action((id, options) =>
    run(async () => {
      const { tools } = runtime(false);
      return tools.failQueueItem({
        id,
        error: options.error,
        retry: options.retry,
        delayMs: options.delayMs ? Number.parseInt(options.delayMs, 10) : undefined,
        claimToken: options.claimToken
      });
    }, printQueueItem)
  );

const webhook = program.command("webhook").description("Webhook operations");

webhook
  .command("serve")
  .description("Start the local HTTP server with /hooks/linear enabled")
  .action(() => serve());

program
  .command("serve")
  .description("Start the local HTTP API server")
  .action(() => serve());

const config = program.command("config").description("Configuration diagnostics");

config
  .command("check")
  .description("Validate configuration for Linear API operations")
  .action(() =>
    run(async () => sanitizeConfig(loadConfig({ requireApiKey: true })), printConfig, false)
  );

config
  .command("debug")
  .description("Print sanitized resolved configuration")
  .action(() =>
    run(async () => sanitizeConfig(loadConfig({ requireApiKey: false })), printConfig, false)
  );

program.parseAsync(process.argv).catch((error) => {
  printError(error);
  process.exitCode = exitCodeForError(error);
});

function runtime(requireApiKey: boolean) {
  return createRuntime(loadConfig({ requireApiKey }), silentLogger);
}

async function serve(): Promise<void> {
  try {
    const config = loadConfig({ requireApiKey: false });
    const logger = createLogger(config);
    await startHttpServer(createRuntime(config, logger), logger);
  } catch (error) {
    printError(error);
    process.exitCode = exitCodeForError(error);
  }
}

async function run<T>(fn: () => Promise<T>, humanPrinter?: (value: T) => void, requireJsonOption = true): Promise<void> {
  try {
    const result = await fn();
    const opts = program.opts<GlobalOptions>();
    if (opts.json || !humanPrinter || !requireJsonOption) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    humanPrinter(result);
  } catch (error) {
    printError(error);
    process.exitCode = exitCodeForError(error);
  }
}

function printError(error: unknown): void {
  const opts = program.opts<GlobalOptions>();
  if (opts.json) {
    console.error(JSON.stringify(errorToJson(error), null, 2));
    return;
  }
  if (error instanceof Error) {
    console.error(error.message);
    return;
  }
  console.error(String(error));
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function collectRequired(value: string, previous: string[] | undefined): string[] {
  return collect(value, previous);
}

function printIssueSearch(value: unknown): void {
  const page = value as { items: CleanIssue[]; pageInfo?: { hasNextPage: boolean; endCursor?: string | null } };
  if (!page.items.length) {
    console.log("No issues found");
    return;
  }
  for (const issue of page.items) {
    console.log(formatIssueLine(issue));
  }
  if (page.pageInfo?.hasNextPage) {
    console.log(`next cursor: ${page.pageInfo.endCursor}`);
  }
}

function printIssue(value: unknown): void {
  const issue = value as CleanIssue;
  console.log(`${issue.identifier} ${issue.title}`);
  if (issue.url) console.log(issue.url);
  console.log(`state: ${issue.state?.name ?? "-"}`);
  console.log(`team: ${issue.team?.key ?? issue.team?.name ?? "-"}`);
  console.log(`assignee: ${issue.assignee?.email ?? issue.assignee?.name ?? "-"}`);
  console.log(`project: ${issue.project?.name ?? "-"}`);
  console.log(`priority: ${issue.priority ?? 0}`);
  if (issue.labels?.length) console.log(`labels: ${issue.labels.map((label) => label.name).join(", ")}`);
  if (issue.parent) console.log(`parent: ${issue.parent.identifier} ${issue.parent.title}`);
}

function printTeams(value: unknown): void {
  for (const team of value as Array<{ id: string; key?: string; name: string }>) {
    console.log(`${team.key ?? "-"}\t${team.name}\t${team.id}`);
  }
}

function printUsers(value: unknown): void {
  for (const user of value as Array<{ id: string; name: string; email?: string }>) {
    console.log(`${user.email ?? "-"}\t${user.name}\t${user.id}`);
  }
}

function printProjects(value: unknown): void {
  for (const project of value as Array<{ id: string; name: string; state?: string; url?: string }>) {
    console.log(`${project.name}\t${project.state ?? "-"}\t${project.url ?? project.id}`);
  }
}

function printProject(value: unknown): void {
  const project = value as { id: string; name: string; description?: string; state?: string; url?: string; teams?: Array<{ key?: string; name: string }> };
  console.log(`${project.name}`);
  if (project.url) console.log(project.url);
  console.log(`state: ${project.state ?? "-"}`);
  if (project.teams?.length) console.log(`teams: ${project.teams.map((team) => team.key ?? team.name).join(", ")}`);
  if (project.description) console.log(project.description);
}

function printWorkflowStates(value: unknown): void {
  for (const state of value as Array<{ id: string; name: string; type?: string; team?: { key?: string; name: string } }>) {
    console.log(`${state.team?.key ?? state.team?.name ?? "-"}\t${state.name}\t${state.type ?? "-"}\t${state.id}`);
  }
}

function printComment(value: unknown): void {
  const comment = value as { id: string; url?: string; user?: { name?: string; email?: string } };
  console.log(`${comment.id}${comment.url ? ` ${comment.url}` : ""}`);
  if (comment.user) console.log(`by: ${comment.user.email ?? comment.user.name ?? "-"}`);
}

function printComments(value: unknown): void {
  for (const comment of value as Array<{ id: string; body: string; createdAt?: string; user?: { name?: string; email?: string } }>) {
    const author = comment.user?.email ?? comment.user?.name ?? "-";
    console.log(`${comment.createdAt ?? "-"} ${author} ${comment.id}`);
    console.log(comment.body);
    console.log("");
  }
}

function printQueue(value: unknown): void {
  const items = value as QueueItem[];
  if (!items.length) {
    console.log("Queue is empty");
    return;
  }
  for (const item of items) printQueueLine(item);
}

function printMaybeQueueItem(value: unknown): void {
  if (!value) {
    console.log("No available queue item");
    return;
  }
  printQueueItem(value);
}

function printQueueItem(value: unknown): void {
  printQueueLine(value as QueueItem);
}

function printQueueLine(item: QueueItem): void {
  console.log(`${item.id}\t${item.status}\tpriority=${item.priority}\tattempts=${item.attempts}\ttype=${item.type}`);
  if (item.claimToken) console.log(`claimToken: ${item.claimToken}`);
}

function formatIssueLine(issue: CleanIssue): string {
  const state = issue.state?.name ?? "-";
  const assignee = issue.assignee?.email ?? issue.assignee?.name ?? "-";
  return `${issue.identifier}\t[${state}]\t${assignee}\t${issue.title}`;
}

function sanitizeConfig(value: ReturnType<typeof loadConfig>): Record<string, unknown> {
  return {
    ...value,
    apiKey: value.apiKey ? "***set***" : undefined,
    webhookSecret: value.webhookSecret ? "***set***" : undefined,
    localBearerToken: value.localBearerToken ? "***set***" : undefined
  };
}

function printConfig(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
