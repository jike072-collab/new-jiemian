const internalHostnames = new Set(["aohuang888.cn", "www.aohuang888.cn"]);

export function isInternalCanvasHostname(hostname: string | null | undefined) {
  return internalHostnames.has((hostname || "").trim().toLowerCase().replace(/:\d+$/, ""));
}

export function isRegistrationAllowedForHost(hostname: string | null | undefined) {
  return !isInternalCanvasHostname(hostname);
}
