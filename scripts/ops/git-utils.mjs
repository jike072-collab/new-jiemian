import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runSync } from "./process-utils.mjs";

export function safeGit(root, args, fallback = "") {
  try {
    return runSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], { cwd: root }).stdout.trim();
  } catch {
    if (args.join(" ") === "rev-parse HEAD") return readGitHead(root) || fallback;
    return fallback;
  }
}

export function readGitHead(root) {
  try {
    const dotGit = resolve(root, ".git");
    const gitDir = statSync(dotGit).isDirectory()
      ? dotGit
      : resolve(dirname(dotGit), readFileSync(dotGit, "utf8").replace(/^gitdir:\s*/i, "").trim());
    const head = readFileSync(resolve(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head;
    const ref = head.replace(/^ref:\s*/, "").trim();
    const refFile = resolve(gitDir, ref);
    if (existsSync(refFile)) return readFileSync(refFile, "utf8").trim();
    const packedRefs = resolve(gitDir, "packed-refs");
    if (!existsSync(packedRefs)) return null;
    for (const line of readFileSync(packedRefs, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#") || line.startsWith("^")) continue;
      const [sha, packedRef] = line.trim().split(/\s+/);
      if (packedRef === ref) return sha;
    }
  } catch {
    return null;
  }
  return null;
}
