#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = process.env.MCP_SERVER_PATH || resolve(__dirname, "..", "index.js");
const MAX_ROWS = 30;
const COLUMN_WIDTH = 20;

function usage() {
  console.error("Usage:");
  console.error("  node scripts/mcp-cli.js list [--json]");
  console.error("  node scripts/mcp-cli.js call <tool_name> '{\"arg\":\"value\"}' [--json]");
  console.error("\nEnvironment:");
  console.error("  HARVEST_ACCESS_TOKEN, HARVEST_ACCOUNT_ID (required)");
  console.error("  HARVEST_RESOLVE_CACHE_TTL_SECONDS (optional)");
  console.error("  MCP_SERVER_PATH (optional, defaults to ./index.js)");
  process.exit(1);
}

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

function renderTable(items, label = "", totalCount = null, pageInfo = "", showMore = true) {
  if (!Array.isArray(items) || items.length === 0) {
    return label ? `${label}: (none)` : "(none)";
  }
  const columns = pickColumns(items);
  const rows = items.slice(0, MAX_ROWS);
  const widths = columns.map((column) => {
    if (column !== "project_name") return COLUMN_WIDTH;
    const maxLen = Math.max(
      column.length,
      ...rows.map((row) => String(toCell(row[column])).length)
    );
    return Math.max(COLUMN_WIDTH * 2, maxLen);
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
  const extra = showMore && count > MAX_ROWS ? `\n...and ${count - MAX_ROWS} more` : "";
  const baseTitle = label ? `${label} (${count})` : `${count} items`;
  const title = pageInfo ? `${baseTitle} ${pageInfo}` : baseTitle;
  return `${title}\n${header}\n${sep}\n${body}${extra}`;
}

function formatPayload(payload) {
  if (payload === null || payload === undefined) return "(empty)";
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) return renderTable(payload);

  if (typeof payload === "object") {
    const sections = [];
    const listKeys = [
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

    for (const key of listKeys) {
      if (Array.isArray(payload[key])) {
        sections.push(renderTable(payload[key], key));
      }
    }

    if (sections.length) {
      const meta = {};
      for (const [key, value] of Object.entries(payload)) {
        if (!listKeys.includes(key)) meta[key] = value;
      }
      const metaText = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : "";
      return `${sections.join("\n\n")}${metaText}`;
    }

    return JSON.stringify(payload, null, 2);
  }

  return String(payload);
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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  if (!command) usage();

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: buildEnv(),
    stderr: "inherit",
    cwd: resolve(__dirname, ".."),
  });

  const client = new Client({ name: "local-mcp-cli", version: "1.0.0" });
  await client.connect(transport);

  try {
    if (command === "list") {
      const result = await client.listTools();
      if (rest.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatTools(result.tools));
      }
      return;
    }

    if (command === "call") {
      const filtered = rest.filter((arg) => arg !== "--json");
      const toolName = filtered[0];
      const argsJson = filtered[1];
      const raw = rest.includes("--json");
      if (!toolName) usage();
      let parsedArgs = {};
      if (argsJson) {
        try {
          parsedArgs = JSON.parse(argsJson);
        } catch (err) {
          throw new Error(`Invalid JSON for args: ${err.message}`);
        }
      }
      const result = await client.callTool({ name: toolName, arguments: parsedArgs });
      if (raw) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const payload = parseToolResult(result);
      console.log(formatPayload(payload));
      return;
    }

    usage();
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
