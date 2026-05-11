#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log("Usage:");
  console.log("  harvest-admin            Start interactive MCP shell");
  console.log("  harvest-admin repl       Start interactive MCP shell");
  console.log("  harvest-admin list       List available tools");
  console.log("  harvest-admin call <tool> <json>  Call a tool with JSON args");
  console.log("  harvest-admin <tool> <json>       Shorthand for call");
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  printHelp();
  process.exit(0);
}

let script = "mcp-repl.js";
let scriptArgs = [];

if (args.length === 0 || args[0] === "repl") {
  script = "mcp-repl.js";
} else if (args[0] === "list") {
  script = "mcp-cli.js";
  scriptArgs = ["list", ...args.slice(1)];
} else if (args[0] === "call") {
  script = "mcp-cli.js";
  scriptArgs = ["call", ...args.slice(1)];
} else {
  script = "mcp-cli.js";
  scriptArgs = ["call", ...args];
}

const child = spawn("node", [resolve(__dirname, script), ...scriptArgs], {
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
