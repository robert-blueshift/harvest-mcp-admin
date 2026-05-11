#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = process.env.MCP_SERVER_PATH || resolve(__dirname, "..", "index.js");
const PAGE_SIZE = 30;
const LIST_KEYS = [
  "project_matches",
  "task_matches",
  "projects",
  "tasks",
  "users",
  "clients",
  "time_entries",
  "entries",
  "team",
  "succeeded",
  "failed",
  "incomplete",
];

function buildEnv() {
  return {
    HARVEST_ACCESS_TOKEN: process.env.HARVEST_ACCESS_TOKEN,
    HARVEST_ACCOUNT_ID: process.env.HARVEST_ACCOUNT_ID,
    HARVEST_RESOLVE_CACHE_TTL_SECONDS: process.env.HARVEST_RESOLVE_CACHE_TTL_SECONDS,
  };
}

function formatTools(tools) {
  return (tools || [])
    .map((tool, index) => {
      const desc = String(tool.description || "").replace(/\s+/g, " ").trim();
      const shortDesc = desc.length > 120 ? `${desc.slice(0, 117)}...` : desc;
      return `${index + 1}. ${tool.name}${shortDesc ? ` - ${shortDesc}` : ""}`;
    })
    .join("\n");
}

function toCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") {
    if ("name" in value) return String(value.name);
    if ("id" in value) return String(value.id);
    return JSON.stringify(value);
  }
  return String(value);
}

function pickColumns(items) {
  if (!items.length || typeof items[0] !== "object") return [];
  const preferred = [
    "id",
    "project_id",
    "external_id",
    "external_project_id",
    "code",
    "name",
    "project_name",
    "project_code",
    "task_name",
    "client_name",
    "client",
    "user",
    "email",
    "spent_date",
    "hours",
    "is_active",
    "status",
  ];
  const keys = new Set();
  for (const item of items) {
    Object.keys(item || {}).forEach((k) => keys.add(k));
  }
  const picked = preferred.filter((k) => keys.has(k));
  if (picked.length) return picked;
  return Array.from(keys).slice(0, 5);
}

function renderTable(items, label = "", totalCount = null, pageInfo = "") {
  if (!Array.isArray(items) || items.length === 0) {
    return label ? `${label}: (none)` : "(none)";
  }
  const columns = pickColumns(items);
  const rows = items;
  const widths = columns.map((column) => {
    if (column !== "project_name") return 20;
    const maxLen = Math.max(
      column.length,
      ...rows.map((row) => String(toCell(row[column])).length)
    );
    return Math.max(40, maxLen);
  });

  const pad = (value, idx) => {
    const str = String(value);
    if (str.length > widths[idx]) return `${str.slice(0, Math.max(0, widths[idx] - 3))}...`;
    return str.padEnd(widths[idx], " ");
  };

  const header = columns.map((c, i) => pad(c, i)).join("  ");
  const sep = columns.map((c, i) => "-".repeat(widths[i])).join("  ");
  const body = rows
    .map((row) => columns.map((c, i) => pad(toCell(row[c]), i)).join("  "))
    .join("\n");

  const count = totalCount ?? items.length;
  const baseTitle = label ? `${label} (${count})` : `${count} items`;
  const title = pageInfo ? `${baseTitle} ${pageInfo}` : baseTitle;
  return `${title}\n${header}\n${sep}\n${body}`;
}

function parseToolResult(result) {
  if (!result || !Array.isArray(result.content) || result.content.length === 0) return result;
  const text = result.content[0]?.text;
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function printHelp() {
  console.log("Commands:");
  console.log("  /list                          List available tools (numbered)");
  console.log("  /                             Open tool picker (same as /menu)");
  console.log("  /search                        Live search tools, then pick by number/name");
  console.log("  /find <text>                   Filter tools by name/description");
  console.log("  /call <tool|#> <json>          Call a tool (name or number from last list)");
  console.log("  /call <tool|#>                 Call a tool with empty args");
  console.log("  /<tool|#> [json]               Call a tool directly (no /call)");
  console.log("  <tool|#> [json]                Call a tool directly (no /call)");
  console.log("  /last [json]                   Repeat last call (optionally override args)");
  console.log("  /json                          Output raw JSON for tool results");
  console.log("  /pretty                        Output formatted results (default)");
  console.log("  /menu                          Interactive tool picker");
  console.log("  /help                          Show this help");
  console.log("  /exit                          Quit");
  console.log("\nTip: after /list, just type a number or tool name. Short suffixes like whoami work when unambiguous.");
  console.log("Example:");
  console.log("  /call 3 {\"per_page\":25,\"summary\":true}");
  console.log("  /whoami");
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: buildEnv(),
    stderr: "inherit",
    cwd: resolve(__dirname, ".."),
  });

  const client = new Client({ name: "local-mcp-repl", version: "1.0.0" });
  await client.connect(transport);

  let toolsCache = [];
  let lastDisplayedTools = [];
  let lastCall = null;
  let outputMode = "pretty";

  const commandCompletions = [
    "/",
    "/list",
    "/find",
    "/call",
    "/menu",
    "/search",
    "/help",
    "/exit",
    "/json",
    "/pretty",
    "/last",
  ];

  async function refreshTools() {
    const result = await client.listTools();
    toolsCache = result.tools || [];
    return toolsCache;
  }

  async function ensureTools() {
    if (!toolsCache.length) {
      await refreshTools();
    }
    return toolsCache;
  }

  function toolSuggestions() {
    const tools = lastDisplayedTools.length ? lastDisplayedTools : toolsCache;
    const names = tools.map((tool) => tool.name);
    const suffixes = names
      .map((name) => name.split("_").pop())
      .filter((value, index, self) => value && self.indexOf(value) === index);
    return Array.from(new Set([...names, ...suffixes]));
  }

  function buildCompletions(line) {
    const trimmed = line.trim();
    const suggestions = toolSuggestions();
    const slashSuggestions = suggestions.map((s) => `/${s}`);

    if (trimmed.startsWith("/call ")) {
      const prefix = trimmed.slice(6);
      const hits = suggestions.filter((s) => s.startsWith(prefix));
      const opts = hits.length ? hits : suggestions;
      return [opts.map((s) => `/call ${s}`), line];
    }

    if (trimmed.startsWith("/")) {
      const options = [...commandCompletions, ...slashSuggestions];
      const hits = options.filter((o) => o.startsWith(trimmed));
      return [hits.length ? hits : options, line];
    }

    const options = [...commandCompletions, ...suggestions];
    const hits = options.filter((o) => o.startsWith(trimmed));
    return [hits.length ? hits : options, line];
  }

  await refreshTools();

  const rl = createInterface({ input, output, terminal: true, completer: buildCompletions });
  rl.setPrompt("harvest> ");
  console.log("MCP REPL ready. Type /help for commands.");
  rl.prompt();

  async function resolveToolName(token) {
    if (token.startsWith("/")) token = token.slice(1);
    if (/^\d+$/.test(token)) {
      const index = Number(token) - 1;
      const list = lastDisplayedTools.length ? lastDisplayedTools : await ensureTools();
      if (index < 0 || index >= list.length) {
        throw new Error("Tool number out of range. Run /list or /find first.");
      }
      return list[index].name;
    }

    const tools = lastDisplayedTools.length ? lastDisplayedTools : await ensureTools();
    const exact = tools.find((tool) => tool.name === token);
    if (exact) return exact.name;

    const suffixMatches = tools.filter((tool) => tool.name.endsWith(`_${token}`));
    if (suffixMatches.length === 1) return suffixMatches[0].name;
    if (suffixMatches.length > 1) {
      const names = suffixMatches.map((tool) => tool.name).join(", ");
      throw new Error(`Ambiguous tool name. Matches: ${names}`);
    }

    return token;
  }

  async function renderArrayPages(items, label) {
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    for (let page = 0; page < pages; page += 1) {
      const start = page * PAGE_SIZE;
      const slice = items.slice(start, start + PAGE_SIZE);
      const pageInfo = pages > 1 ? `page ${page + 1}/${pages}` : "";
      console.log(renderTable(slice, label, total, pageInfo));
      if (page + 1 < pages) {
        const answer = (await rl.question("More? [Enter]=next, q=quit: ")).trim().toLowerCase();
        if (answer === "q" || answer === "quit") break;
      }
    }
  }

  async function renderPayload(payload) {
    if (payload === null || payload === undefined) {
      console.log("(empty)");
      return;
    }

    if (typeof payload === "string") {
      console.log(payload);
      return;
    }

    if (Array.isArray(payload)) {
      await renderArrayPages(payload, "items");
      return;
    }

    if (typeof payload === "object") {
      let handled = false;
      for (const key of LIST_KEYS) {
        if (Array.isArray(payload[key])) {
          handled = true;
          await renderArrayPages(payload[key], key);
        }
      }

      const meta = {};
      for (const [key, value] of Object.entries(payload)) {
        if (!LIST_KEYS.includes(key)) meta[key] = value;
      }
      if (Object.keys(meta).length) {
        console.log(JSON.stringify(meta, null, 2));
      } else if (!handled) {
        console.log(JSON.stringify(payload, null, 2));
      }
      return;
    }

    console.log(String(payload));
  }

  async function renderResult(result) {
    if (outputMode === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const payload = parseToolResult(result);
    await renderPayload(payload);
  }

  async function invokeTool(toolName, args, storeLast = true, prefetchedResult = null) {
    const result = prefetchedResult ?? (await client.callTool({ name: toolName, arguments: args }));
    if (storeLast) {
      lastCall = { name: toolName, args };
    }
    await renderResult(result);
  }

  async function liveQueryPrompt(toolName, baseArgs, title) {
    const stdin = input;
    const isRaw = stdin.isRaw;
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);

    let query = "";
    let latestResult = null;
    let debounce = null;
    let requestId = 0;

    const render = (payload) => {
      console.clear();
      console.log(`${title} (type to search, Enter to accept, Esc to cancel)`);
      console.log(`Query: ${query}`);
      if (!payload) {
        console.log("Type to search...");
        return;
      }
      const matches = payload?.matches;
      if (Array.isArray(matches)) {
        console.log(matches.length ? renderTable(matches, "matches") : "No matches.");
        return;
      }
      console.log(JSON.stringify(payload, null, 2));
    };

    const fetchAndRender = async () => {
      const trimmed = query.trim();
      if (!trimmed) {
        latestResult = null;
        render(null);
        return;
      }
      const current = ++requestId;
      try {
        const result = await client.callTool({ name: toolName, arguments: { ...baseArgs, query: trimmed } });
        if (current !== requestId) return;
        latestResult = result;
        const payload = parseToolResult(result);
        render(payload);
      } catch (err) {
        if (current !== requestId) return;
        render({ error: err.message });
      }
    };

    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(fetchAndRender, 250);
    };

    render(null);

    let cleanup = null;
    try {
      const action = await new Promise((resolve) => {
        const onKeypress = (str, key) => {
          if (key?.name === "escape") return resolve("cancel");
          if (key?.ctrl && key?.name === "c") return resolve("cancel");
          if (key?.name === "return") return resolve("select");
          if (key?.name === "backspace") {
            query = query.slice(0, -1);
            schedule();
            return;
          }
          if (str) {
            query += str;
            schedule();
          }
        };
        stdin.on("keypress", onKeypress);
        cleanup = () => stdin.off("keypress", onKeypress);
      });

      if (action !== "select") return null;
      if (debounce) clearTimeout(debounce);
      await fetchAndRender();
      if (!query.trim()) return null;
      return { query: query.trim(), prefetchedResult: latestResult };
    } finally {
      if (cleanup) cleanup();
      if (stdin.isTTY) stdin.setRawMode(Boolean(isRaw));
      console.clear();
    }
  }

  async function promptSelectFromSearch(toolName, label, baseArgs = {}) {
    const query = (await rl.question(`Search ${label} (blank to skip): `)).trim();
    if (!query) return null;
    const result = await client.callTool({ name: toolName, arguments: { ...baseArgs, query } });
    const payload = parseToolResult(result);
    const matches = payload?.matches;
    if (!Array.isArray(matches) || matches.length === 0) {
      console.log("No matches.");
      return null;
    }
    console.log(renderTable(matches, "matches"));
    const selection = (await rl.question(`Pick ${label} # (or Enter to skip): `)).trim();
    if (!selection) return null;
    const index = Number(selection) - 1;
    if (Number.isNaN(index) || index < 0 || index >= matches.length) {
      console.error("Invalid selection.");
      return null;
    }
    return matches[index];
  }

  async function promptTeamTimeEntries() {
    const args = {};

    const user = await promptSelectFromSearch("harvest_admin_search_users", "user", { limit: 10, match: "contains" });
    if (user?.id) args.user_id = user.id;

    const project = await promptSelectFromSearch("harvest_admin_search_projects", "project", { limit: 10, match: "contains" });
    if (project?.id) args.project_id = project.id;

    const client = await promptSelectFromSearch("harvest_admin_search_clients", "client", { limit: 10, match: "contains" });
    if (client?.id) args.client_id = client.id;

    const from = (await rl.question("From date (YYYY-MM-DD, blank for default): ")).trim();
    if (from) args.from = from;
    const to = (await rl.question("To date (YYYY-MM-DD, blank for default): ")).trim();
    if (to) args.to = to;

    const perPage = (await rl.question("Per page [default 50]: ")).trim();
    if (perPage) {
      const num = Number(perPage);
      if (Number.isNaN(num)) {
        console.error("Invalid number for per_page.");
      } else {
        args.per_page = num;
      }
    }

    const billed = (await rl.question("Filter billed? (y/n/blank for all): ")).trim().toLowerCase();
    if (billed === "y" || billed === "yes") args.is_billed = true;
    if (billed === "n" || billed === "no") args.is_billed = false;

    const summary = (await rl.question("Summary mode? [Y/n]: ")).trim().toLowerCase();
    if (summary === "n" || summary === "no") args.summary = false;

    const query = (await rl.question("Query (notes/project/task/client/user) [blank=skip]: ")).trim();
    if (query) {
      const match = (await rl.question("Match type [contains|exact|starts_with|not_contains] (default contains): ")).trim();
      args.query = query;
      if (match) args.match = match;
    }

    return args;
  }

  async function promptMyTimeEntries() {
    const args = {};

    const project = await promptSelectFromSearch("harvest_search_my_projects", "project", { limit: 10, match: "contains", is_active: true });
    if (project?.project_id) args.project_id = project.project_id;

    const task = await promptSelectFromSearch("harvest_search_my_tasks", "task", { limit: 10, match: "contains", is_active: true });
    if (task?.task_id) args.task_id = task.task_id;

    const from = (await rl.question("From date (YYYY-MM-DD, blank for last 7 days): ")).trim();
    if (from) args.from = from;
    const to = (await rl.question("To date (YYYY-MM-DD, blank for last 7 days): ")).trim();
    if (to) args.to = to;

    const limitInput = (await rl.question("Limit [default 50]: ")).trim();
    if (limitInput) {
      const num = Number(limitInput);
      if (Number.isNaN(num)) {
        console.error("Invalid number for limit.");
      } else {
        args.limit = num;
      }
    }

    const match = (await rl.question("Match type for query [contains|exact|starts_with] (default contains): ")).trim();
    if (match) args.match = match;

    const query = (await rl.question("Search query for notes/project/task (blank to skip): ")).trim();
    if (query) args.query = query;

    return args;
  }

  async function promptForArgs(toolName, tool) {
    const schema = tool?.inputSchema;
    if (!schema || typeof schema !== "object" || !schema.properties) {
      return {};
    }

    if (toolName === "harvest_admin_team_time_entries") {
      return await promptTeamTimeEntries();
    }

    if (toolName === "harvest_search_time_entries") {
      return await promptMyTimeEntries();
    }

    if (toolName.startsWith("harvest_admin_search_") || toolName.startsWith("harvest_search_")) {
      const match = (await rl.question("Match type [contains|exact|starts_with] (default contains): ")).trim() || "contains";
      const limitInput = (await rl.question("Limit [default 10]: ")).trim();
      const isActiveInput = (await rl.question("Active only? [Y/n]: ")).trim().toLowerCase();
      const limit = limitInput ? Number(limitInput) : 10;
      if (limitInput && Number.isNaN(limit)) {
        console.error("Invalid number for limit.");
        return null;
      }
      const is_active = !(isActiveInput === "n" || isActiveInput === "no");
      const baseArgs = { match, limit, is_active };
      const live = await liveQueryPrompt(toolName, baseArgs, `Search ${toolName.replace("harvest_admin_search_", "")}`);
      if (!live) return null;
      return { args: { ...baseArgs, query: live.query }, prefetchedResult: live.prefetchedResult };
    }

    const props = schema.properties;
    const required = new Set(schema.required || []);
    const args = {};

    for (const key of Object.keys(props)) {
      const def = props[key] || {};
      const desc = def.description ? ` - ${def.description}` : "";
      const defaultText = def.default !== undefined ? ` [default: ${JSON.stringify(def.default)}]` : "";
      const enumText = Array.isArray(def.enum) ? ` (options: ${def.enum.join(", ")})` : "";
      const prompt = `${key}${desc}${enumText}${defaultText}: `;

      let value = (await rl.question(prompt)).trim();
      if (!value) {
        if (def.default !== undefined) {
          args[key] = def.default;
          continue;
        }
        if (required.has(key)) {
          console.error("Required. Please enter a value.");
          value = (await rl.question(prompt)).trim();
          if (!value) {
            console.error("Skipping; required value missing.");
            return null;
          }
        } else {
          continue;
        }
      }

      if (def.enum && !def.enum.includes(value)) {
        const idx = Number(value);
        if (!Number.isNaN(idx) && def.enum[idx - 1]) {
          value = def.enum[idx - 1];
        }
      }

      if (def.type === "number") {
        const num = Number(value);
        if (Number.isNaN(num)) {
          console.error(`Invalid number for ${key}.`);
          return null;
        }
        args[key] = num;
        continue;
      }

      if (def.type === "boolean") {
        const lower = value.toLowerCase();
        if (["y", "yes", "true"].includes(lower)) args[key] = true;
        else if (["n", "no", "false"].includes(lower)) args[key] = false;
        else {
          console.error(`Invalid boolean for ${key}. Use y/n or true/false.`);
          return null;
        }
        continue;
      }

      if (def.type === "object" || def.type === "array") {
        try {
          args[key] = JSON.parse(value);
        } catch (err) {
          console.error(`Invalid JSON for ${key}: ${err.message}`);
          return null;
        }
        continue;
      }

      args[key] = value;
    }

    return args;
  }

  async function pickToolFromList(tools) {
    let selection = (await rl.question("Tool # or name: ")).trim();
    if (!selection) {
      return;
    }
    if (selection.startsWith("/")) selection = selection.slice(1);

    let toolName;
    try {
      toolName = await resolveToolName(selection);
    } catch (err) {
      console.error(err.message);
      return;
    }

    const tool = toolsCache.find((item) => item.name === toolName);
    const schema = tool?.inputSchema;
    if (schema && schema.properties) {
      const required = new Set(schema.required || []);
      const keys = Object.keys(schema.properties);
      if (keys.length) {
        const req = keys.filter((k) => required.has(k));
        const opt = keys.filter((k) => !required.has(k));
        const reqText = req.length ? `Required: ${req.join(", ")}.` : "";
        const optText = opt.length ? `Optional: ${opt.join(", ")}.` : "";
        console.log([reqText, optText].filter(Boolean).join(" "));
      }
    }

    const argsInput = (await rl.question("Args JSON (optional). Press Enter for guided prompts: ")).trim();
    if (argsInput) {
      try {
        const parsed = JSON.parse(argsInput);
        await invokeTool(toolName, parsed);
      } catch (err) {
        console.error(`Invalid JSON args: ${err.message}`);
      }
      return;
    }

    const guided = await promptForArgs(toolName, tool);
    if (guided === null) return;
    if (guided && guided.prefetchedResult) {
      await invokeTool(toolName, guided.args || {}, true, guided.prefetchedResult);
      return;
    }
    await invokeTool(toolName, guided || {});
  }

  async function runMenu() {
    const tools = await refreshTools();
    lastDisplayedTools = tools;
    console.log(formatTools(tools));
    await pickToolFromList(tools);
  }

  async function runSearch() {
    const tools = await refreshTools();
    lastDisplayedTools = tools;

    const stdin = input;
    const isRaw = stdin.isRaw;
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);

    let query = "";
    const filterTools = () => {
      const q = query.trim().toLowerCase();
      if (!q) return tools;
      return tools.filter((tool) => {
        const name = String(tool.name || "").toLowerCase();
        const desc = String(tool.description || "").toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    };

    const render = () => {
      console.clear();
      console.log("Search tools (type to filter, Enter to select, Esc to cancel)");
      console.log(`Query: ${query}`);
      const matches = filterTools();
      lastDisplayedTools = matches;
      console.log(matches.length ? formatTools(matches) : "No matching tools.");
    };

    render();

    let cleanup = null;
    try {
      const result = await new Promise((resolve) => {
        const onKeypress = (str, key) => {
          if (key?.name === "escape") return resolve("cancel");
          if (key?.ctrl && key?.name === "c") return resolve("cancel");
          if (key?.name === "return") return resolve("select");
          if (key?.name === "backspace") {
            query = query.slice(0, -1);
            render();
            return;
          }
          if (str) {
            query += str;
            render();
          }
        };
        stdin.on("keypress", onKeypress);
        cleanup = () => stdin.off("keypress", onKeypress);
      });

      console.clear();
      if (result !== "select") return;

      const matches = filterTools();
      lastDisplayedTools = matches;
      console.log(matches.length ? formatTools(matches) : "No matching tools.");
      if (!matches.length) return;
      await pickToolFromList(matches);
    } finally {
      if (cleanup) cleanup();
      if (stdin.isTTY) stdin.setRawMode(Boolean(isRaw));
    }
  }

  async function handleCall(rest) {
    if (!rest) {
      console.error("Usage: /call <tool|#> <json>");
      return false;
    }
    const firstSpace = rest.indexOf(" ");
    let toolToken = rest;
    let argsJson = "";
    if (firstSpace !== -1) {
      toolToken = rest.slice(0, firstSpace);
      argsJson = rest.slice(firstSpace + 1).trim();
    }

    let parsedArgs = {};
    if (argsJson) {
      try {
        parsedArgs = JSON.parse(argsJson);
      } catch (err) {
        console.error("Invalid JSON args:", err.message);
        return true;
      }
    }

    let toolName;
    try {
      toolName = await resolveToolName(toolToken);
    } catch (err) {
      console.error(err.message);
      return true;
    }

    const shouldPrompt =
      !argsJson &&
      (toolName === "harvest_admin_team_time_entries" ||
        toolName === "harvest_search_time_entries" ||
        toolName.startsWith("harvest_admin_search_") ||
        toolName.startsWith("harvest_search_"));

    if (shouldPrompt) {
      const tool = toolsCache.find((item) => item.name === toolName) || (await ensureTools()).find((item) => item.name === toolName);
      const guided = await promptForArgs(toolName, tool);
      if (guided === null) return true;
      if (guided && guided.prefetchedResult) {
        await invokeTool(toolName, guided.args || {}, true, guided.prefetchedResult);
        return true;
      }
      await invokeTool(toolName, guided || {});
      return true;
    }

    await invokeTool(toolName, parsedArgs);
    return true;
  }

  async function handleLast(argsJson) {
    if (!lastCall) {
      console.error("No previous call to repeat.");
      return;
    }
    let args = lastCall.args;
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch (err) {
        console.error("Invalid JSON args:", err.message);
        return;
      }
    }
    await invokeTool(lastCall.name, args, false);
    lastCall = { name: lastCall.name, args };
  }

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        continue;
      }

      if (trimmed === "/exit") break;

      if (trimmed === "/help") {
        printHelp();
        rl.prompt();
        continue;
      }

      if (trimmed === "/json") {
        outputMode = "json";
        console.log("Output mode: json");
        rl.prompt();
        continue;
      }

      if (trimmed === "/pretty") {
        outputMode = "pretty";
        console.log("Output mode: pretty");
        rl.prompt();
        continue;
      }

      if (trimmed === "/") {
        await runMenu();
        rl.prompt();
        continue;
      }

      if (trimmed === "/search") {
        await runSearch();
        rl.prompt();
        continue;
      }

      if (trimmed === "/list") {
        const tools = await refreshTools();
        lastDisplayedTools = tools;
        console.log(formatTools(tools));
        console.log("\nTip: type a tool number or name to run it (e.g. 1 or harvest_admin_list_projects). Use /call for JSON args.");
        rl.prompt();
        continue;
      }

      if (trimmed.startsWith("/find ")) {
        const query = trimmed.slice(6).trim().toLowerCase();
        if (!query) {
          console.error("Usage: /find <text>");
          rl.prompt();
          continue;
        }
        const tools = await ensureTools();
        const matches = tools.filter((tool) => {
          const name = String(tool.name || "").toLowerCase();
          const desc = String(tool.description || "").toLowerCase();
          return name.includes(query) || desc.includes(query);
        });
        lastDisplayedTools = matches;
        console.log(matches.length ? formatTools(matches) : "No matching tools.");
        if (matches.length) {
          console.log("\nTip: type a tool number or name to run it.");
        }
        rl.prompt();
        continue;
      }

      if (trimmed === "/menu") {
        await runMenu();
        rl.prompt();
        continue;
      }

      if (trimmed.startsWith("/call ")) {
        const rest = trimmed.slice(6).trim();
        await handleCall(rest);
        rl.prompt();
        continue;
      }

      if (trimmed.startsWith("/last")) {
        const argsJson = trimmed.slice(5).trim();
        await handleLast(argsJson || null);
        rl.prompt();
        continue;
      }

      const direct = trimmed.startsWith("/") ? trimmed.slice(1).trim() : trimmed;
      const handled = await handleCall(direct);
      if (!handled) {
        console.error("Unknown command. Type /help.");
      }
      rl.prompt();
    }
  } finally {
    rl.close();
    await client.close();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
