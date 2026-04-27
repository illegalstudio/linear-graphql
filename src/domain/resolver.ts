import type { AppConfig } from "../config/config.js";
import type { LinearApi } from "../client/linearApi.js";
import { NotFoundError, UserInputError } from "../utils/errors.js";
import type { LinearLabel, LinearProject, LinearTeam, LinearUser, LinearWorkflowState } from "./types.js";
import { connectionNodes } from "./types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

class TtlCache {
  private readonly values = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly ttlMs: number) {}

  async get<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const value = await loader();
    this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  clear(): void {
    this.values.clear();
  }
}

export class EntityResolver {
  private readonly cache: TtlCache;

  constructor(
    private readonly api: LinearApi,
    config: Pick<AppConfig, "cacheTtlMs" | "defaultTeam" | "defaultProject">
  ) {
    this.cache = new TtlCache(config.cacheTtlMs);
    this.defaultTeam = config.defaultTeam;
    this.defaultProject = config.defaultProject;
  }

  private readonly defaultTeam?: string;
  private readonly defaultProject?: string;

  clearCache(): void {
    this.cache.clear();
  }

  async resolveTeamId(reference?: string): Promise<string> {
    const value = reference ?? this.defaultTeam;
    if (!value) {
      throw new UserInputError("Team is required. Provide --team or set LINEAR_DEFAULT_TEAM.");
    }
    if (isUuid(value)) return value;
    const team = await this.resolveTeam(value);
    return team.id;
  }

  async resolveTeam(reference: string): Promise<LinearTeam> {
    const teams = await this.cache.get("teams", () => this.api.listTeams());
    const match = findByReference(teams, reference, (team) => [team.id, team.key, team.name]);
    if (!match) {
      throw new NotFoundError(`Could not resolve Linear team "${reference}"`);
    }
    return match;
  }

  async resolveUserId(reference: string | null): Promise<string | null> {
    if (reference === null) return null;
    if (!reference) throw new UserInputError("Assignee reference cannot be empty");
    if (isUuid(reference)) return reference;

    if (reference.toLowerCase() === "me") {
      const viewer = await this.cache.get("viewer", () => this.api.viewer());
      return viewer.id;
    }

    const users = await this.cache.get("users", () => this.api.listUsers());
    const match = findByReference(users, reference, (user) => [user.id, user.email, user.name, user.displayName]);
    if (!match) {
      throw new NotFoundError(`Could not resolve Linear user "${reference}"`);
    }
    return match.id;
  }

  async resolveWorkflowStateId(reference: string, teamReference?: string): Promise<string> {
    if (isUuid(reference)) return reference;
    const teamId = teamReference ? await this.resolveTeamId(teamReference) : undefined;
    const states = await this.cache.get("workflowStates", () => this.api.listWorkflowStates());
    const scopedStates = teamId ? states.filter((state) => state.team?.id === teamId) : states;
    const match = findByReference(scopedStates, reference, (state) => [state.id, state.name]);

    if (!match) {
      const suffix = teamId ? ` for team "${teamReference}"` : "";
      throw new NotFoundError(`Could not resolve workflow state "${reference}"${suffix}`);
    }

    return match.id;
  }

  async listWorkflowStates(teamReference?: string): Promise<LinearWorkflowState[]> {
    const teamId = teamReference ? await this.resolveTeamId(teamReference) : undefined;
    const states = await this.cache.get("workflowStates", () => this.api.listWorkflowStates());
    return teamId ? states.filter((state) => state.team?.id === teamId) : states;
  }

  async resolveProjectId(reference?: string | null): Promise<string | null | undefined> {
    if (reference === null) return null;
    const value = reference ?? this.defaultProject;
    if (!value) return undefined;
    if (isUuid(value)) return value;
    const project = await this.resolveProject(value);
    return project.id;
  }

  async resolveProject(reference: string): Promise<LinearProject> {
    const projects = await this.cache.get("projects", () => this.api.listProjects());
    const match = findByReference(projects, reference, (project) => [project.id, project.name]);
    if (!match) {
      throw new NotFoundError(`Could not resolve Linear project "${reference}"`);
    }
    return match;
  }

  async resolveLabelId(reference: string, teamReference?: string): Promise<string> {
    if (isUuid(reference)) return reference;
    const teamId = teamReference ? await this.resolveTeamId(teamReference) : undefined;
    const labels = await this.cache.get("labels", () => this.api.listIssueLabels());
    const scopedLabels = teamId
      ? labels.filter((label) => !label.team || label.team.id === teamId)
      : labels;
    const match = findByReference(scopedLabels, reference, (label) => [label.id, label.name]);
    if (!match) {
      throw new NotFoundError(`Could not resolve Linear label "${reference}"`);
    }
    return match.id;
  }

  async resolveLabelIds(references: string[], teamReference?: string): Promise<string[]> {
    const ids = await Promise.all(references.map((reference) => this.resolveLabelId(reference, teamReference)));
    return [...new Set(ids)];
  }

  async resolveTeamIds(references: string[]): Promise<string[]> {
    const ids = await Promise.all(references.map((reference) => this.resolveTeamId(reference)));
    return [...new Set(ids)];
  }
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function findByReference<T>(items: T[], reference: string, candidates: (item: T) => Array<string | null | undefined>): T | undefined {
  const normalized = normalize(reference);
  return items.find((item) => candidates(item).some((candidate) => candidate !== undefined && candidate !== null && normalize(candidate) === normalized));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function teamNames(project: LinearProject): string[] {
  return connectionNodes(project.teams).map((team) => team.name);
}
