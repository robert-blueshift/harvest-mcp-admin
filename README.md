# harvest-mcp-admin

MCP server for Harvest admin operations. **Admins only** — manages projects, tasks, users, clients, and team-wide time tracking.

## Tools (35)

**Users:** list, get, create, update, deactivate
**Projects:** list, get, create, update, archive, delete
**Tasks:** list, create, update, delete
**Assignments:** assign tasks/users to projects, remove, list all
**Clients:** list, create, update
**Team Time:** view anyone's entries (default: last 7 days, per_page=50), optional query/match filters, edit/create entries for users, optional `external_reference`
**Reports:** account-wide by project/task/team/client
**Team Overview:** weekly summary for ALL users — spot incomplete timesheets
**Company:** settings, roles
**Resolver:** resolve project/task names or project_code to IDs (active-only default)
**Search:** quick search for users, projects, tasks, clients (limited results)

## Setup

### Quick install (admin + time)
```bash
git clone git@github.com:robert-blueshift/harvest-mcp-admin.git
cd harvest-mcp-admin
./scripts/install-global.sh --clone-time --interactive
```

### 1. Get Your Admin Harvest Token

Go to [https://id.getharvest.com/developers](https://id.getharvest.com/developers):
1. Click **Create New Personal Access Token**
2. Name it "Claude MCP Admin"
3. Copy your **Token** and **Account ID**
4. Ensure your Harvest user has **Admin** role

### 2. Install

```bash
git clone git@github.com:robert-blueshift/harvest-mcp-admin.git
cd harvest-mcp-admin
npm install
```

### 3. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "harvest-admin": {
      "command": "node",
      "args": ["/path/to/harvest-mcp-admin/index.js"],
      "env": {
        "HARVEST_ACCESS_TOKEN": "your-admin-token",
        "HARVEST_ACCOUNT_ID": "your-account-id",
        "HARVEST_RESOLVE_CACHE_TTL_SECONDS": "300"
      }
    }
  }
}
```

> Admins should also install [harvest-mcp-time](https://github.com/robert-blueshift/harvest-mcp-time) for personal time tracking.

### 4. Restart Claude Desktop

## Terminal MCP client (no Claude Desktop)
Use the local CLI wrapper to call tools directly from your terminal.

What each command does:
- `list` shows a numbered tool list (use `--json` for raw output).
- `call` invokes a tool with JSON arguments and prints the JSON result.

```bash
node scripts/mcp-cli.js list
node scripts/mcp-cli.js list --json
node scripts/mcp-cli.js call harvest_admin_list_projects '{"per_page": 25, "summary": true}'
```

NPM shortcuts:
```bash
npm run mcp:list
npm run mcp:call -- harvest_admin_list_projects '{"per_page": 25, "summary": true}'
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

Admin time-entry create/edit tools also accept Harvest `external_reference` so Jira-linked entries keep their structured icon/link in Harvest.

Global command (optional):
```bash
cd /Users/robert/Documents/Projects/harvest-mcp-admin
npm link
harvest-admin
harvest-admin list
harvest-admin call harvest_admin_list_projects '{"per_page": 25, "summary": true}'
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

## Usage Examples

```
"Who hasn't submitted their time this week?"
"Create a new project for Acme Corp"
"Add Jessica to the EPC Network project"
"Show me all time logged to ClearScore this month"
"What are the team's hours by client for Q1?"
"Resolve project 'EPC Network' and task 'Design' (active only)"
```

Resolver tool example (returns a small list of matches with IDs):

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

List tools default to `summary: true` to keep responses small. Set `summary: false` if you need full payloads.
