import type { InstructionsMode } from '../emitter';

// ─────────────────────────────────────────────────────────────────────────────
// Canonical instruction content - all exports derive from this
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the canonical instruction content.
 * All assistant-specific exports are derived from this single source.
 */
export function generateCanonicalContentForMode(mode: InstructionsMode): string {
  if (mode === 'permissive') {
    return generateCanonicalContentPermissive();
  }
  return generateCanonicalContentSafe();
}

export function generateCanonicalContentSafe(): string {
  return `## Aspect Code Knowledge Base

**Aspect Code** is a static-analysis extension that generates a Knowledge Base (KB) for your codebase. The KB lives in \`.aspect/\` and contains these files:

| File | Purpose |
|------|---------|
| \`architecture.md\` | **Read first.** High-risk hubs, directory layout, entry points—the "Do Not Break" zones |
| \`map.md\` | Data models with signatures, symbol index, naming conventions |
| \`context.md\` | Module clusters (co-edited files), external integrations, data flow paths |

**Key architectural intelligence:**
- **High-Risk Hubs** in \`architecture.md\`: Files with many dependents—changes here ripple widely
- **Entry Points** in \`architecture.md\`: HTTP handlers, CLI commands, event listeners
- **External Integrations** in \`context.md\`: API clients, database connections, message queues
- **Data Models** in \`map.md\`: ORM models, dataclasses, TypeScript interfaces with signatures

Read the relevant KB files **before** making multi-file changes.

Reference KB files at: \`.aspect/<file>.md\`

## Golden Rules

1. **Read the KB as a map, not a checklist.** Use \`.aspect/*.md\` files to understand architecture, not as a to-do list.
2. **Read before you write.** Open the relevant KB files before multi-file edits.
3. **Check architecture first.** Review \`architecture.md\` to understand high-risk zones before coding.
4. **Think step-by-step.** Break complex tasks into smaller steps; reason through each before coding.
5. **Prefer minimal, local changes.** Small patches are safer than large refactors, especially in hub files.
6. **Never truncate code.** Don't use placeholders like \`// ...rest\` or \`# existing code...\`. Provide complete implementations.
7. **Don't touch tests, migrations, or third-party code** unless the user explicitly asks you to.
8. **Never remove referenced logic.** If a symbol appears in \`map.md\`, check all callers before deleting.
9. **Understand blast radius.** Use \`context.md\` and \`map.md\` to trace relationships before refactors.
10. **Follow naming patterns in map.md.** Match the project's existing naming patterns and import styles.
11. **When unsure, go small.** Propose a minimal, reversible change instead of a sweeping refactor.

## Recommended Workflow

1. **Understand the task.** Parse requirements; note which files or endpoints are involved.
2. **Check architecture.** Open \`architecture.md\` → identify high-risk hubs and entry points.
3. **Find relevant code.** Open \`map.md\` → locate data models, symbols, and naming conventions.
4. **Understand relationships.** Open \`context.md\` → see module clusters (co-edited files) and integrations.
5. **Trace impact.** Review "Called by" in \`map.md\` to gauge the blast radius of changes.
6. **Gather evidence.** If behavior is unclear, add targeted logging or traces to confirm assumptions.
7. **Make minimal edits.** Implement the smallest change that solves the task; run tests.

## When Changing Code

- **Read the COMPLETE file** before modifying it. Preserve all existing exports/functions.
- **Add, don't reorganize.** Unless the task says "refactor", avoid moving code around.
- **Check high-risk hubs** (\`architecture.md\`) before editing widely-imported files.
- **Avoid renaming** widely-used symbols listed in \`map.md\` without updating all callers.
- **No new cycles.** Before adding an import, verify it won't create a circular dependency (\`architecture.md\`).
- **Match conventions.** Follow naming patterns shown in \`map.md\` (naming, imports, frameworks).
- **Check module clusters** (\`context.md\`) to understand which files are commonly edited together.
- **Prefer small, localized changes** in the most relevant app module identified by the KB.
- **Use \`architecture.md\`, \`map.md\`, and \`context.md\`** to locate the smallest, safest place to make a change.

## How to Use the KB Files

| File | When to Open | What to Look For |
|------|--------------|------------------|
| \`architecture.md\` | **First, always** | High-risk hubs, directory layout, entry points, circular dependencies |
| \`map.md\` | Before modifying a function | Data models with signatures, symbol index, naming conventions |
| \`context.md\` | Before architectural changes | Module clusters, external integrations, data flow patterns |

### Quick Reference

- **High-risk hubs** → Files with 3+ dependents listed in \`architecture.md\`—changes ripple widely
- **Entry points** → HTTP handlers, CLI commands, event listeners in \`architecture.md\`
- **External integrations** → HTTP clients, DB connections, message queues in \`context.md\`
- **Data models** → ORM models, dataclasses, interfaces with signatures in \`map.md\`
- **Module clusters** → Files commonly edited together in \`context.md\`
- **High-impact symbol** → 5+ callers in \`map.md\` "Called by" column

## When Things Go Wrong

If you encounter repeated errors or unexpected behavior:

1. **Use git** to see what changed: \`git diff\`, \`git status\`
2. **Restore lost code** with \`git checkout -- <file>\` if needed
3. **Re-read the complete file** before making more changes
4. **Trace data flows** using \`context.md\` to understand execution paths
5. **Run actual tests** to verify behavior before assuming something works
6. **Check module clusters** in \`context.md\` for related files that may need updates

## General Guidelines

- **Read KB files first.** Before making changes, consult the relevant knowledge base files.
- **Start with architecture.md.** Understand high-risk hubs and entry points.
- **Check hub modules.** Know which files have many dependents before editing.
- **Follow map.md conventions.** Match existing naming patterns and coding styles exactly.
- **Minimal changes.** Make the smallest change that solves the problem correctly.
- **Acknowledge risk.** If editing a hub module or high-impact file, note the elevated risk.

## KB File Reference

| File | Purpose |
|------|---------|
| \`architecture.md\` | High-risk hubs, project layout, entry points, circular dependencies |
| \`map.md\` | Data models with signatures, symbol index, naming conventions |
| \`context.md\` | Module clusters, external integrations, data flow patterns |

## Section Headers (Pattern-Matching)

**\`architecture.md\`:** \`## High-Risk Architectural Hubs\`, \`## Directory Layout\`, \`## Entry Points\`, \`## Circular Dependencies\`
**\`map.md\`:** \`## Data Models\` (with signatures), \`## Symbol Index\` (with Called By), \`## Conventions\`
**\`context.md\`:** \`## Module Clusters\` (co-edited files), \`## External Integrations\`, \`## Critical Flows\`
`.trim();
}

export function generateCanonicalContentPermissive(): string {
  return `## Aspect Code Knowledge Base

**Aspect Code** is a static-analysis extension that generates a Knowledge Base (KB) for your codebase. The KB lives in \`.aspect/\` and contains these files:

| File | Purpose |
|------|---------|
| \`architecture.md\` | Hubs, directory layout, entry points |
| \`map.md\` | Data models with signatures, symbol index, naming conventions |
| \`context.md\` | Module clusters (co-edited files), external integrations, data flow paths |

Reference KB files at: \`.aspect/<file>.md\`

Use the Knowledge Base (KB) as orientation and ground truth for architecture and dependencies—not as a constraint.

### Operating Rules (KB-First, Not KB-Locked)

- Read the KB before large edits; use it to understand boundaries, flows, and ownership
- Treat the KB as the source of “what connects to what” (entry points, hubs, key types)
- If your change conflicts with the KB, either:
  - update the code in a way that keeps the KB’s intent valid, or
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
- Keep changes “conceptually tight”: one goal, end-to-end, fully wired
- Update call sites and imports immediately when you move/rename things
- Prefer simplification over novelty; remove unnecessary layers when justified
- Validate that referenced symbols still exist and are still reachable from call sites

### Avoid

- Deleting or renaming referenced symbols without updating all usages
- Unnecessary scope creep (adding features unrelated to the request)
- Blind rewrites that ignore the KB’s dependency map and entry points
- “Rebuild everything” refactors when a targeted restructure achieves the goal
- Cosmetic churn that obscures meaningful changes

## Suggested Workflow

1. Skim the relevant KB files for orientation.
2. Implement the change end-to-end.
3. Run tests / build.
`.trim();
}

export function generateCopilotContent(mode: InstructionsMode): string {
  if (mode === 'permissive') {
    return generateCanonicalContentForMode(mode);
  }
  return `${generateCanonicalContentForMode(mode)}

---

## Copilot Tips

- Use \`@.aspect/architecture.md\` to include KB context in chat
- Ask "Show me only the lines to change" to keep edits minimal
- Reference \`@.aspect/map.md\` when asking about naming conventions
`.trim();
}

export function generateCursorContent(mode: InstructionsMode): string {
  if (mode === 'permissive') {
    return `---
description: Aspect Code KB integration - read before multi-file edits
globs: 
alwaysApply: true
---

${generateCanonicalContentForMode(mode)}
`.trim();
  }
  return `---
description: Aspect Code KB integration - read before multi-file edits
globs: 
alwaysApply: true
---

${generateCanonicalContentForMode(mode)}


---

## Cursor Tips

- Read KB files before using Composer for multi-file edits
- Check \`architecture.md\` for hub files before agent-mode refactors
- Use "Used In (files)" in \`map.md\` to find all usages before renaming
`.trim();
}

export function generateClaudeContent(mode: InstructionsMode): string {
  if (mode === 'permissive') {
    return generateCanonicalContentForMode(mode);
  }
  return `${generateCanonicalContentForMode(mode)}

---

## Claude Tips

- Summarize what you found in KB files before proposing changes
- State "This file has N dependents" when editing hubs
- Use \`@.aspect/architecture.md\` to reference KB in chat
`.trim();
}
