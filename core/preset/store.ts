// 系统提示词预设存储
import type { NewPreset, SystemPromptPreset } from '../types';

const PRESETS_KEY = 'gemini_pp_presets';
const ACTIVE_PRESET_ID_KEY = 'gemini_pp_active_preset_id';

export async function getAllPresets(): Promise<SystemPromptPreset[]> {
  const data = await chrome.storage.local.get(PRESETS_KEY);
  const presets = Array.isArray(data[PRESETS_KEY]) ? data[PRESETS_KEY] as SystemPromptPreset[] : [];
  return presets.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getActivePreset(): Promise<SystemPromptPreset | null> {
  const data = await chrome.storage.local.get([PRESETS_KEY, ACTIVE_PRESET_ID_KEY]);
  const presets = Array.isArray(data[PRESETS_KEY]) ? data[PRESETS_KEY] as SystemPromptPreset[] : [];
  const id = data[ACTIVE_PRESET_ID_KEY] as string | undefined;
  return presets.find((p) => p.id === id) ?? null;
}

export async function getActivePresetId(): Promise<string | null> {
  const data = await chrome.storage.local.get(ACTIVE_PRESET_ID_KEY);
  return typeof data[ACTIVE_PRESET_ID_KEY] === 'string' ? data[ACTIVE_PRESET_ID_KEY] : null;
}

export async function savePreset(preset: NewPreset, id?: string): Promise<SystemPromptPreset> {
  const data = await chrome.storage.local.get(PRESETS_KEY);
  const presets = Array.isArray(data[PRESETS_KEY]) ? data[PRESETS_KEY] as SystemPromptPreset[] : [];
  const now = Date.now();
  let next: SystemPromptPreset;
  if (id && presets.some((p) => p.id === id)) {
    const existing = presets.find((p) => p.id === id)!;
    next = { ...existing, ...preset, id, updatedAt: now };
    const list = presets.map((p) => p.id === id ? next : p);
    await chrome.storage.local.set({ [PRESETS_KEY]: list });
  } else {
    next = { ...preset, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await chrome.storage.local.set({ [PRESETS_KEY]: [...presets, next] });
  }
  return next;
}

export async function deletePreset(id: string): Promise<void> {
  const data = await chrome.storage.local.get([PRESETS_KEY, ACTIVE_PRESET_ID_KEY]);
  const presets = Array.isArray(data[PRESETS_KEY]) ? data[PRESETS_KEY] as SystemPromptPreset[] : [];
  const next = presets.filter((p) => p.id !== id);
  const patch: Record<string, unknown> = { [PRESETS_KEY]: next };
  if (data[ACTIVE_PRESET_ID_KEY] === id) patch[ACTIVE_PRESET_ID_KEY] = null;
  await chrome.storage.local.set(patch);
}

export async function setActivePresetId(id: string | null): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_PRESET_ID_KEY]: id });
}
