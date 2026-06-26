import { normalizeDocument } from "./serialize";
import { SIGPATH_SCHEMA_VERSION } from "../schema";
import type { Build, SigbuildDocument, SigpathDocument } from "../schema";

/**
 * Read/write a {@link Build} as a standalone `.sigbuild` file (p2-savebuild) — the portable,
 * shareable sibling of a `.sigpath` project file. The on-disk shape is a thin versioned
 * wrapper so a future loader can migrate older builds; the embedded {@link Build.diagrams}
 * carry their own SIGPATH_SCHEMA_VERSION. The same {@link Build} also lives in the local
 * "Custom builds" library, so this module is only the file boundary.
 */

/** Wrap a build for persistence. */
export function toSigbuild(build: Build): SigbuildDocument {
  return { formatVersion: build.formatVersion, build };
}

/** Pretty-printed JSON for a `.sigbuild` file. */
export function serializeBuild(build: Build): string {
  return JSON.stringify(toSigbuild(build), null, 2);
}

/** Parse + minimally validate a loaded `.sigbuild` string, running load hygiene on the build. */
export function parseSigbuild(json: string): SigbuildDocument {
  const data = JSON.parse(json) as SigbuildDocument;
  if (!data || typeof data !== "object" || !data.build || !Array.isArray(data.build.diagrams)) {
    throw new Error("Not a valid .sigbuild file");
  }
  return { ...data, build: normalizeBuild(data.build) };
}

/**
 * Load-hygiene for a build before it enters the app: break any embed cycles in its diagram
 * closure so a hand-edited or future file can't drive flatten()/render into infinite
 * recursion. Reuses the document normalizer (wrapping the build's diagrams as a throwaway
 * project) rather than duplicating the cycle-breaker. Pure — returns a cleaned build.
 */
export function normalizeBuild(build: Build): Build {
  const wrapped: SigpathDocument = {
    schemaVersion: build.schemaVersion ?? SIGPATH_SCHEMA_VERSION,
    project: { id: build.id, name: build.name, diagrams: build.diagrams },
  };
  const diagrams = normalizeDocument(wrapped).project.diagrams;
  return { ...build, diagrams };
}
