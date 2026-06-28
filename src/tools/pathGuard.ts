// Path-traversal guard. Resolves symlinks so that even a textual path
// that looks safe but points outside via a symlink is caught.

import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a path that may not yet exist (the target of an uncreated
 * write). If the path is a broken symlink, reject outright — we can't
 * trust a destination we can't inspect.
 */
export async function realpathExistingOrSymlink(
  resolved: string,
): Promise<{ real: string; requestPath: string }> {
  try {
    const real = await fs.promises.realpath(resolved);
    return { real, requestPath: resolved };
  } catch {
    const st = await fs.promises.lstat(resolved).catch(() => null);
    if (st?.isSymbolicLink()) {
      throw new Error(`Path outside workspace: ${resolved}`);
    }
    const parent = path.dirname(resolved);
    const realParent = await fs.promises
      .realpath(parent)
      .catch(() => parent);
    return {
      real: path.join(realParent, path.basename(resolved)),
      requestPath: resolved,
    };
  }
}

/** Sync best-effort resolve for use at registry construction time. */
export function realpathExistingSync(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    const realParent = realpathExistingSync(parent);
    return path.join(realParent, path.basename(p));
  }
}

export async function assertInWorkspace(
  workspaceReal: string,
  targetReal: string,
  requestPath: string,
): Promise<void> {
  const rel = path.relative(workspaceReal, targetReal);
  const escape =
    rel === "" ? false : rel.startsWith("..") || path.isAbsolute(rel);
  if (escape) {
    throw new Error(`Path outside workspace: ${requestPath}`);
  }
}
