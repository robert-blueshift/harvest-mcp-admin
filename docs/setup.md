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
Quick install (admin + time):
```bash
git clone git@github.com:robert-blueshift/harvest-mcp-admin.git
cd harvest-mcp-admin
./scripts/install-global.sh --clone-time --interactive
```

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

## Terminal MCP client (no Claude Desktop)
Use the local CLI wrapper to call tools directly from your terminal.

What each command does:
- `list` shows a numbered tool list (use `--json` for raw output).
- `call` invokes a tool with JSON arguments and prints the JSON result.

List tools:
```bash
node scripts/mcp-cli.js list
node scripts/mcp-cli.js list --json
```

Call a tool (JSON args):
```bash
node scripts/mcp-cli.js call harvest_admin_list_projects '{\"per_page\": 25, \"summary\": true}'
```

NPM shortcuts:
```bash
npm run mcp:list
npm run mcp:call -- harvest_admin_list_projects '{\"per_page\": 25, \"summary\": true}'
npm run mcp:repl
```

REPL commands:
Use `/json` to see raw tool responses; `/pretty` switches back. Long results are paged; press Enter for more, or q to stop.
You can type a tool number or name directly (no /call needed). Prefixing with / also works. Typing `/` opens the tool picker. `/search` opens live search. `/list` prints the full list. Tab completes tool names. Short suffixes like `whoami` are accepted when unambiguous.
Search tools (`harvest_admin_search_*`) use a live query prompt when you skip JSON args or invoke them directly with no args.
```
/
/list
/search
1
harvest_admin_list_projects {"per_page":25,"summary":true}
/find project
/call 3 {"per_page":25,"summary":true}
/menu
/last
```

Global command (optional):
```bash
cd /Users/robert/Documents/Projects/harvest-mcp-admin
npm link
harvest-admin
harvest-admin list
harvest-admin call harvest_admin_list_projects '{\"per_page\": 25, \"summary\": true}'
```

Optional combined command (admin + time):
```bash
harvest list
harvest admin list
harvest time list
```

Note: `harvest` defaults to time if `harvest-time` is linked; otherwise it falls back to admin.
Note: `harvest time ...` requires `npm link` in the harvest-mcp-time repo.

Global install script (recommended):
```bash
./scripts/install-global.sh
```

If you don't have harvest-mcp-time yet:
```bash
./scripts/install-global.sh --clone-time
```

Admin-only install:
```bash
./scripts/install-global.sh --admin-only
```

Add convenience aliases:
```bash
./scripts/install-global.sh --add-aliases
```

Prompt for env vars (if missing) and add to ~/.zshrc:
```bash
./scripts/install-global.sh --set-env
```

Guided setup (env vars + aliases + optional open + clipboard):
```bash
./scripts/install-global.sh --interactive
```

Optional alias for convenience:
```bash
alias harvest=harvest-admin
```

Environment:
- `HARVEST_ACCESS_TOKEN` and `HARVEST_ACCOUNT_ID` must be set.
- Optional: `HARVEST_RESOLVE_CACHE_TTL_SECONDS`, `MCP_SERVER_PATH`.

## Tool behavior and response size
Claude Desktop has a response size limit (around 1MB). To avoid large responses:
- Use pagination (`page`, `per_page`) and narrow filters (`is_active`, `client_id`, date ranges).
- List endpoints default to `summary: true` (slim payloads).
- Set `summary: false` if you need full details.

### Summary mode (default on)
List tools return only key fields to keep payloads small:
- Users: id, name, email, roles
- Projects: id, external_project_id (project code), name, code, client, active
- Tasks: id, name, billable, active
- Clients: id, name, active
- Time entries: id, date, hours, user, project, task

The team time entries tool defaults to the last 7 days and `per_page=50`. Provide explicit `from`/`to` and a smaller `per_page` when you expect large volumes. Optional `query` + `match` filters notes/project/task/client/user fields.

### Resolver tool
Use `harvest_admin_resolve_project_task` to find IDs without pulling large lists.
Supports `project_name` or `project_code` (external project id).
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

### Search tools (quick lookup)
Use these when you want lightweight lookup results without full lists:
- `harvest_admin_search_projects` (name or project code)
- `harvest_admin_search_users` (name or email)
- `harvest_admin_search_tasks` (task name)
- `harvest_admin_search_clients` (client name)

Example:
```json
{
  "tool": "harvest_admin_search_projects",
  "arguments": {
    "query": "ClearScore",
    "limit": 10,
    "match": "contains"
  }
}
```

### External references on admin time entry tools
`harvest_admin_create_time_for_user` and `harvest_admin_edit_user_time` support Harvest's `external_reference` field.

- Omit `external_reference` on edit to leave it unchanged.
- Pass `external_reference: null` on edit to clear it.
- Invalid nested payloads fail schema validation instead of being silently dropped.

Example:
```json
{
  "tool": "harvest_admin_create_time_for_user",
  "arguments": {
    "user_id": 2976345,
    "project_id": 34070008,
    "task_id": 23741358,
    "spent_date": "2026-05-12",
    "hours": 0.1,
    "notes": "TEST: MCP external_reference create",
    "external_reference": {
      "id": "96521",
      "group_id": "10042",
      "account_id": null,
      "permalink": "https://blueshift.atlassian.net/browse/IMP-3229",
      "service": "blueshift.atlassian.net",
      "service_icon_url": "https://proxy.harvestfiles.com/production_harvestapp_public/uploads/platform_icons/blueshift.atlassian.net.png?1618390664"
    }
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
