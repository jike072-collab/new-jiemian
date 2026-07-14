"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Save, Settings2, Trash2, X } from "lucide-react";

import { CustomSelect } from "@/components/studio/custom-select";
import {
  builtInPromptPresets,
  emptyPromptPreferences,
  normalizePromptPreferences,
  promptPreferenceFields,
  promptPreferenceToolLabels,
  type PromptPreferences,
  type PromptPreferenceTool,
} from "@/lib/prompt-preferences";

type CustomPromptPreset = {
  id: string;
  name: string;
  tool: PromptPreferenceTool;
  settings: PromptPreferences;
};

type PromptSettingsStore = {
  version: 2;
  settings: Record<PromptPreferenceTool, PromptPreferences>;
  activePresetIds: Partial<Record<PromptPreferenceTool, string>>;
  customPresets: CustomPromptPreset[];
};

const storageKey = "aohuang-prompt-settings-v1";
const tools: PromptPreferenceTool[] = ["image-generator", "image-editor", "video-generator"];
const subscribeToHydration = () => () => undefined;
const hydratedSnapshot = () => true;
const serverHydratedSnapshot = () => false;

function createDefaultStore(): PromptSettingsStore {
  return {
    version: 2,
    settings: {
      "image-generator": emptyPromptPreferences(),
      "image-editor": emptyPromptPreferences(),
      "video-generator": emptyPromptPreferences(),
    },
    activePresetIds: {},
    customPresets: [],
  };
}

function readStore(): PromptSettingsStore {
  if (typeof window === "undefined") return createDefaultStore();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null") as (
      Partial<Omit<PromptSettingsStore, "version">> & { version?: number }
    ) | null;
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2)) return createDefaultStore();
    const defaults = createDefaultStore();
    const normalizedSettings = Object.fromEntries(tools.map((tool) => {
      const normalized = normalizePromptPreferences(parsed.settings?.[tool]);
      const migrateToDefault = parsed.version === 1 && Object.keys(normalized).length === 0;
      return [tool, migrateToDefault ? defaults.settings[tool] : normalized];
    })) as PromptSettingsStore["settings"];
    const activePresetIds = Object.fromEntries(tools.flatMap((tool) => {
      const migrateToDefault = parsed.version === 1 && Object.keys(normalizePromptPreferences(parsed.settings?.[tool])).length === 0;
      const presetId = migrateToDefault ? undefined : parsed.activePresetIds?.[tool];
      return presetId ? [[tool, presetId]] : [];
    })) as PromptSettingsStore["activePresetIds"];
    return {
      version: 2,
      settings: normalizedSettings,
      activePresetIds,
      customPresets: Array.isArray(parsed.customPresets)
        ? parsed.customPresets.flatMap((preset) => (
          preset
          && typeof preset.id === "string"
          && typeof preset.name === "string"
          && tools.includes(preset.tool)
            ? [{
              id: preset.id.slice(0, 100),
              name: preset.name.trim().slice(0, 30),
              tool: preset.tool,
              settings: normalizePromptPreferences(preset.settings),
            }]
            : []
        )).slice(0, 30)
        : defaults.customPresets,
    };
  } catch {
    return createDefaultStore();
  }
}

function persistStore(store: PromptSettingsStore) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  } catch {
    // Browser storage is optional; current-session settings still work.
  }
}

export function usePromptPreferences(tool: PromptPreferenceTool) {
  const [store, setStore] = useState<PromptSettingsStore>(readStore);

  const saveStore = useCallback((next: PromptSettingsStore) => {
    setStore(next);
    persistStore(next);
  }, []);

  return {
    preferences: store.settings[tool],
    store,
    saveStore,
  };
}

export function PromptSettingsButton({
  tool,
  store,
  onChange,
}: {
  tool: PromptPreferenceTool;
  store: PromptSettingsStore;
  onChange: (store: PromptSettingsStore) => void;
}) {
  const hydrated = useSyncExternalStore(subscribeToHydration, hydratedSnapshot, serverHydratedSnapshot);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="studio-prompt-action studio-prompt-settings-trigger"
        aria-label="提示词优化设置"
        title="提示词优化设置"
        disabled={!hydrated}
        onClick={() => setOpen(true)}
      >
        <Settings2 className="size-4" aria-hidden="true" />
      </button>
      {open ? (
        <PromptSettingsDialog
          initialTool={tool}
          store={store}
          onCancel={() => setOpen(false)}
          onApply={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function PromptSettingsDialog({
  initialTool,
  store,
  onCancel,
  onApply,
}: {
  initialTool: PromptPreferenceTool;
  store: PromptSettingsStore;
  onCancel: () => void;
  onApply: (store: PromptSettingsStore) => void;
}) {
  const activeTool = initialTool;
  const [draft, setDraft] = useState<PromptSettingsStore>(() => structuredClone(store));
  const [presetName, setPresetName] = useState(() => {
    const activeId = store.activePresetIds[initialTool];
    return store.customPresets.find((preset) => preset.id === activeId && preset.tool === initialTool)?.name || "";
  });
  const currentSettings = draft.settings[activeTool];
  const activePresetId = draft.activePresetIds[activeTool] || "";
  const presets = useMemo(() => [
    ...builtInPromptPresets.filter((preset) => preset.tool === activeTool),
    ...draft.customPresets.filter((preset) => preset.tool === activeTool),
  ], [activeTool, draft.customPresets]);
  const selectedCustomPreset = draft.customPresets.find((preset) => preset.id === activePresetId && preset.tool === activeTool) || null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const updateSettings = (patch: PromptPreferences) => {
    setPresetName("");
    setDraft((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [activeTool]: normalizePromptPreferences({ ...current.settings[activeTool], ...patch }),
      },
      activePresetIds: { ...current.activePresetIds, [activeTool]: undefined },
    }));
  };

  const applyPreset = (presetId: string) => {
    const preset = presets.find((entry) => entry.id === presetId);
    setPresetName(draft.customPresets.find((entry) => entry.id === presetId)?.name || "");
    setDraft((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [activeTool]: preset ? normalizePromptPreferences(preset.settings) : emptyPromptPreferences(),
      },
      activePresetIds: { ...current.activePresetIds, [activeTool]: preset?.id },
    }));
  };

  const savePreset = () => {
    const name = presetName.trim().slice(0, 30);
    if (!name) return;
    setDraft((current) => {
      const existing = current.customPresets.find((preset) => preset.id === activePresetId && preset.tool === activeTool);
      const id = existing?.id || `custom-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
      const nextPreset: CustomPromptPreset = {
        id,
        name,
        tool: activeTool,
        settings: normalizePromptPreferences(current.settings[activeTool]),
      };
      return {
        ...current,
        activePresetIds: { ...current.activePresetIds, [activeTool]: id },
        customPresets: existing
          ? current.customPresets.map((preset) => preset.id === id ? nextPreset : preset)
          : [...current.customPresets, nextPreset].slice(-30),
      };
    });
  };

  const deletePreset = () => {
    if (!selectedCustomPreset) return;
    setDraft((current) => ({
      ...current,
      activePresetIds: { ...current.activePresetIds, [activeTool]: undefined },
      customPresets: current.customPresets.filter((preset) => preset.id !== selectedCustomPreset.id),
    }));
    setPresetName("");
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="prompt-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-settings-title">
      <button type="button" className="prompt-settings-dialog__backdrop" aria-label="关闭提示词设置" onClick={onCancel} />
      <section className="prompt-settings-dialog__panel">
        <header className="prompt-settings-dialog__header">
          <div>
            <span className="shell-eyebrow">PROMPT PROFILE</span>
            <h2 id="prompt-settings-title">{promptPreferenceToolLabels[activeTool]}提示词设置</h2>
          </div>
          <button type="button" className="prompt-settings-dialog__close" aria-label="关闭提示词设置" onClick={onCancel}>
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="prompt-settings-dialog__body">
          <div className="prompt-settings-preset-row">
            <label>
              <span>快捷方案</span>
              <CustomSelect
                label="快捷方案"
                value={activePresetId}
                options={[{ value: "", label: "自定义设置" }, ...presets.map((preset) => ({ value: preset.id, label: preset.name }))]}
                onChange={applyPreset}
              />
            </label>
            <button type="button" className="prompt-settings-reset" onClick={() => applyPreset("")}>恢复自动</button>
          </div>

          <div className="prompt-settings-grid">
            {promptPreferenceFields[activeTool].map((field) => (
              <label key={field.key} className="prompt-settings-field">
                <span>{field.label}</span>
                <CustomSelect
                  label={field.label}
                  value={currentSettings[field.key] || ""}
                  options={field.options}
                  onChange={(value) => updateSettings({ [field.key]: value })}
                />
              </label>
            ))}
          </div>

          <div className="prompt-settings-textareas">
            <label>
              <span>避免内容</span>
              <textarea
                value={currentSettings.negativePrompt || ""}
                maxLength={400}
                placeholder="不希望出现的元素、文字或画面问题"
                onChange={(event) => updateSettings({ negativePrompt: event.target.value })}
              />
            </label>
            <label>
              <span>补充偏好</span>
              <textarea
                value={currentSettings.customInstructions || ""}
                maxLength={600}
                placeholder="其他需要长期保留的创作习惯"
                onChange={(event) => updateSettings({ customInstructions: event.target.value })}
              />
            </label>
          </div>

          <div className="prompt-settings-save-row">
            <label>
              <span>方案名称</span>
              <input value={presetName} maxLength={30} placeholder="例如：我的写实商品图" onChange={(event) => setPresetName(event.target.value)} />
            </label>
            <button type="button" className="prompt-settings-save" disabled={!presetName.trim()} onClick={savePreset}>
              <Save className="size-4" aria-hidden="true" />
              保存方案
            </button>
            {selectedCustomPreset ? (
              <button type="button" className="prompt-settings-delete" aria-label="删除当前自定义方案" title="删除当前自定义方案" onClick={deletePreset}>
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        <footer className="prompt-settings-dialog__footer">
          <button type="button" className="studio-secondary-button" onClick={onCancel}>取消</button>
          <button type="button" className="studio-primary-action" onClick={() => onApply(draft)}>应用设置</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
