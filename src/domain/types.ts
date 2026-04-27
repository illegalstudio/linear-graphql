export type NodeConnection<T> = {
  nodes: T[];
  pageInfo?: {
    hasNextPage: boolean;
    endCursor?: string | null;
  };
};

export type LinearTeam = {
  id: string;
  key?: string | null;
  name: string;
  description?: string | null;
};

export type LinearUser = {
  id: string;
  name: string;
  displayName?: string | null;
  email?: string | null;
  active?: boolean | null;
};

export type LinearWorkflowState = {
  id: string;
  name: string;
  type?: string | null;
  position?: number | null;
  team?: LinearTeam | null;
};

export type LinearLabel = {
  id: string;
  name: string;
  color?: string | null;
  team?: LinearTeam | null;
};

export type LinearProject = {
  id: string;
  name: string;
  description?: string | null;
  content?: string | null;
  state?: string | null;
  priority?: number | null;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  teams?: NodeConnection<LinearTeam> | LinearTeam[];
};

export type LinearComment = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  url?: string | null;
  user?: LinearUser | null;
  issue?: Pick<LinearIssue, "id" | "identifier" | "title"> | null;
};

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string | null;
  priority?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  team?: LinearTeam | null;
  state?: LinearWorkflowState | null;
  assignee?: LinearUser | null;
  creator?: LinearUser | null;
  project?: LinearProject | null;
  labels?: NodeConnection<LinearLabel> | LinearLabel[];
  parent?: Pick<LinearIssue, "id" | "identifier" | "title"> | null;
  children?: NodeConnection<Pick<LinearIssue, "id" | "identifier" | "title">>;
};

export type CleanIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string | null;
  priority?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  team?: LinearTeam | null;
  state?: LinearWorkflowState | null;
  assignee?: LinearUser | null;
  project?: LinearProject | null;
  labels: LinearLabel[];
  parent?: Pick<LinearIssue, "id" | "identifier" | "title"> | null;
  children: Array<Pick<LinearIssue, "id" | "identifier" | "title">>;
};

export type Page<T> = {
  items: T[];
  pageInfo?: {
    hasNextPage: boolean;
    endCursor?: string | null;
  };
};

export function connectionNodes<T>(value: NodeConnection<T> | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.nodes ?? [];
}

export function cleanIssue(issue: LinearIssue): CleanIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    url: issue.url,
    priority: issue.priority,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    team: issue.team,
    state: issue.state,
    assignee: issue.assignee,
    project: issue.project,
    labels: connectionNodes(issue.labels),
    parent: issue.parent,
    children: connectionNodes(issue.children)
  };
}

export function cleanProject(project: LinearProject): LinearProject & { teams: LinearTeam[] } {
  return {
    ...project,
    teams: connectionNodes(project.teams)
  };
}
