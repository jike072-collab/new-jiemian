#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getKnownServiceRoot, getServiceConfig } from "./service-config.mjs";
import { runSync } from "./process-utils.mjs";

export function registerServiceTask(service, options = {}) {
  const root = getKnownServiceRoot(service, options);
  const config = getServiceConfig(service, { root });
  const watchdogScript = writeWatchdogScript(config);
  const hiddenLauncher = writeHiddenLauncher(config);
  const command = `wscript.exe "${hiddenLauncher}"`;
  const args = [
    "/Create",
    "/TN",
    config.taskName,
    "/SC",
    "MINUTE",
    "/MO",
    "10",
    "/TR",
    command,
    "/RL",
    "LIMITED",
    "/F",
  ];
  runSync("schtasks.exe", args);
  return { service, taskName: config.taskName, watchdogScript, hiddenLauncher, created: true, requiresAdmin: false };
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function writeWatchdogScript(config) {
  mkdirSync(config.runtimeDir, { recursive: true });
  const scriptPath = join(config.runtimeDir, `watchdog-${config.service}.ps1`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$root = '${escapePowerShellSingleQuoted(config.root)}'`,
    "$watchdog = Join-Path $root 'scripts/ops/watchdog-service.mjs'",
    "Set-Location -LiteralPath $root",
    `$node = '${escapePowerShellSingleQuoted(process.execPath)}'`,
    `$arguments = @($watchdog, '${escapePowerShellSingleQuoted(config.service)}', '--root', $root)`,
    "$process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru -Wait",
    "exit $process.ExitCode",
    "",
  ].join("\r\n");
  writeFileSync(scriptPath, `\uFEFF${script}`, "utf8");
  return scriptPath;
}

function writeHiddenLauncher(config) {
  mkdirSync(config.runtimeDir, { recursive: true });
  const launcherPath = join(config.runtimeDir, `watchdog-${config.service}-hidden.vbs`);
  const scriptName = `watchdog-${config.service}.ps1`;
  const script = [
    'Set shell = CreateObject("WScript.Shell")',
    'Set files = CreateObject("Scripting.FileSystemObject")',
    "runtimeDir = files.GetParentFolderName(WScript.ScriptFullName)",
    "root = files.GetParentFolderName(runtimeDir)",
    `scriptPath = files.BuildPath(runtimeDir, "${scriptName}")`,
    "shell.CurrentDirectory = root",
    'command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """"',
    "exitCode = shell.Run(command, 0, True)",
    "WScript.Quit exitCode",
    "",
  ].join("\r\n");
  writeFileSync(launcherPath, script, "ascii");
  return launcherPath;
}

function cli() {
  const service = process.argv[2];
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  const result = registerServiceTask(service, { root });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    cli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
