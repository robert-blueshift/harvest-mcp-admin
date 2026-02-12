# harvest-mcp-admin

MCP server for Harvest admin operations. **Admins only** — manages projects, tasks, users, clients, and team-wide time tracking.

## Tools (30)

**Users:** list, get, create, update, deactivate
**Projects:** list, get, create, update, archive, delete
**Tasks:** list, create, update, delete
**Assignments:** assign tasks/users to projects, remove, list all
**Clients:** list, create, update
**Team Time:** view anyone's entries, edit/create entries for users
**Reports:** account-wide by project/task/team/client
**Team Overview:** weekly summary for ALL users — spot incomplete timesheets
**Company:** settings, roles

## Setup

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
        "HARVEST_ACCOUNT_ID": "your-account-id"
      }
    }
  }
}
```

> Admins should also install [harvest-mcp-time](https://github.com/robert-blueshift/harvest-mcp-time) for personal time tracking.

### 4. Restart Claude Desktop

## Usage Examples

```
"Who hasn't submitted their time this week?"
"Create a new project for Acme Corp"
"Add Jessica to the EPC Network project"
"Show me all time logged to ClearScore this month"
"What are the team's hours by client for Q1?"
```
