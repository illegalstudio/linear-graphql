import type { AppConfig } from "../config/config.js";
import { LinearGraphQLClient } from "../client/graphql.js";
import { LinearGraphQLApi } from "../client/linearApi.js";
import { LinearService, issueSummary } from "../domain/linearService.js";
import type { CommentAddInput, IssueCreateInput, IssueSearchInput, IssueUpdateInput, ProjectCreateInput } from "../domain/schemas.js";
import type { FileQueue, QueueItem } from "../queue/fileQueue.js";
import { FileQueue as JsonlFileQueue } from "../queue/fileQueue.js";
import { ConfigError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { silentLogger } from "../utils/logger.js";

export type LinearTools = {
  searchIssues(params: IssueSearchInput): Promise<unknown>;
  getIssue(params: { id: string }): Promise<unknown>;
  createIssue(params: IssueCreateInput): Promise<unknown>;
  updateIssue(params: IssueUpdateInput): Promise<unknown>;
  addComment(params: CommentAddInput): Promise<unknown>;
  listComments(params: { issue: string; limit?: number }): Promise<unknown>;
  listTeams(): Promise<unknown>;
  listTeamMembers(params: { team: string }): Promise<unknown>;
  listProjects(): Promise<unknown>;
  getProject(params: { project: string }): Promise<unknown>;
  createProject(params: ProjectCreateInput): Promise<unknown>;
  listWorkflowStates(params?: { team?: string }): Promise<unknown>;
  peekQueue(params?: { limit?: number }): Promise<QueueItem[]>;
  popQueue(params?: { leaseMs?: number }): Promise<QueueItem | null>;
  completeQueueItem(params: { id: string; claimToken?: string }): Promise<QueueItem>;
  failQueueItem(params: { id: string; error: string; retry?: boolean; delayMs?: number; claimToken?: string }): Promise<QueueItem>;
};

export type Runtime = {
  config: AppConfig;
  queue: FileQueue;
  service?: LinearService;
  tools: LinearTools;
};

export function createRuntime(config: AppConfig, logger: Logger = silentLogger): Runtime {
  const queue = new JsonlFileQueue(config.queueFile, logger);
  const service = config.apiKey
    ? new LinearService(
        new LinearGraphQLApi(
          new LinearGraphQLClient({
            apiKey: config.apiKey,
            apiUrl: config.apiUrl,
            requestTimeoutMs: config.requestTimeoutMs,
            maxRetries: config.maxRetries,
            logger
          })
        ),
        config
      )
    : undefined;

  return {
    config,
    queue,
    service,
    tools: createLinearTools({ service, queue })
  };
}

export function createLinearTools(args: { service?: LinearService; queue: FileQueue }): LinearTools {
  const requireService = (): LinearService => {
    if (!args.service) {
      throw new ConfigError("LINEAR_API_KEY is required for this operation");
    }
    return args.service;
  };

  return {
    async searchIssues(params) {
      const result = await requireService().searchIssues(params);
      return {
        ...result,
        items: result.items.map(issueSummary)
      };
    },
    async getIssue(params) {
      return issueSummary(await requireService().getIssue(params.id));
    },
    async createIssue(params) {
      return issueSummary(await requireService().createIssue(params));
    },
    async updateIssue(params) {
      return issueSummary(await requireService().updateIssue(params));
    },
    async addComment(params) {
      return requireService().addComment(params);
    },
    async listComments(params) {
      return requireService().listComments(params.issue, params.limit);
    },
    async listTeams() {
      return requireService().listTeams();
    },
    async listTeamMembers(params) {
      return requireService().listTeamMembers(params.team);
    },
    async listProjects() {
      return requireService().listProjects();
    },
    async getProject(params) {
      return requireService().getProject(params.project);
    },
    async createProject(params) {
      return requireService().createProject(params);
    },
    async listWorkflowStates(params) {
      return requireService().listWorkflowStates(params?.team);
    },
    async peekQueue(params) {
      return args.queue.peek(params?.limit);
    },
    async popQueue(params) {
      return args.queue.pop(params);
    },
    async completeQueueItem(params) {
      return args.queue.complete(params.id, params.claimToken);
    },
    async failQueueItem(params) {
      return args.queue.fail(params.id, params.error, params);
    }
  };
}
