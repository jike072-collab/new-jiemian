"use client";

import Link from "next/link";
import {
  Bot,
  Code2,
  Download,
  FolderOpen,
  Keyboard,
  Layers3,
  LayoutDashboard,
  Menu,
  Moon,
  Palette,
  Plus,
  Save,
  Search,
  Settings2,
  Sun,
  Trash2,
  Upload,
  UserCircle2,
  UsersRound,
} from "lucide-react";
import { useRef } from "react";

import type { CanvasPresenceMember } from "@/lib/canvas/presence";
import { cn } from "@/lib/utils";

// Layout adapted from VOZEB v1.0.0 (AGPL-3.0); see THIRD_PARTY_NOTICES.md.
type ProjectOption = { id: string; title: string };
type SaveState = "saved" | "dirty" | "saving" | "error";
type CanvasTheme = "midnight" | "graphite" | "light";

export function CanvasVozebTopbar({
  accountName,
  projects,
  activeProjectId,
  scope,
  title,
  saveState,
  syncState,
  canvasTheme,
  libraryOpen,
  layersOpen,
  settingsOpen,
  teamOpen,
  assistantOpen,
  shortcutsOpen,
  commandOpen,
  isTeamOwner,
  presenceMembers,
  presenceClientId,
  onTitleChange,
  onProjectChange,
  onScopeChange,
  onCreateProject,
  onDeleteProject,
  onSave,
  onToggleLibrary,
  onToggleLayers,
  onImport,
  onExport,
  onSettings,
  onToggleTeam,
  onAssistant,
  onShortcuts,
  onCommand,
  onOrganize,
  onThemeCycle,
}: {
  accountName: string;
  projects: ProjectOption[];
  activeProjectId: string;
  scope?: "personal" | "shared";
  title: string;
  saveState: SaveState;
  syncState?: "live" | "syncing" | "paused";
  canvasTheme: CanvasTheme;
  libraryOpen: boolean;
  layersOpen: boolean;
  settingsOpen: boolean;
  teamOpen: boolean;
  assistantOpen: boolean;
  shortcutsOpen: boolean;
  commandOpen: boolean;
  isTeamOwner: boolean;
  presenceMembers: CanvasPresenceMember[];
  presenceClientId: string;
  onTitleChange: (value: string) => void;
  onProjectChange: (id: string) => void;
  onScopeChange: (scope: "personal" | "shared") => void;
  onCreateProject: () => void;
  onDeleteProject: () => void;
  onSave: () => void;
  onToggleLibrary: () => void;
  onToggleLayers: () => void;
  onImport: () => void;
  onExport: () => void;
  onSettings: () => void;
  onToggleTeam: () => void;
  onAssistant: () => void;
  onShortcuts: () => void;
  onCommand: () => void;
  onOrganize: () => void;
  onThemeCycle: () => void;
}) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const closeAndRun = (action: () => void) => {
    if (menuRef.current) menuRef.current.open = false;
    action();
  };

  return (
    <header className="canvas-v2-topbar">
      <div className="canvas-v2-topbar__left">
        <details ref={menuRef} className="canvas-v2-menu">
          <summary className="canvas-v2-icon-button" aria-label="打开画布菜单" title="画布菜单"><Menu /></summary>
          <div className="canvas-v2-menu__popover">
            <div className="canvas-v2-menu__heading">
              <span><strong>奥皇 AI 无限画布</strong><small>VOZEB 工作台布局</small></span>
              <span className={cn("canvas-v2-save-chip", `is-${saveState}`)}>{saveLabel(saveState)}</span>
            </div>

            {scope ? (
              <div className="canvas-v2-segments" role="tablist" aria-label="画布空间">
                <button type="button" role="tab" aria-selected={scope === "personal"} className={scope === "personal" ? "is-active" : undefined} onClick={() => closeAndRun(() => onScopeChange("personal"))}>个人</button>
                <button type="button" role="tab" aria-selected={scope === "shared"} className={scope === "shared" ? "is-active" : undefined} onClick={() => closeAndRun(() => onScopeChange("shared"))}>团队</button>
              </div>
            ) : null}

            <label className="canvas-v2-menu__field">
              <span>当前画布</span>
              <select value={activeProjectId} onChange={(event) => closeAndRun(() => onProjectChange(event.target.value))}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
            </label>

            <div className="canvas-v2-menu__commands">
              <button type="button" onClick={() => closeAndRun(onCreateProject)}><Plus />新建画布</button>
              <button type="button" onClick={() => closeAndRun(onSave)}><Save />立即保存</button>
              <button type="button" onClick={() => closeAndRun(onImport)}><Upload />导入 JSON</button>
              <button type="button" onClick={() => closeAndRun(onExport)}><Download />导出 JSON</button>
              <button type="button" className={libraryOpen ? "is-active" : undefined} onClick={() => closeAndRun(onToggleLibrary)}><FolderOpen />素材库</button>
              <button type="button" className={layersOpen ? "is-active" : undefined} onClick={() => closeAndRun(onToggleLayers)}><Layers3 />图层</button>
              <button type="button" className={settingsOpen ? "is-active" : undefined} onClick={() => closeAndRun(onSettings)}><Settings2 />画布设置</button>
              {isTeamOwner ? <button type="button" className={teamOpen ? "is-active" : undefined} onClick={() => closeAndRun(onToggleTeam)}><UsersRound />团队与用量</button> : null}
              <button type="button" className="is-danger" onClick={() => closeAndRun(onDeleteProject)}><Trash2 />删除当前画布</button>
            </div>

            <div className="canvas-v2-menu__footer">
              <Link href="/">返回奥皇 AI</Link>
              <a href="https://github.com/jike072-collab/new-jiemian" target="_blank" rel="noreferrer"><Code2 />对应源码</a>
            </div>
          </div>
        </details>

        <button
          type="button"
          className={cn("canvas-v2-icon-button", libraryOpen && "is-active")}
          aria-label={libraryOpen ? "关闭素材库" : "打开素材库"}
          title={libraryOpen ? "关闭素材库" : "打开素材库"}
          onClick={onToggleLibrary}
        >
          <FolderOpen />
        </button>

        <input
          className="canvas-v2-title"
          value={title}
          aria-label="画布名称"
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <button
          type="button"
          className={cn("canvas-v2-command-button", commandOpen && "is-active")}
          aria-label="搜索节点和操作"
          title="搜索节点和操作（Ctrl K）"
          onClick={onCommand}
        >
          <Search /><span>搜索与命令</span><kbd>Ctrl K</kbd>
        </button>
      </div>

      <div className="canvas-v2-topbar__actions">
        <span className="canvas-v2-free-chip" title="内部画布不扣积分">内部免费</span>
        <button type="button" className="canvas-v2-organize-button" aria-label="一键整理画布" title="按创作流程一键整理画布" onClick={onOrganize}><LayoutDashboard /><span>一键整理</span></button>
        {syncState ? <span className={cn("canvas-v2-sync-chip", `is-${syncState}`)} title="共享画布同步状态">{syncLabel(syncState)}</span> : null}
        {presenceMembers.length ? (
          <details className="canvas-v2-presence">
            <summary className="canvas-v2-icon-button" aria-label={`在线成员 ${presenceMembers.length} 人`} title="在线成员">
              <UsersRound /><span>{presenceMembers.length}</span>
            </summary>
            <div className="canvas-v2-presence__popover" aria-label="团队在线状态">
              <strong>团队在线</strong>
              {presenceMembers.map((member) => (
                <div className="canvas-v2-presence__member" key={member.clientId}>
                  <span className="canvas-v2-presence__avatar" style={{ background: member.color }}>{presenceInitial(member.displayName)}</span>
                  <span><b>{member.displayName}{member.clientId === presenceClientId ? "（你）" : ""}</b><small>{presenceActivityLabel(member.activity)}</small></span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
        <button type="button" className="canvas-v2-icon-button" aria-label="切换画布主题" title="切换画布主题" onClick={onThemeCycle}>
          {canvasTheme === "light" ? <Moon /> : <Sun />}
        </button>
        <button type="button" className={cn("canvas-v2-icon-button", shortcutsOpen && "is-active")} aria-label="操作与快捷键" title="操作与快捷键" onClick={onShortcuts}><Keyboard /></button>
        <button type="button" className={cn("canvas-v2-account-button", teamOpen && "is-active")} title={accountName} onClick={isTeamOwner ? onToggleTeam : undefined}><UserCircle2 /><span>{accountName}</span></button>
        <button type="button" className={cn("canvas-v2-agent-button", assistantOpen && "is-active")} aria-label="智能助手" title="受限画布智能助手" onClick={onAssistant}><Bot /><span>助手</span></button>
        <button type="button" className={cn("canvas-v2-icon-button", settingsOpen && "is-active")} aria-label="画布设置" title="画布设置" onClick={onSettings}><Palette /></button>
      </div>
    </header>
  );
}

function saveLabel(state: SaveState) {
  if (state === "dirty") return "待保存";
  if (state === "saving") return "保存中";
  if (state === "error") return "保存失败";
  return "已保存";
}

function syncLabel(state: "live" | "syncing" | "paused") {
  if (state === "syncing") return "同步中";
  if (state === "paused") return "同步暂停";
  return "实时同步";
}

function presenceActivityLabel(activity: CanvasPresenceMember["activity"]) {
  if (activity === "generating") return "正在生成";
  if (activity === "editing") return "正在编辑";
  if (activity === "selected") return "已选择节点";
  return "正在查看";
}

function presenceInitial(displayName: string) {
  return displayName.trim().slice(0, 1).toUpperCase() || "成";
}
