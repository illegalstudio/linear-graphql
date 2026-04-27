import type { AppConfig } from "../config/config.js";
import type { LinearApi } from "../client/linearApi.js";
import { NotFoundError, UserInputError } from "../utils/errors.js";
import {
  commentAddSchema,
  issueCreateSchema,
  issueSearchSchema,
  issueUpdateSchema,
  projectCreateSchema,
  type CommentAddInput,
  type IssueCreateInput,
  type IssueSearchInput,
  type IssueUpdateInput,
  type ProjectCreateInput
} from "./schemas.js";
import { cleanIssue, cleanProject, connectionNodes, type CleanIssue, type LinearComment, type LinearProject, type LinearTeam, type LinearUser, type LinearWorkflowState, type Page } from "./types.js";
import { EntityResolver } from "./resolver.js";

export class LinearService {
  readonly resolver: EntityResolver;

  constructor(
    private readonly api: LinearApi,
    config: Pick<AppConfig, "cacheTtlMs" | "defaultTeam" | "defaultProject">
  ) {
    this.resolver = new EntityResolver(api, config);
  }

  async searchIssues(input: IssueSearchInput): Promise<Page<CleanIssue>> {
    const params = issueSearchSchema.parse(input);
    const filter = await this.buildIssueFilter(params);
    const page = await this.api.searchIssues({
      filter: Object.keys(filter).length ? filter : undefined,
      first: params.limit,
      after: params.after
    });

    return {
      items: page.nodes.map(cleanIssue),
      pageInfo: page.pageInfo
    };
  }

  async getIssue(id: string): Promise<CleanIssue> {
    const issue = await this.api.getIssue(id);
    if (!issue) throw new NotFoundError(`Issue "${id}" was not found`);
    return cleanIssue(issue);
  }

  async createIssue(input: IssueCreateInput): Promise<CleanIssue> {
    const params = issueCreateSchema.parse(input);
    const teamId = await this.resolver.resolveTeamId(params.team);
    const mutationInput: Record<string, unknown> = {
      title: params.title,
      teamId
    };

    if (params.description !== undefined) mutationInput.description = params.description;
    if (params.priority !== undefined) mutationInput.priority = params.priority;
    if (params.status) mutationInput.stateId = await this.resolver.resolveWorkflowStateId(params.status, params.team);
    if (params.assignee) mutationInput.assigneeId = await this.resolver.resolveUserId(params.assignee);
    const projectId = await this.resolver.resolveProjectId(params.project);
    if (projectId !== undefined) mutationInput.projectId = projectId;
    if (params.labels.length) mutationInput.labelIds = await this.resolver.resolveLabelIds(params.labels, params.team);
    if (params.parent) mutationInput.parentId = await this.resolveIssueUuid(params.parent);

    const issue = await this.api.createIssue(mutationInput);
    return cleanIssue(issue);
  }

  async updateIssue(input: IssueUpdateInput): Promise<CleanIssue> {
    const params = issueUpdateSchema.parse(input);
    const mutationInput: Record<string, unknown> = {};

    if (params.title !== undefined) mutationInput.title = params.title;
    if (params.description !== undefined) mutationInput.description = params.description;
    if (params.priority !== undefined) mutationInput.priority = params.priority;
    if (params.status !== undefined) {
      const current = await this.getIssue(params.id);
      mutationInput.stateId = await this.resolver.resolveWorkflowStateId(params.status, current.team?.id);
    }
    if (params.assignee !== undefined) mutationInput.assigneeId = await this.resolver.resolveUserId(params.assignee);
    if (params.project !== undefined) mutationInput.projectId = await this.resolver.resolveProjectId(params.project);
    if (params.labels !== undefined) {
      const current = await this.getIssue(params.id);
      mutationInput.labelIds = await this.resolver.resolveLabelIds(params.labels, current.team?.id);
    }
    if (params.parent !== undefined) mutationInput.parentId = params.parent === null ? null : await this.resolveIssueUuid(params.parent);

    if (!Object.keys(mutationInput).length) {
      throw new UserInputError("No issue fields were provided to update");
    }

    const issue = await this.api.updateIssue(params.id, mutationInput);
    return cleanIssue(issue);
  }

  async setIssueState(id: string, status: string): Promise<CleanIssue> {
    return this.updateIssue({ id, status });
  }

  async assignIssue(id: string, assignee: string | null): Promise<CleanIssue> {
    return this.updateIssue({ id, assignee });
  }

  async setIssuePriority(id: string, priority: number): Promise<CleanIssue> {
    return this.updateIssue({ id, priority });
  }

  async linkIssueToProject(id: string, project: string | null): Promise<CleanIssue> {
    return this.updateIssue({ id, project });
  }

  async setIssueParent(id: string, parent: string | null): Promise<CleanIssue> {
    return this.updateIssue({ id, parent });
  }

  async addLabel(id: string, label: string): Promise<CleanIssue> {
    const issue = await this.getIssue(id);
    const labelId = await this.resolver.resolveLabelId(label, issue.team?.id);
    const currentLabelIds = issue.labels.map((item) => item.id);
    if (!currentLabelIds.includes(labelId)) {
      currentLabelIds.push(labelId);
    }
    const updated = await this.api.updateIssue(id, { labelIds: currentLabelIds });
    return cleanIssue(updated);
  }

  async removeLabel(id: string, label: string): Promise<CleanIssue> {
    const issue = await this.getIssue(id);
    const labelId = await this.resolver.resolveLabelId(label, issue.team?.id);
    const currentLabelIds = issue.labels.map((item) => item.id).filter((item) => item !== labelId);
    const updated = await this.api.updateIssue(id, { labelIds: currentLabelIds });
    return cleanIssue(updated);
  }

  async addComment(input: CommentAddInput): Promise<LinearComment> {
    const params = commentAddSchema.parse(input);
    const issueId = await this.resolveIssueUuid(params.issue);
    return this.api.addComment({ issueId, body: params.body });
  }

  async listComments(issue: string, limit = 50): Promise<LinearComment[]> {
    return this.api.listComments(issue, limit);
  }

  async listTeams(): Promise<LinearTeam[]> {
    return this.api.listTeams();
  }

  async listTeamMembers(team: string): Promise<LinearUser[]> {
    const teamId = await this.resolver.resolveTeamId(team);
    return this.api.listTeamMembers(teamId);
  }

  async listProjects(): Promise<Array<LinearProject & { teams: LinearTeam[] }>> {
    const projects = await this.api.listProjects();
    return projects.map(cleanProject);
  }

  async getProject(reference: string): Promise<LinearProject & { teams: LinearTeam[] }> {
    const projectId = await this.resolver.resolveProjectId(reference);
    if (!projectId) throw new UserInputError("Project reference is required");
    const project = await this.api.getProject(projectId);
    if (!project) throw new NotFoundError(`Project "${reference}" was not found`);
    return cleanProject(project);
  }

  async createProject(input: ProjectCreateInput): Promise<LinearProject & { teams: LinearTeam[] }> {
    const params = projectCreateSchema.parse(input);
    const teamIds = await this.resolver.resolveTeamIds(params.teams);
    const mutationInput: Record<string, unknown> = {
      name: params.name,
      teamIds
    };
    if (params.description !== undefined) mutationInput.description = params.description;
    if (params.content !== undefined) mutationInput.content = params.content;
    if (params.priority !== undefined) mutationInput.priority = params.priority;
    if (params.state !== undefined) mutationInput.state = params.state;

    const project = await this.api.createProject(mutationInput);
    return cleanProject(project);
  }

  async listWorkflowStates(team?: string): Promise<LinearWorkflowState[]> {
    return this.resolver.listWorkflowStates(team);
  }

  private async buildIssueFilter(params: IssueSearchInput): Promise<Record<string, unknown>> {
    const filter: Record<string, unknown> = {};

    if (params.query) {
      filter.or = [
        { title: { containsIgnoreCase: params.query } },
        { description: { containsIgnoreCase: params.query } },
        { identifier: { containsIgnoreCase: params.query } }
      ];
    }

    if (params.team) filter.team = { id: { eq: await this.resolver.resolveTeamId(params.team) } };
    if (params.assignee) filter.assignee = { id: { eq: await this.resolver.resolveUserId(params.assignee) } };
    if (params.status) filter.state = { id: { eq: await this.resolver.resolveWorkflowStateId(params.status, params.team) } };
    if (params.project) filter.project = { id: { eq: await this.resolver.resolveProjectId(params.project) } };
    if (params.priority !== undefined) filter.priority = { eq: params.priority };
    if (params.createdAfter || params.createdBefore) filter.createdAt = dateFilter(params.createdAfter, params.createdBefore);
    if (params.updatedAfter || params.updatedBefore) filter.updatedAt = dateFilter(params.updatedAfter, params.updatedBefore);

    return filter;
  }

  private async resolveIssueUuid(reference: string): Promise<string> {
    const issue = await this.api.getIssue(reference);
    if (!issue) throw new NotFoundError(`Issue "${reference}" was not found`);
    return issue.id;
  }
}

function dateFilter(after?: string, before?: string): Record<string, string> {
  const filter: Record<string, string> = {};
  if (after) filter.gte = after;
  if (before) filter.lte = before;
  return filter;
}

export function issueSummary(issue: CleanIssue): Record<string, unknown> {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    team: issue.team ? { id: issue.team.id, key: issue.team.key, name: issue.team.name } : null,
    state: issue.state ? { id: issue.state.id, name: issue.state.name, type: issue.state.type } : null,
    assignee: issue.assignee ? { id: issue.assignee.id, name: issue.assignee.name, email: issue.assignee.email } : null,
    project: issue.project ? { id: issue.project.id, name: issue.project.name, url: issue.project.url } : null,
    priority: issue.priority,
    labels: issue.labels.map((label) => ({ id: label.id, name: label.name })),
    parent: issue.parent ?? null,
    children: connectionNodes(issue.children),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt
  };
}
