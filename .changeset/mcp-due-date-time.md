---
"@omnidotdev/runa-mcp": patch
---

Keep due date times from MCP tools. A timestamp with a time of day now sets a due date and time instead of an all-day due date, and a bare date (`YYYY-MM-DD`) or a midnight timestamp sets an all-day due date on that day. Tasks read back show an all-day due date as its day and a timed one as its exact time.
