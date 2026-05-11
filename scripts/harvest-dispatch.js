#!/usr/bin/env node

import { spawn } from "node:child_process";

function printHelp() {
  console.log("Usage:");
  console.log("  harvest                 Start time REPL if available, otherwise admin");
  console.log("  harvest admin ...       Run admin commands");
  console.log("  harvest time ...        Run time commands (requires harvest-time linked)");
  console.log("\nExamples:");
  console.log("  harvest list");
  console.log("  harvest admin call harvest_admin_list_projects '{\"per_page\":25}'");
  console.log("  harvest time list");
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  printHelp();
  process.exit(0);
}

const mode = args[0];
const isExplicitAdmin = mode === "admin";
const isExplicitTime = mode === "time";
const isImplicit = !isExplicitAdmin && !isExplicitTime;

if (isExplicitAdmin || isExplicitTime) {
  const target = isExplicitTime ? "harvest-time" : "harvest-admin";
  const forwardArgs = args.slice(1);
  const child = spawn(target, forwardArgs, { stdio: "inherit" });

  child.on("error", (err) => {
    if (isExplicitTime) {
      console.error("Error: harvest-time command not found. Run 'npm link' in the harvest-mcp-time repo.");
    } else {
      console.error("Error: harvest-admin command not found. Run 'npm link' in the harvest-mcp-admin repo.");
    }
    console.error(err.message);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
} else if (isImplicit) {
  const child = spawn("harvest-time", args, { stdio: "inherit" });

  child.on("error", (err) => {
    if (err.code !== "ENOENT") {
      console.error(err.message);
      process.exit(1);
    }
    const fallback = spawn("harvest-admin", args, { stdio: "inherit" });
    fallback.on("error", (fallbackErr) => {
      console.error("Error: harvest-admin command not found. Run 'npm link' in the harvest-mcp-admin repo.");
      console.error(fallbackErr.message);
      process.exit(1);
    });
    fallback.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
