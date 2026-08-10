// 提示词注入设置
import type { PresetCadence, PromptInjectionSettings } from '../types';

const SETTINGS_KEY = 'gemini_pp_injection_settings';

export const DEFAULT_INJECTION_SETTINGS: PromptInjectionSettings = {
  memoryEnabled: true,
  presetEnabled: true,
  presetCadence: 'first_message',
  skillInjectionEnabled: true,
};

export async function getInjectionSettings(): Promise<PromptInjectionSettings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeInjectionSettings(data[SETTINGS_KEY]);
}

export async function saveInjectionSettings(
  patch: Partial<PromptInjectionSettings>,
): Promise<PromptInjectionSettings> {
  const current = await getInjectionSettings();
  const next = normalizeInjectionSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function normalizeInjectionSettings(value: unknown): PromptInjectionSettings {
  const object = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<PromptInjectionSettings>
    : {};
  return {
    memoryEnabled: object.memoryEnabled !== false,
    presetEnabled: object.presetEnabled !== false,
    presetCadence: normalizeCadence(object.presetCadence),
    skillInjectionEnabled: object.skillInjectionEnabled !== false,
  };
}

function normalizeCadence(value: unknown): PresetCadence {
  return value === 'every_message' || value === 'off' || value === 'first_message'
    ? value
    : DEFAULT_INJECTION_SETTINGS.presetCadence;
}
