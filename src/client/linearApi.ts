import type { LinearGraphQLClient } from "./graphql.js";
import type {
  LinearComment,
  LinearIssue,
  LinearLabel,
  LinearProject,
  LinearTeam,
  LinearUser,
  LinearWorkflowState,
  NodeConnection
} from "../domain/types.js";

const USER_FIELDS = `
  id
  name
  email
  active
`;

const TEAM_FIELDS = `
  id
  key
  name
  description
`;

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priority
  createdAt
  updatedAt
  archivedAt
  team { ${TEAM_FIELDS} }
  state {
    id
    name
    type
    position
    team { ${TEAM_FIELDS} }
  }
  assignee { ${USER_FIELDS} }
  creator { ${USER_FIELDS} }
  project {
    id
    name
    description
    state
    priority
    url
  }
  labels(first: 50) {
    nodes {
      id
      name
      color
      team { ${TEAM_FIELDS} }
    }
  }
  parent {
    id
    identifier
    title
  }
  children(first: 25) {
    nodes {
      id
      identifier
      title
    }
  }
`;

const PROJECT_FIELDS = `
  id
  name
  description
  content
  state
  priority
  url
  createdAt
  updatedAt
  teams(first: 20) {
    nodes { ${TEAM_FIELDS} }
  }
`;

const COMMENT_FIELDS = `
  id
  body
  createdAt
  updatedAt
  url
  user { ${USER_FIELDS} }
  issue {
    id
    identifier
    title
  }
`;

export type LinearIssuePage = {
  issues: NodeConnection<LinearIssue>;
};

export type LinearApi = {
  viewer(): Promise<LinearUser>;
  listTeams(limit?: number): Promise<LinearTeam[]>;
  listTeamMembers(teamId: string, limit?: number): Promise<LinearUser[]>;
  listUsers(limit?: number): Promise<LinearUser[]>;
  listWorkflowStates(limit?: number): Promise<LinearWorkflowState[]>;
  listProjects(limit?: number): Promise<LinearProject[]>;
  getProject(id: string): Promise<LinearProject | null>;
  createProject(input: Record<string, unknown>): Promise<LinearProject>;
  listIssueLabels(limit?: number): Promise<LinearLabel[]>;
  searchIssues(args: {
    filter?: Record<string, unknown>;
    first: number;
    after?: string;
  }): Promise<NodeConnection<LinearIssue>>;
  getIssue(id: string): Promise<LinearIssue | null>;
  createIssue(input: Record<string, unknown>): Promise<LinearIssue>;
  updateIssue(id: string, input: Record<string, unknown>): Promise<LinearIssue>;
  addComment(input: { issueId: string; body: string }): Promise<LinearComment>;
  listComments(issueId: string, limit?: number): Promise<LinearComment[]>;
};

export class LinearGraphQLApi implements LinearApi {
  constructor(private readonly client: LinearGraphQLClient) {}

  async viewer(): Promise<LinearUser> {
    const data = await this.client.request<{ viewer: LinearUser }>(`
      query Viewer {
        viewer { ${USER_FIELDS} }
      }
    `);
    return data.viewer;
  }

  async listTeams(limit = 100): Promise<LinearTeam[]> {
    const data = await this.client.request<{ teams: NodeConnection<LinearTeam> }>(
      `
        query Teams($first: Int!) {
          teams(first: $first) {
            nodes { ${TEAM_FIELDS} }
          }
        }
      `,
      { first: limit }
    );
    return data.teams.nodes;
  }

  async listTeamMembers(teamId: string, limit = 100): Promise<LinearUser[]> {
    const data = await this.client.request<{ team: { members: NodeConnection<LinearUser> } | null }>(
      `
        query TeamMembers($id: String!, $first: Int!) {
          team(id: $id) {
            members(first: $first) {
              nodes { ${USER_FIELDS} }
            }
          }
        }
      `,
      { id: teamId, first: limit }
    );
    return data.team?.members.nodes ?? [];
  }

  async listUsers(limit = 100): Promise<LinearUser[]> {
    const data = await this.client.request<{ users: NodeConnection<LinearUser> }>(
      `
        query Users($first: Int!) {
          users(first: $first) {
            nodes { ${USER_FIELDS} }
          }
        }
      `,
      { first: limit }
    );
    return data.users.nodes;
  }

  async listWorkflowStates(limit = 250): Promise<LinearWorkflowState[]> {
    const data = await this.client.request<{ workflowStates: NodeConnection<LinearWorkflowState> }>(
      `
        query WorkflowStates($first: Int!) {
          workflowStates(first: $first) {
            nodes {
              id
              name
              type
              position
              team { ${TEAM_FIELDS} }
            }
          }
        }
      `,
      { first: limit }
    );
    return data.workflowStates.nodes;
  }

  async listProjects(limit = 100): Promise<LinearProject[]> {
    const data = await this.client.request<{ projects: NodeConnection<LinearProject> }>(
      `
        query Projects($first: Int!) {
          projects(first: $first) {
            nodes { ${PROJECT_FIELDS} }
          }
        }
      `,
      { first: limit }
    );
    return data.projects.nodes;
  }

  async getProject(id: string): Promise<LinearProject | null> {
    const data = await this.client.request<{ project: LinearProject | null }>(
      `
        query Project($id: String!) {
          project(id: $id) { ${PROJECT_FIELDS} }
        }
      `,
      { id }
    );
    return data.project;
  }

  async createProject(input: Record<string, unknown>): Promise<LinearProject> {
    const data = await this.client.request<{ projectCreate: { success: boolean; project: LinearProject } }>(
      `
        mutation ProjectCreate($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            success
            project { ${PROJECT_FIELDS} }
          }
        }
      `,
      { input }
    );
    return data.projectCreate.project;
  }

  async listIssueLabels(limit = 250): Promise<LinearLabel[]> {
    const data = await this.client.request<{ issueLabels: NodeConnection<LinearLabel> }>(
      `
        query IssueLabels($first: Int!) {
          issueLabels(first: $first) {
            nodes {
              id
              name
              color
              team { ${TEAM_FIELDS} }
            }
          }
        }
      `,
      { first: limit }
    );
    return data.issueLabels.nodes;
  }

  async searchIssues(args: {
    filter?: Record<string, unknown>;
    first: number;
    after?: string;
  }): Promise<NodeConnection<LinearIssue>> {
    const data = await this.client.request<{ issues: NodeConnection<LinearIssue> }>(
      `
        query Issues($first: Int!, $after: String, $filter: IssueFilter) {
          issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      { first: args.first, after: args.after, filter: args.filter }
    );
    return data.issues;
  }

  async getIssue(id: string): Promise<LinearIssue | null> {
    const data = await this.client.request<{ issue: LinearIssue | null }>(
      `
        query Issue($id: String!) {
          issue(id: $id) { ${ISSUE_FIELDS} }
        }
      `,
      { id }
    );
    return data.issue;
  }

  async createIssue(input: Record<string, unknown>): Promise<LinearIssue> {
    const data = await this.client.request<{ issueCreate: { success: boolean; issue: LinearIssue } }>(
      `
        mutation IssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { ${ISSUE_FIELDS} }
          }
        }
      `,
      { input }
    );
    return data.issueCreate.issue;
  }

  async updateIssue(id: string, input: Record<string, unknown>): Promise<LinearIssue> {
    const data = await this.client.request<{ issueUpdate: { success: boolean; issue: LinearIssue } }>(
      `
        mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue { ${ISSUE_FIELDS} }
          }
        }
      `,
      { id, input }
    );
    return data.issueUpdate.issue;
  }

  async addComment(input: { issueId: string; body: string }): Promise<LinearComment> {
    const data = await this.client.request<{ commentCreate: { success: boolean; comment: LinearComment } }>(
      `
        mutation CommentCreate($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
            comment { ${COMMENT_FIELDS} }
          }
        }
      `,
      { input }
    );
    return data.commentCreate.comment;
  }

  async listComments(issueId: string, limit = 50): Promise<LinearComment[]> {
    const data = await this.client.request<{ issue: { comments: NodeConnection<LinearComment> } | null }>(
      `
        query IssueComments($id: String!, $first: Int!) {
          issue(id: $id) {
            comments(first: $first) {
              nodes { ${COMMENT_FIELDS} }
            }
          }
        }
      `,
      { id: issueId, first: limit }
    );
    return data.issue?.comments.nodes ?? [];
  }
}
