#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { HarvestClient } from "./harvest-client.js";

const ACCESS_TOKEN = process.env.HARVEST_ACCESS_TOKEN;
const ACCOUNT_ID = process.env.HARVEST_ACCOUNT_ID;

if (!ACCESS_TOKEN || !ACCOUNT_ID) {
  console.error("Error: HARVEST_ACCESS_TOKEN and HARVEST_ACCOUNT_ID environment variables required.\nThis MCP requires an Admin-level personal access token.\nGet your token: https://id.getharvest.com/developers");
  process.exit(1);
}

const harvest = new HarvestClient(ACCESS_TOKEN, ACCOUNT_ID);

const RESOLVE_CACHE_TTL_SECONDS = Number(process.env.HARVEST_RESOLVE_CACHE_TTL_SECONDS || "300");
const RESOLVE_CACHE_TTL_MS = Math.max(0, RESOLVE_CACHE_TTL_SECONDS) * 1000;
const resolveCache = new Map();

function getCachedResolve(cacheKey) {
  if (RESOLVE_CACHE_TTL_MS <= 0) return null;
  const entry = resolveCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resolveCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function setCachedResolve(cacheKey, value) {
  if (RESOLVE_CACHE_TTL_MS <= 0) return;
  resolveCache.set(cacheKey, { value, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesName(value, query, matchType) {
  const name = normalizeName(value);
  const q = normalizeName(query);
  if (!q) return false;
  if (matchType === "exact") return name === q;
  if (matchType === "starts_with") return name.startsWith(q);
  return name.includes(q);
}

function summarizeUsers(result) {
  const { users, ...meta } = result;
  return {
    ...meta,
    users: (users || []).map((user) => ({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      is_active: user.is_active,
      is_admin: user.is_admin,
      is_project_manager: user.is_project_manager,
    })),
  };
}

function summarizeProjects(result) {
  const { projects, ...meta } = result;
  return {
    ...meta,
    projects: (projects || []).map((project) => ({
      id: project.id,
      name: project.name,
      code: project.code,
      is_active: project.is_active,
      client: project.client ? { id: project.client.id, name: project.client.name } : null,
    })),
  };
}

function summarizeTasks(result) {
  const { tasks, ...meta } = result;
  return {
    ...meta,
    tasks: (tasks || []).map((task) => ({
      id: task.id,
      name: task.name,
      is_active: task.is_active,
      billable_by_default: task.billable_by_default,
    })),
  };
}

function summarizeClients(result) {
  const { clients, ...meta } = result;
  return {
    ...meta,
    clients: (clients || []).map((client) => ({
      id: client.id,
      name: client.name,
      is_active: client.is_active,
    })),
  };
}

function summarizeTimeEntries(result) {
  const { time_entries, ...meta } = result;
  return {
    ...meta,
    time_entries: (time_entries || []).map((entry) => ({
      id: entry.id,
      spent_date: entry.spent_date,
      hours: entry.hours,
      is_billed: entry.is_billed,
      billable: entry.billable,
      user: entry.user ? { id: entry.user.id, name: entry.user.name } : null,
      project: entry.project ? { id: entry.project.id, name: entry.project.name } : null,
      task: entry.task ? { id: entry.task.id, name: entry.task.name } : null,
    })),
  };
}

function shouldSummarize(args) {
  return args.summary !== false;
}

async function resolveProjects({ project_name, is_active, client_id, limit, match }) {
  const cacheKey = `projects:${normalizeName(project_name)}:${is_active !== false}:${client_id ?? "all"}:${match}`;
  const cached = getCachedResolve(cacheKey);
  if (cached) return cached.slice(0, limit);

  const matches = [];
  let page = 1;
  while (matches.length < limit) {
    const result = await harvest.listProjects({ is_active, client_id, page, per_page: 100 });
    for (const project of result.projects || []) {
      if (matchesName(project.name, project_name, match)) {
        matches.push({
          id: project.id,
          name: project.name,
          is_active: project.is_active,
          client_id: project.client?.id ?? null,
          client_name: project.client?.name ?? null,
        });
        if (matches.length >= limit) break;
      }
    }
    if (!result.next_page) break;
    page = result.next_page;
  }

  setCachedResolve(cacheKey, matches);
  return matches.slice(0, limit);
}

async function resolveTasks({ task_name, is_active, limit, match }) {
  const cacheKey = `tasks:${normalizeName(task_name)}:${is_active !== false}:${match}`;
  const cached = getCachedResolve(cacheKey);
  if (cached) return cached.slice(0, limit);

  const matches = [];
  let page = 1;
  while (matches.length < limit) {
    const result = await harvest.listTasks({ is_active, page, per_page: 100 });
    for (const task of result.tasks || []) {
      if (matchesName(task.name, task_name, match)) {
        matches.push({
          id: task.id,
          name: task.name,
          is_active: task.is_active,
          billable_by_default: task.billable_by_default,
        });
        if (matches.length >= limit) break;
      }
    }
    if (!result.next_page) break;
    page = result.next_page;
  }

  setCachedResolve(cacheKey, matches);
  return matches.slice(0, limit);
}

function getWeekRange(weekOffset = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: monday.toISOString().split("T")[0], to: sunday.toISOString().split("T")[0] };
}

const TOOLS = [
  { name: "harvest_admin_company_info", description: "Get company settings: name, plan type, time tracking mode, modules enabled, weekly capacity, fiscal year start.", inputSchema: { type: "object", properties: {} } },
  { name: "harvest_admin_list_users", description: "List all users in the account. Can filter by active status. Use summary=true for slim results.", inputSchema: { type: "object", properties: { is_active: { type: "boolean" }, page: { type: "number" }, per_page: { type: "number", default: 100 }, summary: { type: "boolean", default: true } } } },
  { name: "harvest_admin_get_user", description: "Get full details of a specific user by ID.", inputSchema: { type: "object", properties: { user_id: { type: "number" } }, required: ["user_id"] } },
  { name: "harvest_admin_create_user", description: "Create a new user. Requires first_name, last_name, email. Optional: is_admin, is_project_manager, timezone, weekly_capacity, default_hourly_rate, cost_rate.", inputSchema: { type: "object", properties: { first_name: { type: "string" }, last_name: { type: "string" }, email: { type: "string" }, is_admin: { type: "boolean", default: false }, is_project_manager: { type: "boolean", default: false }, timezone: { type: "string" }, weekly_capacity: { type: "number" }, default_hourly_rate: { type: "number" }, cost_rate: { type: "number" } }, required: ["first_name", "last_name", "email"] } },
  { name: "harvest_admin_update_user", description: "Update user details: name, email, roles, rates, capacity, active status.", inputSchema: { type: "object", properties: { user_id: { type: "number" }, first_name: { type: "string" }, last_name: { type: "string" }, email: { type: "string" }, is_admin: { type: "boolean" }, is_project_manager: { type: "boolean" }, is_active: { type: "boolean" }, timezone: { type: "string" }, weekly_capacity: { type: "number" }, default_hourly_rate: { type: "number" }, cost_rate: { type: "number" } }, required: ["user_id"] } },
  { name: "harvest_admin_deactivate_user", description: "Deactivate a user (set is_active=false). Safer than deletion - preserves their time data.", inputSchema: { type: "object", properties: { user_id: { type: "number" } }, required: ["user_id"] } },
  { name: "harvest_admin_list_projects", description: "List all projects with client, budget, billing, and status info. Filterable by active status and client. Use summary=true for slim results.", inputSchema: { type: "object", properties: { is_active: { type: "boolean" }, client_id: { type: "number" }, page: { type: "number" }, per_page: { type: "number", default: 100 }, summary: { type: "boolean", default: true } } } },
  { name: "harvest_admin_get_project", description: "Get full details of a specific project.", inputSchema: { type: "object", properties: { project_id: { type: "number" } }, required: ["project_id"] } },
  { name: "harvest_admin_create_project", description: "Create a new project. Requires client_id, name, is_billable. Optional: bill_by, budget_by, budget, hourly_rate, notes, starts_on, ends_on, is_fixed_fee, notify_when_over_budget.", inputSchema: { type: "object", properties: { client_id: { type: "number" }, name: { type: "string" }, is_billable: { type: "boolean", default: true }, bill_by: { type: "string", enum: ["Project", "Tasks", "People", "none"] }, budget_by: { type: "string", enum: ["project", "project_cost", "task", "task_fees", "person", "none"] }, budget: { type: "number" }, hourly_rate: { type: "number" }, is_fixed_fee: { type: "boolean" }, notes: { type: "string" }, starts_on: { type: "string" }, ends_on: { type: "string" }, notify_when_over_budget: { type: "boolean" }, code: { type: "string" } }, required: ["client_id", "name", "is_billable"] } },
  { name: "harvest_admin_update_project", description: "Update project settings: name, budget, billing, active status, dates, notes.", inputSchema: { type: "object", properties: { project_id: { type: "number" }, name: { type: "string" }, client_id: { type: "number" }, is_billable: { type: "boolean" }, is_active: { type: "boolean" }, bill_by: { type: "string" }, budget_by: { type: "string" }, budget: { type: "number" }, hourly_rate: { type: "number" }, notes: { type: "string" }, starts_on: { type: "string" }, ends_on: { type: "string" }, code: { type: "string" } }, required: ["project_id"] } },
  { name: "harvest_admin_archive_project", description: "Archive a project (set is_active=false). Preserves all time data.", inputSchema: { type: "object", properties: { project_id: { type: "number" } }, required: ["project_id"] } },
  { name: "harvest_admin_delete_project", description: "WARNING: DELETE a project and ALL its time entries/expenses. This is destructive. Use archive instead if you want to preserve data.", inputSchema: { type: "object", properties: { project_id: { type: "number" } }, required: ["project_id"] } },
  { name: "harvest_admin_list_tasks", description: "List all tasks in the account. Tasks are shared across projects. Use summary=true for slim results.", inputSchema: { type: "object", properties: { is_active: { type: "boolean" }, page: { type: "number" }, per_page: { type: "number" }, summary: { type: "boolean", default: true } } } },
  { name: "harvest_admin_create_task", description: "Create a new task. Tasks can be assigned to multiple projects. Set is_default=true to auto-add to new projects.", inputSchema: { type: "object", properties: { name: { type: "string" }, billable_by_default: { type: "boolean", default: true }, default_hourly_rate: { type: "number" }, is_default: { type: "boolean", default: false } }, required: ["name"] } },
  { name: "harvest_admin_update_task", description: "Update task name, billing defaults, or active status.", inputSchema: { type: "object", properties: { task_id: { type: "number" }, name: { type: "string" }, billable_by_default: { type: "boolean" }, default_hourly_rate: { type: "number" }, is_default: { type: "boolean" }, is_active: { type: "boolean" } }, required: ["task_id"] } },
  { name: "harvest_admin_delete_task", description: "Delete a task. Only possible if no time entries exist for this task.", inputSchema: { type: "object", properties: { task_id: { type: "number" } }, required: ["task_id"] } },
  { name: "harvest_admin_assign_task_to_project", description: "Add a task to a project so team members can log time to it.", inputSchema: { type: "object", properties: { project_id: { type: "number" }, task_id: { type: "number" }, is_active: { type: "boolean", default: true }, billable: { type: "boolean" }, hourly_rate: { type: "number" }, budget: { type: "number" } }, required: ["project_id", "task_id"] } },
  { name: "harvest_admin_remove_task_from_project", description: "Remove a task assignment from a project.", inputSchema: { type: "object", properties: { project_id: { type: "number" }, task_assignment_id: { type: "number" } }, required: ["project_id", "task_assignment_id"] } },
  { name: "harvest_admin_assign_user_to_project", description: "Add a user to a project so they can log time to it.", inputSchema: { type: "object", properties: { project_id: { type: "number" }, user_id: { type: "number" }, is_active: { type: "boolean", default: true }, is_project_manager: { type: "boolean", default: false }, hourly_rate: { type: "number" }, budget: { type: "number" } }, required: ["project_id", "user_id"] } },
  { name: "harvest_admin_remove_user_from_project", description: "Remove a user from a project.", inputSchema: { type: "object", properties: { project_id: { type: "number" }, user_assignment_id: { type: "number" } }, required: ["project_id", "user_assignment_id"] } },
  { name: "harvest_admin_list_project_assignments", description: "List all task and user assignments for a project.", inputSchema: { type: "object", properties: { project_id: { type: "number" } }, required: ["project_id"] } },
  { name: "harvest_admin_list_clients", description: "List all clients. Use summary=true for slim results.", inputSchema: { type: "object", properties: { is_active: { type: "boolean" }, page: { type: "number" }, per_page: { type: "number" }, summary: { type: "boolean", default: true } } } },
  { name: "harvest_admin_create_client", description: "Create a new client.", inputSchema: { type: "object", properties: { name: { type: "string" }, is_active: { type: "boolean", default: true }, address: { type: "string" }, currency: { type: "string" } }, required: ["name"] } },
  { name: "harvest_admin_update_client", description: "Update client details.", inputSchema: { type: "object", properties: { client_id: { type: "number" }, name: { type: "string" }, is_active: { type: "boolean" }, address: { type: "string" }, currency: { type: "string" } }, required: ["client_id"] } },
  { name: "harvest_admin_team_time_entries", description: "View time entries for any user or all users. Admins can see everyone's time. Filter by user, project, client, date range. Use summary=true for slim results.", inputSchema: { type: "object", properties: { user_id: { type: "number" }, project_id: { type: "number" }, client_id: { type: "number" }, from: { type: "string" }, to: { type: "string" }, is_billed: { type: "boolean" }, page: { type: "number" }, per_page: { type: "number", default: 100 }, summary: { type: "boolean", default: true } } } },
  { name: "harvest_admin_edit_user_time", description: "Edit another user's time entry (admin only). Can change hours, notes, project, task.", inputSchema: { type: "object", properties: { time_entry_id: { type: "number" }, hours: { type: "number" }, notes: { type: "string" }, project_id: { type: "number" }, task_id: { type: "number" }, spent_date: { type: "string" } }, required: ["time_entry_id"] } },
  { name: "harvest_admin_create_time_for_user", description: "Create a time entry on behalf of another user (admin only).", inputSchema: { type: "object", properties: { user_id: { type: "number" }, project_id: { type: "number" }, task_id: { type: "number" }, spent_date: { type: "string" }, hours: { type: "number" }, notes: { type: "string" } }, required: ["user_id", "project_id", "task_id", "spent_date", "hours"] } },
  { name: "harvest_admin_report", description: "Run time reports across the whole account: by project, task, team member, or client. Requires from/to dates in YYYYMMDD format.", inputSchema: { type: "object", properties: { group_by: { type: "string", enum: ["projects", "tasks", "team", "clients"] }, from: { type: "string" }, to: { type: "string" } }, required: ["group_by", "from", "to"] } },
  { name: "harvest_admin_team_weekly_overview", description: "Get a weekly hours overview for all active users. Shows each person's total hours vs their 40h target. Great for spotting incomplete timesheets.", inputSchema: { type: "object", properties: { week_offset: { type: "number", default: 0 } } } },
  { name: "harvest_admin_list_roles", description: "List all roles in the account.", inputSchema: { type: "object", properties: {} } },
  { name: "harvest_admin_resolve_project_task", description: "Resolve project/task names to IDs with small responses. Defaults to active-only and limited results.", inputSchema: { type: "object", properties: { project_name: { type: "string" }, task_name: { type: "string" }, client_id: { type: "number" }, is_active: { type: "boolean", default: true }, limit: { type: "number", default: 5 }, match: { type: "string", enum: ["contains", "exact", "starts_with"], default: "contains" } } } },
];

async function handleTool(name, args) {
  switch (name) {
    case "harvest_admin_company_info": return await harvest.getCompany();
    case "harvest_admin_list_users": {
      const result = await harvest.listUsers({ is_active: args.is_active, page: args.page, per_page: args.per_page });
      return shouldSummarize(args) ? summarizeUsers(result) : result;
    }
    case "harvest_admin_get_user": return await harvest.getUser(args.user_id);
    case "harvest_admin_create_user": return await harvest.createUser(args);
    case "harvest_admin_update_user": { const { user_id, ...body } = args; return await harvest.updateUser(user_id, body); }
    case "harvest_admin_deactivate_user": return await harvest.updateUser(args.user_id, { is_active: false });
    case "harvest_admin_list_projects": {
      const result = await harvest.listProjects({ is_active: args.is_active, client_id: args.client_id, page: args.page, per_page: args.per_page });
      return shouldSummarize(args) ? summarizeProjects(result) : result;
    }
    case "harvest_admin_get_project": return await harvest.getProject(args.project_id);
    case "harvest_admin_create_project": return await harvest.createProject(args);
    case "harvest_admin_update_project": { const { project_id, ...body } = args; return await harvest.updateProject(project_id, body); }
    case "harvest_admin_archive_project": return await harvest.updateProject(args.project_id, { is_active: false });
    case "harvest_admin_delete_project": await harvest.deleteProject(args.project_id); return { success: true, message: `Project ${args.project_id} deleted` };
    case "harvest_admin_list_tasks": {
      const result = await harvest.listTasks({ is_active: args.is_active, page: args.page, per_page: args.per_page });
      return shouldSummarize(args) ? summarizeTasks(result) : result;
    }
    case "harvest_admin_create_task": return await harvest.createTask(args);
    case "harvest_admin_update_task": { const { task_id, ...body } = args; return await harvest.updateTask(task_id, body); }
    case "harvest_admin_delete_task": await harvest.deleteTask(args.task_id); return { success: true, message: `Task ${args.task_id} deleted` };
    case "harvest_admin_assign_task_to_project": return await harvest.createProjectTaskAssignment(args.project_id, { task_id: args.task_id, is_active: args.is_active, billable: args.billable, hourly_rate: args.hourly_rate, budget: args.budget });
    case "harvest_admin_remove_task_from_project": await harvest.deleteProjectTaskAssignment(args.project_id, args.task_assignment_id); return { success: true };
    case "harvest_admin_assign_user_to_project": return await harvest.createProjectUserAssignment(args.project_id, { user_id: args.user_id, is_active: args.is_active, is_project_manager: args.is_project_manager, hourly_rate: args.hourly_rate, budget: args.budget });
    case "harvest_admin_remove_user_from_project": await harvest.deleteProjectUserAssignment(args.project_id, args.user_assignment_id); return { success: true };
    case "harvest_admin_list_project_assignments": { const [tasks, users] = await Promise.all([harvest.listProjectTaskAssignments(args.project_id, { per_page: 100 }), harvest.listProjectUserAssignments(args.project_id, { per_page: 100 })]); return { task_assignments: tasks, user_assignments: users }; }
    case "harvest_admin_list_clients": {
      const result = await harvest.listClients({ is_active: args.is_active, page: args.page, per_page: args.per_page });
      return shouldSummarize(args) ? summarizeClients(result) : result;
    }
    case "harvest_admin_create_client": return await harvest.createClient(args);
    case "harvest_admin_update_client": { const { client_id, ...body } = args; return await harvest.updateClient(client_id, body); }
    case "harvest_admin_team_time_entries": {
      const result = await harvest.listTimeEntries({ user_id: args.user_id, project_id: args.project_id, client_id: args.client_id, from: args.from, to: args.to, is_billed: args.is_billed, page: args.page, per_page: args.per_page });
      return shouldSummarize(args) ? summarizeTimeEntries(result) : result;
    }
    case "harvest_admin_edit_user_time": { const { time_entry_id, ...body } = args; return await harvest.updateTimeEntry(time_entry_id, body); }
    case "harvest_admin_create_time_for_user": { const body = { user_id: args.user_id, project_id: args.project_id, task_id: args.task_id, spent_date: args.spent_date, hours: args.hours }; if (args.notes) body.notes = args.notes; return await harvest.createTimeEntry(body); }
    case "harvest_admin_report": return await harvest.getTimeReport(args.group_by, args.from, args.to);
    case "harvest_admin_team_weekly_overview": {
      const { from, to } = getWeekRange(args.week_offset || 0);
      const [usersResult, entriesResult] = await Promise.all([harvest.listUsers({ is_active: true, per_page: 100 }), harvest.listTimeEntries({ from, to, per_page: 100 })]);
      const userMap = {};
      for (const user of usersResult.users) { userMap[user.id] = { name: `${user.first_name} ${user.last_name}`, email: user.email, capacity: user.weekly_capacity || 40, total_hours: 0, daily: {} }; }
      for (const entry of entriesResult.time_entries) { if (userMap[entry.user.id]) { userMap[entry.user.id].total_hours += entry.hours; const day = entry.spent_date; if (!userMap[entry.user.id].daily[day]) userMap[entry.user.id].daily[day] = 0; userMap[entry.user.id].daily[day] += entry.hours; } }
      const team = Object.values(userMap).map((u) => ({ ...u, total_hours: Math.round(u.total_hours * 100) / 100, remaining: Math.round((u.capacity - u.total_hours) * 100) / 100, percent: Math.round((u.total_hours / u.capacity) * 100), is_complete: u.total_hours >= u.capacity }));
      team.sort((a, b) => a.percent - b.percent);
      return { week: `${from} to ${to}`, team, incomplete: team.filter((t) => !t.is_complete).map((t) => ({ name: t.name, hours: t.total_hours, remaining: t.remaining })) };
    }
    case "harvest_admin_list_roles": return await harvest.listRoles();
    case "harvest_admin_resolve_project_task": {
      const is_active = args.is_active !== false;
      const limit = Math.max(1, Math.min(20, args.limit || 5));
      const match = args.match || "contains";
      const [projectMatches, taskMatches] = await Promise.all([
        args.project_name ? resolveProjects({ project_name: args.project_name, is_active, client_id: args.client_id, limit, match }) : Promise.resolve([]),
        args.task_name ? resolveTasks({ task_name: args.task_name, is_active, limit, match }) : Promise.resolve([]),
      ]);
      return {
        project_matches: projectMatches,
        task_matches: taskMatches,
        limit,
        is_active,
        match,
      };
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server({ name: "harvest-admin", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Harvest Admin MCP server running");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
