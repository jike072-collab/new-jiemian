import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFile(target) {
  return [target, `${target}.ts`, `${target}.tsx`, resolve(target, "index.ts"), resolve(target, "index.tsx")]
    .find((path) => existsSync(path) && statSync(path).isFile());
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    const target = specifier.startsWith("@/")
      ? resolve(root, "src", specifier.slice(2))
      : (specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")
        ? resolve(dirname(fileURLToPath(context.parentURL)), specifier)
        : "";
    if (!target) return nextResolve(specifier, context);
    const candidate = sourceFile(target);
    if (!candidate) return nextResolve(specifier, context);
    return { url: pathToFileURL(candidate).href, shortCircuit: true };
  },
});
