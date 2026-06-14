import { createHash } from "node:crypto";
import * as path from "node:path";

export interface RepositoryIdentity {
  id: string;
  legacyId: string;
  name: string;
  path: string;
}

export function resolveRepositoryIdentity(repoPath: string): RepositoryIdentity {
  const canonicalPath = path.resolve(repoPath);
  const normalizedPath = canonicalPath.replace(/\\/g, "/").toLowerCase();
  const hash = createHash("sha256").update(normalizedPath).digest("hex").slice(0, 16);
  const name = path.basename(canonicalPath);

  return {
    id: `repo_${hash}`,
    legacyId: name,
    name,
    path: canonicalPath,
  };
}
