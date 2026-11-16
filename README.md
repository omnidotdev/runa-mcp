# @omnidotdev/runa-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an
AI agent work with [Runa](https://runa.omni.dev) boards. It wraps the Runa API
and authenticates as the customer (through a browser sign-in or a Runa
workspace API token), exposing focused, well-described tools to list projects,
columns, and tasks, read a task with its comments, and create, update, move,
and comment on tasks.

Customer-facing setup and the tool reference live in the
[Runa docs](https://docs.omni.dev/products/runa/mcp).

## Tools

Every tool except `list_workspaces` also takes an optional `workspace` (a slug
or id); see [Workspaces](#workspaces). Tools take human identifiers:

- `project`: the project's slug, name, task prefix (for example `APP`), or id
- `task`: the task's key (for example `APP-12`) or id
- `column`: the column's title (for example `In Progress`) or id

| Tool | Access | Description |
| --- | --- | --- |
| `list_workspaces` | read | The workspaces you can act in (id, slug, name) |
| `list_projects` | read | The workspace's projects with name, slug, task prefix, and id |
| `list_columns` | read | A project's columns (statuses) in board order, marking the done column |
| `list_tasks` | read | A project's tasks in board order, optionally by `column`, `priority`, or title `search` (`limit` 1 to 100, default 50) |
| `get_task` | read | One task with its description and comments |
| `create_task` | **write** | Create a task at the end of a column (the project's first column by default) |
| `update_task` | **write** | Change a task's title, description, priority, or due date (`dueDate: null` clears it; a `YYYY-MM-DD` date or a midnight timestamp sets an all-day due date, any other timestamp a due date and time) |
| `move_task` | **write** | Move a task to another column of its project, at the end of that column |
| `add_comment` | **write** | Comment on a task |

Plain text sent to the write tools is stored as escaped paragraphs, and stored
rich text is returned as plain text.

## Hosted (recommended)

Connect by URL; there is nothing to install. The hosted endpoint is:

```
https://mcp.runa.omni.dev/mcp
```

### Sign in through the browser (default)

Add the URL to your MCP client with no credentials. On first use the client
gets a `401`, discovers the sign-in server from the endpoint's protected
resource metadata, and opens your browser to sign in with your Omni account and
approve access. The agent then acts with exactly your permissions, and the
client refreshes the sign-in on its own.

```json
{
  "mcpServers": {
    "runa": {
      "type": "http",
      "url": "https://mcp.runa.omni.dev/mcp"
    }
  }
}
```

This follows the standard
[MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
flow: OAuth 2.1 with PKCE, client registration through RFC 7591 dynamic client
registration, and access tokens bound to this server (RFC 8707). The sign-in
server is Gatekeeper (`https://identity.omni.dev`). Registered clients are
always shown a consent page and can only use `https` or loopback redirect URIs.

### API token (CI and headless agents)

Where no browser is available, send a Runa workspace API token (`runa_...`,
created by a workspace admin in the workspace's settings under API tokens). It
is sent on every request and forwarded as-is to the Runa API, which applies its
scopes:

```json
{
  "mcpServers": {
    "runa": {
      "type": "http",
      "url": "https://mcp.runa.omni.dev/mcp",
      "headers": {
        "Authorization": "Bearer runa_your_token_here"
      }
    }
  }
}
```

| Tool | Scope |
| --- | --- |
| `list_projects`, `list_columns` | `project:read` |
| `list_tasks`, `get_task` | `task:read` |
| `create_task`, `update_task`, `move_task` | `task:write` |
| `add_comment` | `comment:write` |

### Workspaces

A browser sign-in can belong to several workspaces. Call `list_workspaces` to
see them, then pass `workspace` (a slug or id) to the other tools. With exactly
one workspace it is selected automatically; with several, a tool called without
`workspace` returns an error asking for one. The choice is checked against your
sign-in's memberships, and the tools scope their queries to it. An API token
is bound to the workspace it was created in, so it ignores `workspace`.

### Protocol details

The endpoint speaks MCP Streamable HTTP in stateless mode: each `POST /mcp` is
served independently, and `GET` and `DELETE` return `405`.

- `GET /.well-known/oauth-protected-resource` (also served at
  `/.well-known/oauth-protected-resource/mcp`) returns the RFC 9728 metadata:
  resource `https://mcp.runa.omni.dev`, authorization server
  `https://identity.omni.dev`, and scopes `openid profile email organization`.
- A request without a bearer token returns `401` with
  `WWW-Authenticate: Bearer resource_metadata="https://mcp.runa.omni.dev/.well-known/oauth-protected-resource", scope="openid profile email organization"`.
- A JWT must be a Gatekeeper access token (EdDSA, issuer
  `https://identity.omni.dev`) whose audience includes
  `https://mcp.runa.omni.dev`; otherwise the response is `401` with
  `error="invalid_token"`. Any other bearer is treated as a Runa API token and
  forwarded for the Runa API to validate.
- Tokens are never logged.

### Self-hosting the HTTP server

```bash
bun run start:http             # listens on 0.0.0.0:3000
docker build -t runa-mcp .
docker run -p 3000:3000 runa-mcp
```

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `RUNA_API_URL` | `https://api.runa.omni.dev` | Runa API base URL |
| `MCP_RESOURCE_URL` | `https://mcp.runa.omni.dev` | This server's resource identifier: the advertised `resource` and the audience user tokens must carry |
| `AUTH_ISSUER` | `https://identity.omni.dev` | Authorization server; the required token issuer |
| `AUTH_JWKS_URL` | `<AUTH_ISSUER>/jwks` | Key set user tokens are verified against |
| `AUTH_USERINFO_URL` | `<AUTH_ISSUER>/oauth2/userinfo` | Where `list_workspaces` reads workspace names and slugs |
| `GATEKEEPER_CLAIMS_NAMESPACE` | `https://manifold.omni.dev/@omni/claims` | Namespace of the `organizations` claim |

`GET /health` returns `200 ok` for liveness and readiness probes.
`RUNA_API_TOKEN` is ignored in this mode; the token always comes from the
request.

## Local (stdio)

Alternatively, run the server locally over stdio.

### Configuration

Set two environment variables:

- `RUNA_API_TOKEN` (required) - a Runa workspace API token, e.g. `runa_...`.
- `RUNA_API_URL` (optional) - the API base URL. Defaults to
  `https://api.runa.omni.dev`.

Without a token the server still boots; every tool returns a clear error until
the token is set (startup-warning convention: warn and degrade, never crash).

### MCP client config

Run from a checkout with Bun, using the absolute path to `src/index.ts`:

```json
{
  "mcpServers": {
    "runa": {
      "command": "bun",
      "args": ["run", "/path/to/runa-mcp/src/index.ts"],
      "env": {
        "RUNA_API_URL": "https://api.runa.omni.dev",
        "RUNA_API_TOKEN": "runa_your_token_here"
      }
    }
  }
}
```

## Development

```bash
bun install
bun test           # unit and HTTP handler tests (no live API)
bun run typecheck  # tsc --noEmit
bun run check      # biome lint + format check
bun run start      # run the stdio server
bun run start:http # run the hosted Streamable HTTP server
```

## Notes and limitations

- **Transport:** stdio (`runa-mcp` binary) and stateless Streamable HTTP
  (`src/http.ts`). The HTTP mode has no sessions, so server-initiated
  notifications and resumable streams are not supported.
- **Moves:** `move_task` moves a task between columns of its own project.
  Moving a task to another project is done in the Runa app.

## License

The code in this repository is licensed under Apache 2.0, &copy; [Omni LLC](https://omni.dev). See [LICENSE.md](LICENSE.md) for more information.
