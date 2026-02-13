# Harvest MCP Admin - Setup and Operational Notes

## Purpose
This repo provides an MCP server that exposes Harvest admin operations (projects, tasks, users, clients, time entries) to clients like Claude Desktop.

## Repo layout
- `index.js`: MCP server entrypoint and tool handlers.
- `harvest-client.js`: Thin Harvest API client (HTTP wrapper and endpoints).
- `package.json`: Dependencies and start script.

## Requirements
- Node.js
- Harvest Admin personal access token and account ID

## Install
```bash
git clone git@github.com:robert-blueshift/harvest-mcp-admin.git
cd harvest-mcp-admin
npm install
```

## Claude Desktop configuration
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "harvest-admin": {
      "command": "node",
      "args": ["/Users/robert/Documents/Projects/harvest-mcp-admin/index.js"],
      "env": {
        "HARVEST_ACCESS_TOKEN": "your-admin-token",
        "HARVEST_ACCOUNT_ID": "your-account-id",
        "HARVEST_RESOLVE_CACHE_TTL_SECONDS": "300"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

## Environment variables
- `HARVEST_ACCESS_TOKEN` (required)
- `HARVEST_ACCOUNT_ID` (required)
- `HARVEST_RESOLVE_CACHE_TTL_SECONDS` (optional)
  - Default: 300 (5 minutes)
  - Set to `0` to disable resolver caching

## Running locally (smoke test)
```bash
HARVEST_ACCESS_TOKEN=... HARVEST_ACCOUNT_ID=... npm run start
```
You should see: `Harvest Admin MCP server running`

## Tool behavior and response size
Claude Desktop has a response size limit (around 1MB). To avoid large responses:
- Use pagination (`page`, `per_page`) and narrow filters (`is_active`, `client_id`, date ranges).
- List endpoints default to `summary: true` (slim payloads).
- Set `summary: false` if you need full details.

### Summary mode (default on)
List tools return only key fields to keep payloads small:
- Users: id, name, email, roles
- Projects: id, name, code, client, active
- Tasks: id, name, billable, active
- Clients: id, name, active
- Time entries: id, date, hours, user, project, task

### Resolver tool
Use `harvest_admin_resolve_project_task` to find IDs without pulling large lists.
Defaults: `is_active: true`, `limit: 5`, `match: "contains"`.

Example:
```json
{
  "tool": "harvest_admin_resolve_project_task",
  "arguments": {
    "project_name": "EPC Network",
    "task_name": "Design",
    "is_active": true,
    "limit": 5,
    "match": "contains"
  }
}
```

## Troubleshooting
### "Server disconnected" in Claude Desktop
Most common causes:
- Wrong `args` path to `index.js`
- Missing env vars (`HARVEST_ACCESS_TOKEN`, `HARVEST_ACCOUNT_ID`)
- Leading/trailing spaces in paths

### Validate paths
Make sure `args` is a full absolute path and there are no extra spaces:
```
"args": ["/Users/robert/Documents/Projects/harvest-mcp-admin/index.js"]
```

## How it works (high level)
- `index.js` defines tools and dispatches calls to `HarvestClient`.
- `HarvestClient` maps MCP tool calls to Harvest API endpoints.
- For large datasets, list tools return summarized payloads by default.
- The resolver tool is optimized to return minimal results and caches lookups.

## Extending tools
To add a new tool:
1. Add an entry to `TOOLS` in `index.js`.
2. Implement a handler case in `handleTool`.
3. If it can return large payloads, consider a `summary` option.

