# @omnidotdev/runa-mcp

## 0.1.0

### Minor Changes

- [`c973823`](https://github.com/omnidotdev/runa-mcp/commit/c9738234639b6d424fe4a60b4af7e08747743ea6) Thanks [@coopbri](https://github.com/coopbri)! - Add the Runa MCP server: connect an AI assistant to Runa by browser sign-in or a workspace API token, then list projects, columns, and tasks, read tasks with their comments, and create, update, move, and comment on tasks.

### Patch Changes

- [#5](https://github.com/omnidotdev/runa-mcp/pull/5) [`7c08b74`](https://github.com/omnidotdev/runa-mcp/commit/7c08b74a905d943742ea6e5f21f0996f25cf4982) Thanks [@coopbri](https://github.com/coopbri)! - Keep due date times from MCP tools. A timestamp with a time of day now sets a due date and time instead of an all-day due date, and a bare date (`YYYY-MM-DD`) or a midnight timestamp sets an all-day due date on that day. Tasks read back show an all-day due date as its day and a timed one as its exact time.
