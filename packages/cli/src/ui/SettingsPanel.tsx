/**
 * SettingsPanel — inline settings editor for the terminal dashboard.
 *
 * Replaces the normal dashboard view when active. Shows user settings (cloud)
 * and project settings (local) in two sections. Arrow keys to navigate,
 * Enter to edit, Esc to cancel.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Key } from 'ink';
import { COLORS } from './theme';
import type { UserSettings, AspectCodeConfig } from '../config';

// ── Setting definitions ─────────────────────────────────────

interface SettingDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  options?: string[];
  section: 'user' | 'project';
  configPath: string;
  defaultValue: string;
}

const SETTINGS: SettingDef[] = [
  // User settings (cloud)
  { key: 'provider', label: 'LLM Provider', type: 'select', options: ['openai', 'anthropic', 'grok'], section: 'user', configPath: 'provider', defaultValue: 'anthropic' },
  { key: 'model', label: 'Model', type: 'string', section: 'user', configPath: 'model', defaultValue: 'provider default' },
  { key: 'temperature', label: 'Temperature', type: 'number', section: 'user', configPath: 'temperature', defaultValue: '0.7' },
  { key: 'maxTokens', label: 'Max Tokens', type: 'number', section: 'user', configPath: 'maxTokens', defaultValue: '4000' },
  { key: 'autoResolve', label: 'Auto-resolve', type: 'number', section: 'user', configPath: 'autoResolveThreshold', defaultValue: '0.8' },
  // Project settings (local)
  { key: 'ownership', label: 'Ownership Mode', type: 'select', options: ['full', 'section'], section: 'project', configPath: 'ownership', defaultValue: 'full' },
  { key: 'platform', label: 'Platform', type: 'select', options: ['claude', 'cursor'], section: 'project', configPath: 'platform', defaultValue: 'claude' },
  { key: 'exclude', label: 'Exclude Dirs', type: 'string', section: 'project', configPath: 'exclude', defaultValue: 'none' },
  { key: 'evalEnabled', label: 'Probe & Refine', type: 'boolean', section: 'project', configPath: 'evaluate.enabled', defaultValue: 'true' },
  { key: 'maxProbes', label: 'Probes/Iter', type: 'number', section: 'project', configPath: 'evaluate.maxProbes', defaultValue: '5' },
  { key: 'maxIterations', label: 'Max Iterations', type: 'number', section: 'project', configPath: 'evaluate.maxIterations', defaultValue: '1' },
  { key: 'maxEdits', label: 'Max Edits/Iter', type: 'number', section: 'project', configPath: 'evaluate.maxEditsPerIteration', defaultValue: '5' },
  { key: 'charBudget', label: 'Char Budget', type: 'number', section: 'project', configPath: 'evaluate.charBudget', defaultValue: '8000' },
];

// ── Helpers ──────────────────────────────────────────────────

function getValue(userSettings: UserSettings, projectConfig: AspectCodeConfig, def: SettingDef): string {
  if (def.section === 'user') {
    const val = (userSettings as Record<string, unknown>)[def.configPath];
    return val !== undefined && val !== null ? String(val) : '';
  }
  // Project settings with dot paths
  const parts = def.configPath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let obj: any = projectConfig;
  for (const p of parts) {
    if (!obj || typeof obj !== 'object') return '';
    obj = obj[p];
  }
  if (Array.isArray(obj)) return obj.join(', ');
  return obj !== undefined && obj !== null ? String(obj) : '';
}

// ── Component ───────────────────────────────────────────────

interface SettingsPanelProps {
  userSettings: UserSettings;
  projectConfig: AspectCodeConfig;
  onSave: (user: UserSettings, project: AspectCodeConfig) => void;
  onCancel: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  userSettings,
  projectConfig,
  onSave,
  onCancel,
}) => {
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const def of SETTINGS) {
      const val = getValue(userSettings, projectConfig, def);
      d[def.key] = val || def.defaultValue;
    }
    return d;
  });

  // Total items: settings + 2 actions (Save, Cancel)
  const totalItems = SETTINGS.length + 2;

  useInput((input: string, key: Key) => {
    if (editing) {
      if (key.escape) {
        setEditing(false);
        return;
      }
      if (key.return) {
        setDraft((d) => ({ ...d, [SETTINGS[cursor].key]: editBuffer }));
        setEditing(false);
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer((b) => b.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEditBuffer((b) => b + input);
      }
      return;
    }

    // Navigation
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(totalItems - 1, c + 1));
      return;
    }

    if (key.return || input === ' ') {
      // Save action
      if (cursor === SETTINGS.length) {
        // Build user settings (skip default-like values)
        const newUser: UserSettings = {};
        if (draft.provider && draft.provider !== 'anthropic') newUser.provider = draft.provider;
        else newUser.provider = draft.provider;
        if (draft.model && draft.model !== 'provider default') newUser.model = draft.model;
        const temp = parseFloat(draft.temperature);
        if (!isNaN(temp)) newUser.temperature = temp;
        const maxTok = parseInt(draft.maxTokens, 10);
        if (!isNaN(maxTok)) newUser.maxTokens = maxTok;
        const autoResolve = parseFloat(draft.autoResolve);
        if (!isNaN(autoResolve)) newUser.autoResolveThreshold = autoResolve;

        // Build project config
        const newProject: AspectCodeConfig = {};
        if (draft.ownership) newProject.ownership = draft.ownership as 'full' | 'section';
        if (draft.platform) newProject.platform = draft.platform;
        if (draft.exclude && draft.exclude !== 'none') {
          newProject.exclude = draft.exclude.split(',').map((s) => s.trim()).filter(Boolean);
        }
        newProject.evaluate = {};
        newProject.evaluate.enabled = draft.evalEnabled === 'true';
        const probes = parseInt(draft.maxProbes, 10);
        if (!isNaN(probes)) newProject.evaluate.maxProbes = probes;
        const iters = parseInt(draft.maxIterations, 10);
        if (!isNaN(iters)) newProject.evaluate.maxIterations = iters;
        const edits = parseInt(draft.maxEdits, 10);
        if (!isNaN(edits)) newProject.evaluate.maxEditsPerIteration = edits;
        const budget = parseInt(draft.charBudget, 10);
        if (!isNaN(budget)) newProject.evaluate.charBudget = budget;

        onSave(newUser, newProject);
        return;
      }

      // Cancel action
      if (cursor === SETTINGS.length + 1) {
        onCancel();
        return;
      }

      // Edit a setting
      const def = SETTINGS[cursor];
      if (def.type === 'select' && def.options) {
        // Cycle through options
        const current = draft[def.key];
        const idx = def.options.indexOf(current);
        const next = def.options[(idx + 1) % def.options.length];
        setDraft((d) => ({ ...d, [def.key]: next }));
      } else if (def.type === 'boolean') {
        const current = draft[def.key];
        setDraft((d) => ({ ...d, [def.key]: current === 'true' ? 'false' : 'true' }));
      } else {
        setEditBuffer(draft[def.key]);
        setEditing(true);
      }
    }
  });

  const userDefs = SETTINGS.filter((d) => d.section === 'user');
  const projectDefs = SETTINGS.filter((d) => d.section === 'project');

  let flatIndex = 0;

  return (
    <Box flexDirection="column">
      <Text color={COLORS.primary} bold>{'Settings'}</Text>
      <Text color={COLORS.gray}>{'Arrow keys to navigate · Enter to edit · Esc to cancel'}</Text>
      <Text>{''}</Text>

      {/* User settings */}
      <Text color={COLORS.primary}>{'\u2501 User Settings (cloud)'}</Text>
      {userDefs.map((def) => {
        const idx = flatIndex++;
        const selected = cursor === idx;
        const isEditing = selected && editing;
        const val = isEditing ? editBuffer : (draft[def.key] || '\u2014');
        return (
          <Text key={def.key}>
            <Text color={selected ? COLORS.primary : COLORS.gray}>{selected ? '\u25B6 ' : '  '}</Text>
            <Text color={COLORS.white}>{def.label.padEnd(16)}</Text>
            {isEditing ? (
              <Text color={COLORS.primary}>{`${val}\u2588`}</Text>
            ) : (
              <Text color={draft[def.key] ? COLORS.white : COLORS.gray}>{val}</Text>
            )}
            {selected && def.type === 'select' ? <Text color={COLORS.gray}>{' (Enter to cycle)'}</Text> : null}
          </Text>
        );
      })}

      <Text>{''}</Text>

      {/* Project settings */}
      <Text color={COLORS.primary}>{'\u2501 Project Settings (aspectcode.json)'}</Text>
      {projectDefs.map((def) => {
        const idx = flatIndex++;
        const selected = cursor === idx;
        const isEditing = selected && editing;
        const val = isEditing ? editBuffer : (draft[def.key] || '\u2014');
        return (
          <Text key={def.key}>
            <Text color={selected ? COLORS.primary : COLORS.gray}>{selected ? '\u25B6 ' : '  '}</Text>
            <Text color={COLORS.white}>{def.label.padEnd(16)}</Text>
            {isEditing ? (
              <Text color={COLORS.primary}>{`${val}\u2588`}</Text>
            ) : (
              <Text color={draft[def.key] ? COLORS.white : COLORS.gray}>{val}</Text>
            )}
            {selected && def.type === 'select' ? <Text color={COLORS.gray}>{' (Enter to cycle)'}</Text> : null}
            {selected && def.type === 'boolean' ? <Text color={COLORS.gray}>{' (Enter to toggle)'}</Text> : null}
          </Text>
        );
      })}

      <Text>{''}</Text>

      {/* Actions */}
      <Text>
        <Text color={cursor === SETTINGS.length ? COLORS.primary : COLORS.gray}>
          {cursor === SETTINGS.length ? '\u25B6 ' : '  '}
        </Text>
        <Text color={COLORS.primary} bold>{'Save & exit'}</Text>
      </Text>
      <Text>
        <Text color={cursor === SETTINGS.length + 1 ? COLORS.primary : COLORS.gray}>
          {cursor === SETTINGS.length + 1 ? '\u25B6 ' : '  '}
        </Text>
        <Text color={COLORS.gray}>{'Cancel'}</Text>
      </Text>
    </Box>
  );
};

export default SettingsPanel;
