/**
 * MemoryMap — compact filesystem-style visualization of managed files.
 *
 * Shows AGENTS.md, scoped rule files, preferences, dream state,
 * and cloud status in a tree layout with relative timestamps.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from './theme';
import type { ManagedFile } from './store';

// ── Types ────────────────────────────────────────────────────

interface TreeEntry {
  label: string;
  annotation: string;
  updatedAt: number;
  indent: number;
  isLast: boolean;
  /** Add a blank line before this entry for visual grouping. */
  spaceBefore?: boolean;
}

interface MemoryMapProps {
  files: ManagedFile[];
  dreaming: boolean;
  userEmail: string;
}

// ── Relative time formatting ─────────────────────────────────

function relativeTime(epochMs: number): string {
  if (epochMs === 0) return '';
  const diffS = Math.floor((Date.now() - epochMs) / 1000);
  if (diffS < 5) return 'just now';
  if (diffS < 60) return `${diffS}s ago`;
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  return `${diffH}h ago`;
}

function isRecent(epochMs: number): boolean {
  return epochMs > 0 && Date.now() - epochMs < 30_000;
}

// ── Flatten files into tree entries ──────────────────────────

/** Build tree entries from a flat list of files sharing the same scope. */
function buildScopeEntries(
  files: ManagedFile[],
  /** Total top-level items including cloud placeholder (for isLast calculation). */
  totalTopItems: number,
  /** Starting item index (for isLast calculation across scopes). */
  startIdx: number,
): { entries: TreeEntry[]; nextIdx: number } {
  // Group by top-level directory
  const groups = new Map<string, ManagedFile[]>();
  const topLevel: ManagedFile[] = [];

  for (const file of files) {
    const firstSlash = file.path.indexOf('/');
    if (firstSlash === -1) {
      topLevel.push(file);
    } else {
      const dir = file.path.slice(0, firstSlash);
      const existing = groups.get(dir) ?? [];
      existing.push(file);
      groups.set(dir, existing);
    }
  }

  const entries: TreeEntry[] = [];

  // Sort: AGENTS.md first, then dirs alphabetically, then .aspectcode last
  const order = (p: string) => {
    if (p === 'AGENTS.md') return 0;
    if (p.startsWith('.aspectcode')) return 3;
    return 1;
  };

  const sortedTopKeys = [...new Set([
    ...topLevel.map((f) => f.path),
    ...groups.keys(),
  ])].sort((a, b) => order(a) - order(b) || a.localeCompare(b));

  let itemIdx = startIdx;

  for (const key of sortedTopKeys) {
    itemIdx++;
    const isLastTop = itemIdx === totalTopItems;

    // Check if this is a top-level file
    const topFile = topLevel.find((f) => f.path === key);
    if (topFile) {
      entries.push({
        label: topFile.path,
        annotation: topFile.annotation,
        updatedAt: topFile.updatedAt,
        indent: 0,
        isLast: isLastTop,
      });
      continue;
    }

    // It's a directory group
    const dirFiles = groups.get(key) ?? [];
    entries.push({
      label: key + '/',
      annotation: '',
      updatedAt: 0,
      indent: 0,
      isLast: isLastTop,
    });

    // Sub-group by second-level directory
    const subGroups = new Map<string, ManagedFile[]>();
    const directChildren: ManagedFile[] = [];

    for (const f of dirFiles) {
      const rest = f.path.slice(key.length + 1); // after "dir/"
      const nextSlash = rest.indexOf('/');
      if (nextSlash === -1) {
        directChildren.push(f);
      } else {
        const subDir = rest.slice(0, nextSlash);
        const existing = subGroups.get(subDir) ?? [];
        existing.push(f);
        subGroups.set(subDir, existing);
      }
    }

    const childCount = directChildren.length + subGroups.size;
    let childIdx = 0;

    // Direct children first
    for (const child of directChildren) {
      childIdx++;
      const childName = child.path.slice(key.length + 1);
      entries.push({
        label: childName,
        annotation: child.annotation,
        updatedAt: child.updatedAt,
        indent: 1,
        isLast: childIdx === childCount,
      });
    }

    // Sub-directory groups
    for (const [subDir, subFiles] of subGroups) {
      childIdx++;
      const isLastChild = childIdx === childCount;
      entries.push({
        label: subDir + '/',
        annotation: '',
        updatedAt: 0,
        indent: 1,
        isLast: isLastChild,
      });

      for (let si = 0; si < subFiles.length; si++) {
        const sf = subFiles[si];
        const leafName = sf.path.slice(key.length + 1 + subDir.length + 1);
        entries.push({
          label: leafName,
          annotation: sf.annotation,
          updatedAt: sf.updatedAt,
          indent: 2,
          isLast: si === subFiles.length - 1,
        });
      }
    }
  }

  return { entries, nextIdx: itemIdx };
}

function buildEntries(files: ManagedFile[], userEmail: string): TreeEntry[] {
  // Split by scope
  const workspaceFiles = files.filter((f) => f.scope === 'workspace');
  const deviceFiles = files.filter((f) => f.scope === 'device');

  // Count top-level items across all scopes (workspace dirs/files + device group + cloud)
  const wsTopKeys = new Set<string>();
  for (const f of workspaceFiles) {
    const slash = f.path.indexOf('/');
    wsTopKeys.add(slash === -1 ? f.path : f.path.slice(0, slash));
  }
  const deviceGroupCount = deviceFiles.length > 0 ? 1 : 0; // device renders as one top-level group
  const totalTopItems = wsTopKeys.size + deviceGroupCount + 1; // +1 for cloud

  // Build workspace entries
  const { entries, nextIdx } = buildScopeEntries(workspaceFiles, totalTopItems, 0);

  // Build device entries (rendered as a separate visual group)
  if (deviceFiles.length > 0) {
    const deviceDirLabel = '~/.claude/';
    const isLastDevice = nextIdx + 1 === totalTopItems;
    entries.push({
      label: deviceDirLabel,
      annotation: '',
      updatedAt: 0,
      indent: 0,
      isLast: isLastDevice,
      spaceBefore: true,
    });

    for (let i = 0; i < deviceFiles.length; i++) {
      const df = deviceFiles[i];
      // Strip the "~/.claude/" prefix for child display
      const childLabel = df.path.startsWith('~/.claude/')
        ? df.path.slice('~/.claude/'.length)
        : df.path;
      entries.push({
        label: childLabel,
        annotation: df.annotation,
        updatedAt: df.updatedAt,
        indent: 1,
        isLast: i === deviceFiles.length - 1,
      });
    }
  }

  // Cloud status (visually separated)
  entries.push({
    label: '☁  cloud',
    annotation: userEmail || 'not logged in [l]',
    updatedAt: 0,
    indent: 0,
    isLast: true,
    spaceBefore: true,
  });

  return entries;
}

// ── Prefix builder ───────────────────────────────────────────

function getPrefix(entries: TreeEntry[], idx: number): string {
  const entry = entries[idx];
  if (entry.indent === 0) {
    return entry.isLast ? '└── ' : '├── ';
  }

  // Build prefix from parent indentation
  let prefix = '';

  // Find if enclosing indent-0 is last
  let parentIsLast = false;
  for (let j = idx - 1; j >= 0; j--) {
    if (entries[j].indent === 0) {
      parentIsLast = entries[j].isLast;
      break;
    }
  }
  prefix += parentIsLast ? '    ' : '│   ';

  if (entry.indent === 2) {
    // Find if enclosing indent-1 is last
    let subParentIsLast = false;
    for (let j = idx - 1; j >= 0; j--) {
      if (entries[j].indent <= 1) {
        subParentIsLast = entries[j].isLast;
        break;
      }
    }
    prefix += subParentIsLast ? '    ' : '│   ';
  }

  prefix += entry.isLast ? '└── ' : '├── ';
  return prefix;
}

// ── Component ────────────────────────────────────────────────

const MemoryMap: React.FC<MemoryMapProps> = ({ files, dreaming: _dreaming, userEmail }) => {
  if (files.length === 0) return null;

  const entries = buildEntries(files, userEmail);

  return (
    <Box flexDirection="column">
      {entries.map((entry, idx) => {
        const prefix = getPrefix(entries, idx);
        const recent = isRecent(entry.updatedAt);
        const timeStr = relativeTime(entry.updatedAt);
        const isDir = entry.label.endsWith('/');

        // Build annotation: recent files get "✦ synced", others get dim annotation or time
        let annotationNode: React.ReactNode = null;
        if (recent) {
          annotationNode = <Text key="a" color={COLORS.primary}>{' ✦ synced'}</Text>;
        } else if (entry.annotation) {
          annotationNode = <Text key="a" color={COLORS.gray}>{`  ${entry.annotation}`}</Text>;
        } else if (timeStr) {
          annotationNode = <Text key="a" dimColor>{`  ${timeStr}`}</Text>;
        }

        const line = (
          <Text key={`e-${idx}`} color={COLORS.gray}>
            {prefix}
            <Text color={isDir ? COLORS.white : (recent ? COLORS.white : COLORS.gray)} bold={isDir}>
              {entry.label}
            </Text>
            {annotationNode}
          </Text>
        );

        if (entry.spaceBefore) {
          return <React.Fragment key={`g-${idx}`}><Text>{' '}</Text>{line}</React.Fragment>;
        }
        return line;
      })}
    </Box>
  );
};

export default MemoryMap;
