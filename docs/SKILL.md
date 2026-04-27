---
name: linear-graphql-tool
description: Use this skill when an AI agent needs to interact with Linear through this repository's Node.js/TypeScript Linear GraphQL tool, including CLI commands, local HTTP API calls, issue/project/team operations, webhook inbox processing, and queue-based agent workflows.
---

# Linear GraphQL Tool

Use this skill to operate the local `linear-graphql-tool` project safely and predictably.

## Core Rules

- Prefer read-only commands first when exploring a workspace.
- Do not persist API keys unless the user explicitly asks. Use env-prefix commands for temporary tests.
- Treat pasted Linear API keys as secrets and recommend rotation after exposure.
- Use `--json` for agent-readable output.
- Ask before creating, updating, commenting on, or moving real Linear issues unless the user clearly requested the write.
- Avoid noisy output. Return identifiers, titles, URLs, state, assignee, project, and next action.

## Project Setup

From the project root:

```bash
npm install
npm run typecheck
npm test
npm run build
```

For persistent local setup:

```bash
cp .env.example .env
```

Set at least:

```bash
LINEAR_API_KEY=lin_api_xxx
LINEAR_DEFAULT_TEAM=IS
```

For temporary usage without writing `.env`:

```bash
LINEAR_API_KEY='lin_api_xxx' npm run cli -- --json team list
```

## Validate Access

Run:

```bash
npm run cli -- config check
npm run cli -- --json team list
npm run cli -- --json workflow list --team IS
npm run cli -- --json issue search --team IS --limit 3
```

If using a temporary key, prefix each command:

```bash
LINEAR_API_KEY='lin_api_xxx' npm run cli -- --json issue search --team IS --limit 3
```

## CLI Operations

Search issues:

```bash
npm run cli -- --json issue search "login" --team IS --status "In Progress" --limit 10
```

View an issue:

```bash
npm run cli -- --json issue view IS-123
```

Create an issue:

```bash
npm run cli -- --json issue create --title "Fix webhook retry path" --team IS --label Bug --priority 2
```

Update an issue:

```bash
npm run cli -- --json issue update IS-123 --status Done --assignee user@example.com
```

Add a comment:

```bash
npm run cli -- --json comment add IS-123 --body "Investigated by local agent."
```

List teams, projects, and workflow states:

```bash
npm run cli -- --json team list
npm run cli -- --json project list
npm run cli -- --json workflow list --team IS
```

## Human References

The tool resolves human-friendly references internally:

- issue identifiers: `IS-123`
- team keys or names: `IS`, `Illegal Studio`
- workflow state names: `Todo`, `In Progress`, `Done`
- project names: `Apotecate`, `LazyAgent`
- assignee email/name or `me`
- label names

When resolution fails, list the relevant entity type and retry with an exact name or UUID.

## HTTP API

Start the server:

```bash
npm run serve
```

Health check:

```bash
curl -s http://127.0.0.1:8787/health
```

Search via HTTP:

```bash
curl -s http://127.0.0.1:8787/issue/search \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-secret' \
  -d '{"team":"IS","limit":5}'
```

If `LINEAR_LOCAL_BEARER_TOKEN` is unset, local routes do not require the bearer token. If it is set, all local API routes except `/health` and `/hooks/linear` require it.

## Queue Workflow

Use the local queue for agent inbox processing:

```bash
npm run cli -- --json queue peek
npm run cli -- --json queue pop --lease-ms 300000
npm run cli -- --json queue complete <item-id> --claim-token <token>
npm run cli -- --json queue fail <item-id> --error "temporary failure"
```

Agent pattern:

1. `queue pop` to claim one item.
2. Inspect `payload.route`, `payload.data`, and Linear identifiers.
3. Perform the requested work.
4. `queue complete` only after successful handling.
5. `queue fail` for retryable errors.

Claims expire and recover automatically after their lease.

## Webhooks

Configure:

```bash
LINEAR_WEBHOOK_SECRET=whsec_xxx
```

Run:

```bash
npm run cli -- webhook serve
```

Linear should call:

```text
POST http://<host>:8787/hooks/linear
```

The server verifies `Linear-Signature` with HMAC-SHA256 and enqueues routed events such as:

- `linear.issue.created`
- `linear.issue.updated`
- `linear.issue.assignee_changed`
- `linear.issue.state_changed`
- `linear.comment.created`
- `linear.comment.mention`

## Programmatic Tool Surface

For TypeScript integrations, import the runtime:

```ts
import { createRuntime, loadConfig } from "./src/index.js";

const runtime = createRuntime(loadConfig({ requireApiKey: true }));

await runtime.tools.searchIssues({ team: "IS", limit: 10 });
await runtime.tools.getIssue({ id: "IS-123" });
await runtime.tools.addComment({ issue: "IS-123", body: "Handled by agent." });
await runtime.tools.peekQueue({ limit: 5 });
```

Prefer these functions when building an MCP bridge or OpenClaw adapter because they return predictable structured data.

## Error Handling

Common categories:

- config: missing or invalid env
- auth: invalid Linear key, webhook signature, or local bearer token
- user: invalid input or ambiguous command
- not_found: unresolved issue/team/project/user/label/state
- linear_api: Linear GraphQL/API error

When reporting failure, include the command, high-level error, and the safest next step. Do not dump secrets or full environment values.

## Verification Checklist

Before handing off:

```bash
npm run typecheck
npm test
npm run build
```

For runtime checks:

```bash
npm run cli -- --json team list
npm run cli -- --json issue search --team IS --limit 1
```
