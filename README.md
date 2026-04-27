# linear-graphql-tool

Node.js + TypeScript toolkit for Linear's GraphQL API. It can run as:

- local CLI: `linear-tool ...`
- local HTTP API: `linear-tool serve`
- Linear webhook receiver with a persistent local inbox
- importable tool surface for self-hosted agents, MCP bridges, or future OpenClaw plugins

The implementation uses direct GraphQL calls to `https://api.linear.app/graphql`, API-key auth via the `Authorization` header, and Linear webhook HMAC verification via `Linear-Signature`.

## Install

```bash
npm install
npm run build
```

During development:

```bash
npm run cli -- --help
npm run serve
```

After `npm link` or package install:

```bash
linear-tool --help
```

## Configure

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Required for Linear API commands:

```bash
LINEAR_API_KEY=lin_api_xxx
```

Useful optional values:

```bash
LINEAR_DEFAULT_TEAM=ENG
LINEAR_DEFAULT_PROJECT=Roadmap
LINEAR_WEBHOOK_SECRET=whsec_xxx
LINEAR_LOCAL_BEARER_TOKEN=local-secret
LINEAR_QUEUE_FILE=.linear-tool/queue.jsonl
```

Validate config:

```bash
npm run cli -- config check
npm run cli -- config debug
```

## CLI Examples

Search and view issues:

```bash
npm run cli -- issue search "login" --team ENG --status "In Progress" --limit 10
npm run cli -- issue view ENG-123
```

Create and update:

```bash
npm run cli -- issue create --title "Fix webhook retry path" --team ENG --label Bug --priority 2
npm run cli -- issue update ENG-123 --status Done --assignee alice@example.com
npm run cli -- issue label add ENG-123 Backend
npm run cli -- issue project ENG-123 "Q2 Roadmap"
npm run cli -- issue parent ENG-124 ENG-123
```

Comments:

```bash
npm run cli -- comment add ENG-123 --body "Investigated by local agent."
npm run cli -- comment list ENG-123
```

Teams, projects, workflow states:

```bash
npm run cli -- team list
npm run cli -- team members ENG
npm run cli -- project list
npm run cli -- project create --name "Agent Inbox" --team ENG --description "Automation intake"
npm run cli -- workflow list --team ENG
```

Agent-friendly JSON:

```bash
npm run cli -- --json issue search "webhook" --team ENG
npm run cli -- --json queue pop
```

Queue:

```bash
npm run cli -- queue peek
npm run cli -- queue pop --lease-ms 300000
npm run cli -- queue complete <queue-item-id> --claim-token <token>
npm run cli -- queue fail <queue-item-id> --error "temporary failure"
```

## HTTP API

Start the local server:

```bash
npm run serve
```

Default bind is `127.0.0.1:8787`.

Endpoints:

- `GET /health`
- `POST /issue/search`
- `POST /issue/view`
- `POST /issue/create`
- `POST /issue/update`
- `POST /comment/add`
- `POST /comment/list`
- `GET /queue`
- `POST /queue/pop`
- `POST /queue/complete`
- `POST /hooks/linear`

If `LINEAR_LOCAL_BEARER_TOKEN` is set, local API routes require:

```http
Authorization: Bearer <token>
```

`/health` and `/hooks/linear` do not use the local bearer token. Webhooks are authenticated with Linear's HMAC signature.

Example:

```bash
curl -s http://127.0.0.1:8787/issue/search \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-secret' \
  -d '{"query":"login","team":"ENG","limit":5}'
```

## Webhooks

Set `LINEAR_WEBHOOK_SECRET` to the secret Linear shows when creating the webhook. Configure Linear to call:

```text
POST http://your-host:8787/hooks/linear
```

The server verifies `Linear-Signature` against the raw request body using HMAC-SHA256. Valid events are routed into the local queue with deduplication.

Recognized routes include:

- `linear.issue.created`
- `linear.issue.updated`
- `linear.issue.assignee_changed`
- `linear.issue.state_changed`
- `linear.comment.created`
- `linear.comment.mention`

Unknown Linear webhook types are still persisted as `linear.<type>.<action>` so agents can inspect them.

## Local Queue

The queue is an append-only JSONL log. It supports:

- `enqueue`
- `peek`
- `pop` / claim with lease
- `complete`
- `fail` with retry delay
- dedup keys
- priority ordering
- crash recovery for expired claims

This is intentionally simple and self-host friendly. If you later need multi-process high-throughput consumers, replace `FileQueue` with a sqlite-backed implementation behind the same interface.

## Agent Tool Surface

Import from `src/index.ts` or the built package:

```ts
import { createRuntime, loadConfig } from "linear-graphql-tool";

const runtime = createRuntime(loadConfig({ requireApiKey: true }));

await runtime.tools.searchIssues({ query: "webhook", team: "ENG", limit: 10 });
await runtime.tools.getIssue({ id: "ENG-123" });
await runtime.tools.createIssue({ title: "Agent-created task", team: "ENG", labels: [] });
await runtime.tools.addComment({ issue: "ENG-123", body: "Done by local agent." });
await runtime.tools.peekQueue({ limit: 5 });
```

The tool methods return clean structured JSON and avoid noisy GraphQL response shapes.

## Project Structure

```text
src/
  cli/          Commander CLI
  client/       raw GraphQL client and Linear operation wrapper
  config/       dotenv loading and zod validation
  domain/       service layer, schemas, identifier resolution
  http/         local HTTP API
  queue/        persistent JSONL queue
  tools/        agent-oriented tool functions
  utils/        logging and typed errors
  webhook/      Linear signature verification and event routing
tests/          vitest coverage for critical behavior
```

## Reliability Notes

- GraphQL calls retry transient network, timeout, and server errors with exponential backoff.
- Linear GraphQL errors are surfaced explicitly, including rate-limit headers where available.
- Config, user input, auth, Linear API, not-found, and runtime errors use distinct error classes.
- Name-to-ID resolution caches teams, users, states, labels, and projects for `LINEAR_CACHE_TTL_MS`.
- CLI exits with separate codes for config, auth, user input, Linear API, and runtime failures.

## Tests

```bash
npm run typecheck
npm test
```

Current coverage includes:

- config validation
- identifier resolution
- webhook signature verification and routing
- queue claim/recovery behavior
- core issue service behavior with a mocked Linear API

## Future OpenClaw / MCP Integration

The intended bridge point is `createLinearTools`. An OpenClaw plugin or MCP server can wrap these functions directly:

- expose each method as one MCP tool
- keep `FileQueue` for local webhook inbox state
- add a sqlite queue adapter if multiple agent workers need concurrent claims
- map OpenClaw agent identity to Linear comments or labels
- add policy checks before write operations such as state changes or project moves

The current HTTP API can also act as a stable local bridge while a native plugin is developed.

## References

- Linear GraphQL getting started: https://linear.app/developers/graphql
- Linear webhooks: https://linear.app/developers/webhooks
- Linear rate limits: https://linear.app/developers/rate-limiting
