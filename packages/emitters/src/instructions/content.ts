import type { InstructionsMode } from '../emitter';

// ─────────────────────────────────────────────────────────────────────────────
// Canonical instruction content - all exports derive from this
//
// Two tiers:
//   1. Rules-only (no KB references) — default when kb.md is not generated
//   2. KB-aware (references kb.md) — used when generateKb is enabled
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
// Rules-only content (no KB references)
// ─────────────────────────────────────────────────────────────────────────────

export function generateCanonicalContentSafe(): string {
  return `## Aspect Code — Coding Guidelines

**Aspect Code** provides coding guidelines to help you make safer, more informed code changes.

## Golden Rules

1. **Read before you write.** Open and read the relevant files before multi-file edits.
2. **Think step-by-step.** Break complex tasks into smaller steps; reason through each before coding.
3. **Prefer minimal, local changes.** Small patches are safer than large refactors, especially in widely-imported files.
4. **Never truncate code.** Don't use placeholders like \`// ...rest\` or \`# existing code...\`. Provide complete implementations.
5. **Don't touch tests, migrations, or third-party code** unless the user explicitly asks you to.
6. **Never remove referenced logic.** Check all callers before deleting a function, class, or symbol.
7. **Understand blast radius.** Trace relationships and dependents before refactoring.
8. **Follow existing naming patterns.** Match the project's existing naming patterns and import styles.
9. **When unsure, go small.** Propose a minimal, reversible change instead of a sweeping refactor.

## Recommended Workflow

1. **Understand the task.** Parse requirements; note which files or endpoints are involved.
2. **Find relevant code.** Locate data models, symbols, and naming conventions.
3. **Understand relationships.** See which files are commonly edited together and how they connect.
4. **Trace impact.** Review callers and dependents to gauge the blast radius of changes.
5. **Gather evidence.** If behavior is unclear, add targeted logging or traces to confirm assumptions.
6. **Make minimal edits.** Implement the smallest change that solves the task; run tests.

## When Changing Code

- **Read the COMPLETE file** before modifying it. Preserve all existing exports/functions.
- **Add, don't reorganize.** Unless the task says "refactor", avoid moving code around.
- **Check widely-imported files** before editing them — changes ripple to all dependents.
- **Avoid renaming** widely-used symbols without updating all callers.
- **No new dependency cycles.** Before adding an import, verify it won't create a circular dependency.
- **Match conventions.** Follow existing naming patterns (naming, imports, frameworks).
- **Prefer small, localized changes** in the most relevant module.

## When Things Go Wrong

If you encounter repeated errors or unexpected behavior:

1. **Use git** to see what changed: \`git diff\`, \`git status\`
2. **Restore lost code** with \`git checkout -- <file>\` if needed
3. **Re-read the complete file** before making more changes
4. **Trace data flows** to understand execution paths
5. **Run actual tests** to verify behavior before assuming something works

## General Guidelines

- **Start with the most relevant file.** Understand the area before changing it.
- **Check widely-imported modules.** Know which files have many dependents before editing.
- **Follow existing conventions.** Match existing naming patterns and coding styles exactly.
- **Minimal changes.** Make the smallest change that solves the problem correctly.
- **Acknowledge risk.** If editing a widely-imported file, note the elevated risk.
`.trim();
}

export function generateCanonicalContentPermissive(): string {
  return `## Aspect Code — Coding Guidelines

**Aspect Code** provides coding guidelines to help you make informed code changes.

Use these guidelines as orientation — not as constraints.

### Operating Rules (Pragmatic, Not Rigid)

- Read relevant code before large edits; understand boundaries, flows, and ownership
- If your change creates a conflict with existing structure, either:
  - update the code in a way that keeps the existing intent valid, or
  - explicitly state the mismatch and proceed with a coherent new structure

### You May (Explicitly Allowed)

- Refactor for clarity: extract functions, split files, consolidate duplicates
- Reorganize modules/folders when it improves cohesion and discoverability
- Touch multiple files when the change is conceptually one improvement
- Change public/internal APIs when it simplifies the design (with follow-through updates)
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
- Blind rewrites that ignore the project's dependency structure and entry points
- "Rebuild everything" refactors when a targeted restructure achieves the goal
- Cosmetic churn that obscures meaningful changes

## Suggested Workflow

1. Read the relevant code for orientation.
2. Implement the change end-to-end.
3. Run tests / build.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// KB-aware content (references kb.md)
// ─────────────────────────────────────────────────────────────────────────────

export function generateCanonicalContentSafeKB(): string {
  return `## Aspect Code Knowledge Base

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

export function generateCanonicalContentPermissiveKB(): string {
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


