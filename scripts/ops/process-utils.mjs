import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

function commandForPlatform(command, args) {
  if (process.platform === "win32" && ["npm", "npx"].includes(command)) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const final = commandForPlatform(command, args);
    const child = spawn(final.command, final.args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      stdio: options.stdio || "inherit",
      detached: options.detached || false,
    });
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} ${args.join(" ")} exited with signal ${signal}`));
      else if (code === 0) resolve({ code });
      else reject(new Error(`${command} ${args.join(" ")} failed with status ${code ?? 1}`));
    });
    child.on("error", reject);
  });
}

export function runSync(command, args, options = {}) {
  const final = commandForPlatform(command, args);
  const result = spawnSync(final.command, final.args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
  });
  if (result.error && !options.allowError) throw result.error;
  if (result.status !== 0 && !options.allowStatus?.includes(result.status)) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(" ")} failed with status ${result.status}`);
  }
  return result;
}

export function isPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(Number(port), host, () => server.close(() => resolve(true)));
  });
}

export async function assertPortAvailable(port) {
  if (!await isPortAvailable(port)) {
    throw new Error(`Port ${port} is already in use; refusing to start a duplicate service.`);
  }
}

export function getListeningPid(port) {
  if (process.platform === "win32") {
    const result = spawnSync("netstat.exe", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      shell: false,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0) return null;
    const pattern = new RegExp(`(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[?::1\\]?):${port}\\s+[^\\s]+\\s+LISTENING\\s+(\\d+)`, "i");
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = pattern.exec(line);
      if (match) return Number(match[1]);
    }
    return null;
  }
  return null;
}

export function getProcessInfo(pid) {
  if (!pid) return null;
  if (process.platform !== "win32") {
    try {
      process.kill(pid, 0);
      return { processId: pid, running: true };
    } catch {
      return null;
    }
  }
  const command = [
    "$p=Get-CimInstance Win32_Process -Filter \"ProcessId=" + Number(pid) + "\" -ErrorAction SilentlyContinue;",
    "if($p){$p|Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate|ConvertTo-Json -Compress}",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

export function stopProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    runSync("taskkill.exe", ["/PID", String(pid), "/T"], { allowStatus: [0, 128] });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already stopped.
  }
}
