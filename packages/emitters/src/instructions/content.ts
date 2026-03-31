type InstructionsMode = 'safe' | 'permissive' | 'off';

// ─────────────────────────────────────────────────────────────────────────────
// Canonical instruction content - all exports derive from this
//
// Three tiers:
//   1. Rules-only (no KB references) — default when kb.md is not generated
//   2. KB-aware (references kb.md) — used when generateKb is enabled
//   3. KB-custom (embeds KB facts) — used when KB exists but no LLM available
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the canonical instruction content.
 *
 * When `kbAvailable` is true, the content references the `kb.md` knowledge
 * base file. When false, it provides standalone rules and guidelines only.
 *
 * All assistant-specific exports are derived from this single source.
 */
export function generateCanonicalContentForMode(
  mode: InstructionsMode,
  kbAvailable = false,
): string {
  if (mode === 'permissive') {
    return kbAvailable
      ? generateCanonicalContentPermissiveKB()
      : generateCanonicalContentPermissive();
  }
  return kbAvailable ? generateCanonicalContentSafeKB() : generateCanonicalContentSafe();
}

// ─────────────────────────────────────────────────────────────────────────────
// KB-custom content — embeds extracted KB facts directly into instructions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a project-customized AGENTS.md using actual KB content.
 *
 * Extracts key architectural facts (hubs, entry points, conventions, etc.)
 * from the KB string and embeds them directly into the instructions file.
 * This produces a useful, project-specific result even without an LLM.
 *
 * Falls back to the generic KB-aware template if no meaningful sections
 * can be extracted.
 */
export function generateKbCustomContent(
  kbContent: string,
  mode: InstructionsMode = 'safe',
): string {
  const hubs = extractKbSection(kbContent, 'High-Risk Architectural Hubs');
  const entryPoints = extractKbSection(kbContent, 'Entry Points');
  const layout = extractKbSection(kbContent, 'Directory Layout');
  const conventions = extractKbSection(kbContent, 'Conventions');
  const integrations = extractKbSection(kbContent, 'External Integrations');
  const circularDeps = extractKbSection(kbContent, 'Circular Dependencies');

  const hasContent = hubs || entryPoints || layout || conventions || integrations;
  if (!hasContent) {
    return generateCanonicalContentForMode(mode, true);
  }

  if (mode === 'permissive') {
    return buildPermissiveKbCustom({ hubs, entryPoints, layout, conventions, integrations, circularDeps });
  }
  return buildSafeKbCustom({ hubs, entryPoints, layout, conventions, integrations, circularDeps });
}

interface KbSections {
  hubs: string | undefined;
  entryPoints: string | undefined;
  layout: string | undefined;
  conventions: string | undefined;
  integrations: string | undefined;
  circularDeps: string | undefined;
}

/**
 * Extract a `## Heading` section from KB content.
 * Handles optional emoji prefixes (e.g. `## ⚠️ High-Risk Architectural Hubs`).
 * Returns the section body (without the heading or italic description line), or undefined.
 */
function extractKbSection(kb: string, heading: string): string | undefined {
  // Match "## " + optional non-word characters (emoji) + heading text
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `^##\\s+(?:[^\\w\\s]+\\s+)?${escaped}\\s*$`,
    'mi',
  );
  const match = pattern.exec(kb);
  if (!match) return undefined;

  const start = match.index + match[0].length;
  const rest = kb.slice(start);

  // Stop at next ## heading, --- separator, or # top-level heading
  const endMatch = /^(?:#{1,2}\s|---\s*$)/m.exec(rest);
  const section = endMatch ? rest.slice(0, endMatch.index) : rest;

  // Remove leading italic description lines (e.g. _Files with many dependents..._)
  const cleaned = section
    .replace(/^\s*_[^_]+_\s*\n?/gm, '')
    .trim();

  return cleaned || undefined;
}

/**
 * Build a clean, compact AGENTS.md matching the sweagent_bench format.
 * Used for both safe and permissive modes — same structure, no fluff.
 */
function buildSafeKbCustom(s: KbSections): string {
  return buildCleanAgentsMd(s);
}

function buildPermissiveKbCustom(s: KbSections): string {
  return buildCleanAgentsMd(s);
}

function buildCleanAgentsMd(s: KbSections): string {
  const parts: string[] = [];

  parts.push(`## Operating Mode
- Verify repo priors with targeted reads before editing.
- Localize, trace deps, then apply minimal scoped edit.
- Run the smallest relevant test first, broaden only if needed.`);

  parts.push(`## Procedural Standards
- Reproduce the failure before editing when possible.
- Read target files and nearby callers before patching.
- Keep first patch minimal; inspect call sites if public API changes.
- Require evidence from file reads or command output — no fabricated edits.
- Patches must be syntactically complete; remove unused imports.`);

  // ── Repo Priors (compact, from KB) ─────────────────────
  const repoParts: string[] = [];

  if (s.hubs) {
    // Table format: | Rank | File | Imports | Imported By | Risk |
    const hubLines = s.hubs.split('\n')
      .filter((l) => l.startsWith('|') && !l.includes('File') && !l.includes('---') && !l.includes('Rank'))
      .slice(0, 2)
      .map((l) => {
        const cells = l.split('|').map((c) => c.trim()).filter(Boolean);
        // cells[0]=Rank, cells[1]=File (backtick-wrapped), cells[2]=Imports, cells[3]=ImportedBy
        if (cells.length >= 4) {
          const file = cells[1].replace(/`/g, '');
          const importedBy = cells[3];
          return `- \`${file}\` — hub (${importedBy} importers).`;
        }
        return '';
      })
      .filter(Boolean);
    if (hubLines.length > 0) {
      repoParts.push(`### High-Impact Hubs\n${hubLines.join('\n')}`);
    }
  }

  if (s.entryPoints) {
    // Table format: | File | Kind | Confidence | Evidence |
    const epLines = s.entryPoints.split('\n')
      .filter((l) => l.startsWith('|') && !l.includes('File') && !l.includes('---') && !l.includes('Kind'))
      .slice(0, 2)
      .map((l) => {
        const cells = l.split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          const file = cells[0].replace(/`/g, '').replace(/🟢|🟡|🟠/g, '').trim();
          const kind = cells[1].replace(/🟢|🟡|🟠/g, '').trim();
          return `- \`${file}\` (${kind}).`;
        }
        return '';
      })
      .filter(Boolean);
    if (epLines.length > 0) {
      repoParts.push(`### Entry Points\n${epLines.join('\n')}`);
    }
  }

  if (s.conventions) {
    const convLines = s.conventions.split('\n')
      .filter((l) => l.trim().startsWith('- '))
      .slice(0, 3);
    if (convLines.length > 0) {
      repoParts.push(`### Conventions\n${convLines.join('\n')}`);
    }
  }

  if (s.integrations) {
    const intLines = s.integrations.split('\n')
      .filter((l) => l.trim().startsWith('- '))
      .slice(0, 2);
    if (intLines.length > 0) {
      repoParts.push(`### Integration Risk\n${intLines.join('\n')}`);
    }
  }

  if (repoParts.length > 0) {
    parts.push(`## Repo Priors\n${repoParts.join('\n\n')}`);
  }

  parts.push(`## Guardrails
- No speculative changes or broad refactors without evidence.
- Every touched file must tie to the diagnosed path.`);

  return parts.join('\n\n').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules-only content (no KB references)
// ─────────────────────────────────────────────────────────────────────────────

export function generateCanonicalContentSafe(): string {
  return `## Operating Mode
- Verify repo priors with targeted reads before editing.
- Localize, trace deps, then apply minimal scoped edit.
- Run the smallest relevant test first, broaden only if needed.

## Procedural Standards
- Reproduce the failure before editing when possible.
- Read target files and nearby callers before patching.
- Keep first patch minimal; inspect call sites if public API changes.
- Require evidence from file reads or command output — no fabricated edits.
- Patches must be syntactically complete; remove unused imports.

## Guardrails
- No speculative changes or broad refactors without evidence.
- Every touched file must tie to the diagnosed path.`.trim();
}

export function generateCanonicalContentPermissive(): string {
  return generateCanonicalContentSafe();
}

// ─────────────────────────────────────────────────────────────────────────────
// KB-aware content (references kb.md)
// ─────────────────────────────────────────────────────────────────────────────

export function generateCanonicalContentSafeKB(): string {
  return generateCanonicalContentSafe();
}

// Old verbose KB content removed — clean format only

function _deletedOldSafeKB(): string {
  return `## Old content removed

**Aspect Code** is a static-analysis tool that generates a Knowledge Base (KB) for your codebase. The KB is in \`kb.md\` at the workspace root and contains these sections:

| Section | Purpose |
|---------|---------|
| **Architecture** | **Read first.** High-risk hubs, directory layout, entry points—the "Do Not Break" zones |
| **Map** | Data models with signatures, symbol index, naming conventions |
| **Context** | Module clusters (co-edited files), external integrations, data flow paths |

**Key architectural intelligence:**
- **High-Risk Hubs** in the Architecture section: Files with many dependents—changes here ripple widely
- **Entry Points** in the Architecture section: HTTP handlers, CLI commands, event listeners
- **External Integrations** in the Context section: API clients, database connections, message queues
- **Data Models** in the Map section: ORM models, dataclasses, TypeScript interfaces with signatures

Read the relevant sections of \`kb.md\` **before** making multi-file changes.

## Golden Rules

1. **Read the KB as a map, not a checklist.** Use \`kb.md\` to understand architecture, not as a to-do list.
2. **Read before you write.** Open the relevant KB sections before multi-file edits.
3. **Check architecture first.** Review the Architecture section to understand high-risk zones before coding.
4. **Think step-by-step.** Break complex tasks into smaller steps; reason through each before coding.
5. **Prefer minimal, local changes.** Small patches are safer than large refactors, especially in hub files.
6. **Never truncate code.** Don't use placeholders like \`// ...rest\` or \`# existing code...\`. Provide complete implementations.
7. **Don't touch tests, migrations, or third-party code** unless the user explicitly asks you to.
8. **Never remove referenced logic.** If a symbol appears in the Map section, check all callers before deleting.
9. **Understand blast radius.** Use the Context and Map sections to trace relationships before refactors.
10. **Follow naming patterns in the Map section.** Match the project's existing naming patterns and import styles.
11. **When unsure, go small.** Propose a minimal, reversible change instead of a sweeping refactor.

## Recommended Workflow

1. **Understand the task.** Parse requirements; note which files or endpoints are involved.
2. **Check architecture.** Open \`kb.md\` → review the Architecture section for high-risk hubs and entry points.
3. **Find relevant code.** Review the Map section → locate data models, symbols, and naming conventions.
4. **Understand relationships.** Review the Context section → see module clusters (co-edited files) and integrations.
5. **Trace impact.** Review "Called by" in the Map section to gauge the blast radius of changes.
6. **Gather evidence.** If behavior is unclear, add targeted logging or traces to confirm assumptions.
7. **Make minimal edits.** Implement the smallest change that solves the task; run tests.

## When Changing Code

- **Read the COMPLETE file** before modifying it. Preserve all existing exports/functions.
- **Add, don't reorganize.** Unless the task says "refactor", avoid moving code around.
- **Check high-risk hubs** (Architecture section) before editing widely-imported files.
- **Avoid renaming** widely-used symbols listed in the Map section without updating all callers.
- **No new cycles.** Before adding an import, verify it won't create a circular dependency (Architecture section).
- **Match conventions.** Follow naming patterns shown in the Map section (naming, imports, frameworks).
- **Check module clusters** (Context section) to understand which files are commonly edited together.
- **Prefer small, localized changes** in the most relevant app module identified by the KB.
- **Use the Architecture, Map, and Context sections** to locate the smallest, safest place to make a change.

## How to Use kb.md

| Section | When to Open | What to Look For |
|---------|--------------|------------------|
| Architecture | **First, always** | High-risk hubs, directory layout, entry points, circular dependencies |
| Map | Before modifying a function | Data models with signatures, symbol index, naming conventions |
| Context | Before architectural changes | Module clusters, external integrations, data flow patterns |

### Quick Reference

- **High-risk hubs** → Files with 3+ dependents listed in the Architecture section—changes ripple widely
- **Entry points** → HTTP handlers, CLI commands, event listeners in the Architecture section
- **External integrations** → HTTP clients, DB connections, message queues in the Context section
- **Data models** → ORM models, dataclasses, interfaces with signatures in the Map section
- **Module clusters** → Files commonly edited together in the Context section
- **High-impact symbol** → 5+ callers in the Map section "Called by" column

## When Things Go Wrong

If you encounter repeated errors or unexpected behavior:

1. **Use git** to see what changed: \`git diff\`, \`git status\`
2. **Restore lost code** with \`git checkout -- <file>\` if needed
3. **Re-read the complete file** before making more changes
4. **Trace data flows** using the Context section to understand execution paths
5. **Run actual tests** to verify behavior before assuming something works
6. **Check module clusters** in the Context section for related files that may need updates

## General Guidelines

- **Read kb.md first.** Before making changes, consult the relevant knowledge base sections.
- **Start with the Architecture section.** Understand high-risk hubs and entry points.
- **Check hub modules.** Know which files have many dependents before editing.
- **Follow Map section conventions.** Match existing naming patterns and coding styles exactly.
- **Minimal changes.** Make the smallest change that solves the problem correctly.
- **Acknowledge risk.** If editing a hub module or high-impact file, note the elevated risk.

## Section Headers (Pattern-Matching)

**Architecture:** \`## High-Risk Architectural Hubs\`, \`## Directory Layout\`, \`## Entry Points\`, \`## Circular Dependencies\`
**Map:** \`## Data Models\` (with signatures), \`## Symbol Index\` (with Called By), \`## Conventions\`
**Context:** \`## Module Clusters\` (co-edited files), \`## External Integrations\`, \`## Critical Flows\`
`.trim();
}
void _deletedOldSafeKB;

// ─────────────────────────────────────────────────────────────────────────────
// KB seed content — structured seed for probe-and-refine tuning
// ─────────────────────────────────────────────────────────────────────────────

/** Character budget for probe-and-refine seed. */
const KB_SEED_CHAR_BUDGET = 8000;

/**
 * Generate a structured KB seed for the probe-and-refine loop.
 *
 * Produces the paper's format: Operating Mode + Procedural Standards +
 * Repo Priors (from KB) + Guardrails — all within 3000 chars.
 *
 * This is the initial AGENTS.md that the iterative refinement process
 * will improve through synthetic probes and diagnosis.
 */
export function generateKbSeedContent(
  kbContent: string,
  projectName = 'Project',
): string {
  const parts: string[] = [];

  parts.push(`# AGENTS.md — ${projectName}`);

  // ── Operating Mode (always present) ──────────────────────
  parts.push(`## Operating Mode
- Verify repo priors with targeted reads before editing.
- Localize, trace deps, then apply minimal scoped edit.
- Run the smallest relevant test first, broaden only if needed.`);

  // ── Procedural Standards (always present) ────────────────
  parts.push(`## Procedural Standards
- Reproduce the failure before editing when possible.
- Read target files and nearby callers before patching.
- Keep first patch minimal; inspect call sites if public API changes.
- Require evidence from file reads or command output — no fabricated edits.
- Patches must be syntactically complete; remove unused imports.`);

  // ── Repo Priors (from KB) ────────────────────────────────
  const repoParts: string[] = [];

  const hubs = extractKbSeedSection(kbContent, 'High-Risk Architectural Hubs', 5);
  if (hubs) {
    repoParts.push(`### High-Impact Hubs\n${hubs}`);
  }

  const entryPoints = extractKbSeedSection(kbContent, 'Entry Points', 5);
  if (entryPoints) {
    repoParts.push(`### Entry Points\n${entryPoints}`);
  }

  const validation = extractValidationSection(kbContent);
  if (validation) {
    repoParts.push(`### Validation\n${validation}`);
  }

  const integrations = extractKbSeedSection(kbContent, 'External Integrations', 4);
  if (integrations) {
    repoParts.push(`### Integration Risk\n${integrations}`);
  }

  const conventions = extractKbSeedSection(kbContent, 'Conventions', 5);
  if (conventions) {
    repoParts.push(`### Conventions\n${conventions}`);
  }

  if (repoParts.length > 0) {
    parts.push(`## Repo Priors\n${repoParts.join('\n\n')}`);
  }

  // ── Setup (always present) ───────────────────────────────
  parts.push(`## Setup
- If Aspect Code is not running, start it: \`aspectcode --background\`
- This keeps AGENTS.md and scoped rules up to date as you work.`);

  // ── Error Tracking ──────────────────────────────────────
  parts.push(`## Error Tracking
- When you encounter a recurring error pattern, log it in \`.claude/errors.md\`.
- Format: \`## [date] [file] [error summary]\` with a brief note on what caused it.
- Check \`.claude/errors.md\` before making changes to files that have had recent errors.`);

  // ── Guardrails (always present) ──────────────────────────
  parts.push(`## Guardrails
- No speculative changes or broad refactors without evidence.
- Every touched file must tie to the diagnosed path.`);

  let result = parts.join('\n\n') + '\n';

  // Enforce budget — trim repo-specific content if over
  if (result.length > KB_SEED_CHAR_BUDGET) {
    result = result.slice(0, KB_SEED_CHAR_BUDGET - 20) + '\n[... truncated]\n';
  }

  return result;
}

/**
 * Extract top N items from a KB section for the seed.
 * Returns formatted bullet list or undefined.
 */
function extractKbSeedSection(kb: string, heading: string, maxItems: number): string | undefined {
  const section = extractKbSection(kb, heading);
  if (!section) return undefined;

  const bullets: string[] = [];

  // Try bullet items first
  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) {
      // Strip emojis from bullet text
      bullets.push(trimmed.replace(/🟢|🟡|🟠|🔴|⚠️/g, '').trim());
    }
  }

  // Try table rows if no bullets found
  if (bullets.length === 0) {
    for (const line of section.split('\n')) {
      if (!line.startsWith('|') || line.includes('---') || line.includes('File') || line.includes('Rank')) continue;
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 4) {
        // Table: | Rank | File | Imports | ImportedBy | Risk |
        const file = cells[1].replace(/`/g, '');
        const importedBy = cells[3];
        bullets.push(`- \`${file}\` — hub (${importedBy} importers).`);
      } else if (cells.length >= 2) {
        // Simpler table: | File | Kind | ...
        const file = cells[0].replace(/`/g, '').replace(/🟢|🟡|🟠|🔴/g, '').trim();
        const kind = cells.length >= 2 ? cells[1].replace(/🟢|🟡|🟠|🔴/g, '').trim() : '';
        bullets.push(kind ? `- \`${file}\` (${kind}).` : `- \`${file}\``);
      }
    }
  }

  if (bullets.length === 0) return undefined;
  return bullets.slice(0, maxItems).join('\n');
}

/**
 * Extract validation/testing info from KB.
 * Combines test command, test directories, and fixture info.
 */
function extractValidationSection(kb: string): string | undefined {
  const bullets: string[] = [];

  // Look for test command mentions
  const testCmdMatch = kb.match(/(?:test\s+command|run\s+tests?):\s*`([^`]+)`/i);
  if (testCmdMatch) {
    bullets.push(`- Test command: \`${testCmdMatch[1]}\``);
  }

  // Look for test directory mentions
  const testDirMatch = kb.match(/(?:test\s+(?:dir(?:ectory|ectories)?|folder)):\s*`([^`]+)`/i);
  if (testDirMatch) {
    bullets.push(`- Test directory: \`${testDirMatch[1]}\``);
  }

  // Look for test patterns in directory layout
  const testPaths = kb.match(/`(tests?\/[^`]*|__tests__\/[^`]*|spec\/[^`]*)`/g);
  if (testPaths && bullets.length === 0) {
    const unique = [...new Set(testPaths.map((p) => p.replace(/`/g, '')))].slice(0, 2);
    for (const p of unique) {
      bullets.push(`- Test path: \`${p}\``);
    }
  }

  return bullets.length > 0 ? bullets.join('\n') : undefined;
}

export function generateCanonicalContentPermissiveKB(): string {
  return generateCanonicalContentSafe();
}

function _oldGenerateCanonicalContentPermissiveKB(): string {
  return `## Aspect Code Knowledge Base

**Aspect Code** is a static-analysis tool that generates a Knowledge Base (KB) for your codebase. The KB is in \`kb.md\` at the workspace root and contains these sections:

| Section | Purpose |
|---------|---------|
| **Architecture** | Hubs, directory layout, entry points |
| **Map** | Data models with signatures, symbol index, naming conventions |
| **Context** | Module clusters (co-edited files), external integrations, data flow paths |

Use the Knowledge Base (KB) as orientation and ground truth for architecture and dependencies—not as a constraint.

### Operating Rules (KB-First, Not KB-Locked)

- Read \`kb.md\` before large edits; use it to understand boundaries, flows, and ownership
- Treat the KB as the source of "what connects to what" (entry points, hubs, key types)
- If your change conflicts with the KB, either:
  - update the code in a way that keeps the KB's intent valid, or
  - explicitly state the mismatch and proceed with a coherent new structure

### You May (Explicitly Allowed)

- Refactor for clarity: extract functions, split files, consolidate duplicates
- Reorganize modules/folders when it improves cohesion and discoverability
- Touch multiple files when the change is conceptually one improvement
- Change public/internal APIs when it simplifies the design (with follow-through updates)
- Edit high-risk hubs when needed—do it deliberately, with dependency awareness
- Rename symbols for consistency (types, functions, modules) and update references

### You Should

- Explain the new structure in terms of the existing architecture
- Keep changes "conceptually tight": one goal, end-to-end, fully wired
- Update call sites and imports immediately when you move/rename things
- Prefer simplification over novelty; remove unnecessary layers when justified
- Validate that referenced symbols still exist and are still reachable from call sites

### Avoid

- Deleting or renaming referenced symbols without updating all usages
- Unnecessary scope creep (adding features unrelated to the request)
- Blind rewrites that ignore \`kb.md\`'s dependency map and entry points
- "Rebuild everything" refactors when a targeted restructure achieves the goal
- Cosmetic churn that obscures meaningful changes

## Suggested Workflow

1. Skim the relevant sections of \`kb.md\` for orientation.
2. Implement the change end-to-end.
3. Run tests / build.
`.trim();
}
void _oldGenerateCanonicalContentPermissiveKB;
