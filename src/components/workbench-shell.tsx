"use client";

import Link from "next/link";
import {
  ChevronDown,
  Menu,
  PanelLeft,
  PanelRight,
  UserRound,
  X,
} from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import {
  type WorkspaceAction,
  type WorkspaceToolEntry,
  type WorkspaceToolGroup,
  type WorkspaceToolId,
  workspaceAccountMenu,
  workspaceToolById,
  workspaceToolEntries,
  workspaceToolGroups,
} from "@/lib/workspace-registry";

type ShellPane = "parameters" | "preview";

type WorkspaceShellState = {
  activeToolId: WorkspaceToolId;
};

type WorkbenchShellProps = {
  state: WorkspaceShellState;
  onToolAction: (action: WorkspaceAction, tool: WorkspaceToolId) => void;
  isAuthenticated: boolean;
  headerRightSlot?: ReactNode;
  parameterSlot: ReactNode;
  previewSlot: ReactNode;
  mobileActionSlot?: ReactNode;
  toolTitle?: string;
};

export function WorkbenchShell({
  state,
  onToolAction,
  isAuthenticated,
  headerRightSlot,
  parameterSlot,
  previewSlot,
  mobileActionSlot,
  toolTitle,
}: WorkbenchShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pane, setPane] = useState<ShellPane>("parameters");
  const [accountOpen, setAccountOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const previousOverflowRef = useRef("");

  const activeTool = workspaceToolById(state.activeToolId) || workspaceToolEntries[0];
  const drawerId = "workspace-mobile-drawer";

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-shell-scroll='parameters']")?.scrollTo({ top: 0 });
    rootRef.current?.querySelector<HTMLElement>("[data-shell-scroll='preview']")?.scrollTo({ top: 0 });
  }, [state.activeToolId]);

  useEffect(() => {
    if (!drawerOpen) return;
    const triggerButton = drawerButtonRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      drawerRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflowRef.current;
      triggerButton?.focus();
    };
  }, [drawerOpen]);

  return (
    <div ref={rootRef} className="shell-root min-h-[100dvh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <Header
        isAuthenticated={isAuthenticated}
        onToggleDrawer={() => setDrawerOpen((value) => !value)}
        onToggleAccount={() => setAccountOpen((value) => !value)}
        accountOpen={accountOpen}
        headerRightSlot={headerRightSlot}
        drawerButtonRef={drawerButtonRef}
        drawerId={drawerId}
        drawerOpen={drawerOpen}
      />

      <MobileOverlay
        activeTool={activeTool}
        drawerOpen={drawerOpen}
        pane={pane}
        onClose={() => setDrawerOpen(false)}
        onSelect={(action, tool) => {
          onToolAction(action, tool);
          setDrawerOpen(false);
        }}
        onChangePane={setPane}
        isAuthenticated={isAuthenticated}
        accountOpen={accountOpen}
        mobileActionSlot={mobileActionSlot}
        drawerRef={drawerRef}
        drawerId={drawerId}
      />

      <main className="shell-main">
        <div className="shell-grid">
          <DesktopNavigation
            activeToolId={state.activeToolId}
            onSelect={(action, tool) => onToolAction(action, tool)}
            groups={workspaceToolGroups}
            isAuthenticated={isAuthenticated}
          />

          <section className="shell-panel shell-panel--controls">
            <div className="shell-panel__header shell-panel__header--tool">
              <div>
                <h2 className="shell-title">{toolTitle || activeTool.label}</h2>
              </div>
            </div>
            <div id="shell-parameters-panel" data-shell-scroll="parameters" className="shell-panel__body">
              {parameterSlot}
            </div>
          </section>

          <section className="shell-panel shell-panel--preview">
            <div id="shell-preview-panel" data-shell-scroll="preview" className="shell-panel__body shell-panel__body--preview">
              {previewSlot}
            </div>
          </section>
        </div>
      </main>

      <div className="shell-mobile-space" />
    </div>
  );
}

function Header({
  isAuthenticated,
  onToggleDrawer,
  onToggleAccount,
  accountOpen,
  headerRightSlot,
  drawerButtonRef,
  drawerId,
  drawerOpen,
}: {
  isAuthenticated: boolean;
  onToggleDrawer: () => void;
  onToggleAccount: () => void;
  accountOpen: boolean;
  headerRightSlot?: ReactNode;
  drawerButtonRef: RefObject<HTMLButtonElement | null>;
  drawerId: string;
  drawerOpen: boolean;
}) {
  return (
    <header className="shell-header">
      <div className="shell-header__brand">
        <button
          ref={drawerButtonRef}
          type="button"
          className="shell-icon-button shell-header__menu"
          aria-label="打开导航"
          aria-controls={drawerId}
          aria-expanded={drawerOpen}
          onClick={onToggleDrawer}
        >
          <Menu className="size-4" />
        </button>
        <Link href="/" className="shell-brand">
          <BrandLogo className="shell-brand__logo" />
          <span className="shell-brand__text">奥皇 AI</span>
        </Link>
      </div>

      <div className="shell-header__actions">
        {headerRightSlot}
        {isAuthenticated ? (
          <button type="button" className="shell-account" onClick={onToggleAccount}>
            <span className="shell-account__avatar">OA</span>
            <span className="shell-account__name">账户</span>
            <ChevronDown className={cn("size-4 transition", accountOpen && "rotate-180")} />
          </button>
        ) : (
          <Link href="/login" className="shell-login">
            <UserRound className="size-4" />
            登录
          </Link>
        )}
      </div>
    </header>
  );
}

function DesktopNavigation({
  activeToolId,
  onSelect,
  groups,
  isAuthenticated,
}: {
  activeToolId: WorkspaceToolId;
  onSelect: (action: WorkspaceAction, tool: WorkspaceToolId) => void;
  groups: Array<{ title: WorkspaceToolGroup; items: WorkspaceToolId[] }>;
  isAuthenticated: boolean;
}) {
  return (
    <aside className="shell-nav">
      <div className="shell-nav__groups">
        {groups.map((group) => {
          const visibleItems = group.items
            .map((id) => workspaceToolById(id))
            .filter((item): item is WorkspaceToolEntry => Boolean(item?.visible && (!item.requiresAuth || isAuthenticated)));
          if (!visibleItems.length) return null;
          return (
            <section key={group.title} className="shell-nav__group">
              <h3 className="shell-nav__group-title">{group.title}</h3>
              <div className="shell-nav__items">
                {visibleItems.map((item) => (
                  <ToolButton
                    key={item.id}
                    item={item}
                    active={activeToolId === item.id}
                    showDescription={false}
                    onClick={() => onSelect(item.action, item.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function MobileOverlay({
  activeTool,
  drawerOpen,
  pane,
  onClose,
  onSelect,
  onChangePane,
  isAuthenticated,
  accountOpen,
  mobileActionSlot,
  drawerRef,
  drawerId,
}: {
  activeTool: WorkspaceToolEntry;
  drawerOpen: boolean;
  pane: ShellPane;
  onClose: () => void;
  onSelect: (action: WorkspaceAction, tool: WorkspaceToolId) => void;
  onChangePane: (value: ShellPane) => void;
  isAuthenticated: boolean;
  accountOpen: boolean;
  mobileActionSlot?: ReactNode;
  drawerRef: RefObject<HTMLDivElement | null>;
  drawerId: string;
}) {
  return (
    <>
      <div className="shell-mobile-tabs">
        <div className="shell-mobile-tabs__left">
          <span className="shell-eyebrow">当前工具</span>
          <strong className="shell-mobile-tabs__title">{activeTool.label}</strong>
        </div>
        <div className="shell-mobile-tabs__switch" role="tablist" aria-label="参数和预览视图">
          <button
            type="button"
            id="shell-parameters-tab"
            role="tab"
            aria-selected={pane === "parameters"}
            aria-controls="shell-parameters-panel"
            className={cn("shell-tab", pane === "parameters" && "is-active")}
            onClick={() => onChangePane("parameters")}
          >
            <PanelLeft className="size-4" aria-hidden="true" />
            参数
          </button>
          <button
            type="button"
            id="shell-preview-tab"
            role="tab"
            aria-selected={pane === "preview"}
            aria-controls="shell-preview-panel"
            className={cn("shell-tab", pane === "preview" && "is-active")}
            onClick={() => onChangePane("preview")}
          >
            <PanelRight className="size-4" aria-hidden="true" />
            预览
          </button>
        </div>
      </div>

      <div className="shell-mobile-action-slot">{mobileActionSlot}</div>

      <div className={cn("shell-drawer-backdrop", drawerOpen && "is-open")} onClick={onClose} aria-hidden="true" />
      <aside
        id={drawerId}
        ref={drawerRef}
        className={cn("shell-drawer", drawerOpen && "is-open")}
        role="dialog"
        aria-modal="true"
        aria-label="导航"
        aria-hidden={!drawerOpen}
      >
        <div className="shell-drawer__head">
          <div className="shell-drawer__brand">
            <BrandLogo className="shell-brand__logo" />
            <div>
              <strong className="shell-brand__text">奥皇 AI</strong>
              <p className="shell-drawer__sub">选择创作工具</p>
            </div>
          </div>
          <button type="button" className="shell-icon-button" onClick={onClose} aria-label="关闭导航">
            <X className="size-4" />
          </button>
        </div>

        <nav className="shell-drawer__nav">
          {workspaceToolGroups.map((group) => {
            const visibleItems = group.items
              .map((id) => workspaceToolById(id))
              .filter((item): item is WorkspaceToolEntry => Boolean(item?.visible && (!item.requiresAuth || isAuthenticated)));
            if (!visibleItems.length) return null;
            return (
              <section key={group.title} className="shell-nav__group">
                <h3 className="shell-nav__group-title">{group.title}</h3>
                <div className="shell-nav__items">
                  {visibleItems.map((item) => (
                    <ToolButton
                      key={item.id}
                      item={item}
                      active={activeTool.id === item.id}
                      showDescription
                      onClick={() => {
                        onSelect(item.action, item.id);
                        onClose();
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {!isAuthenticated ? (
            <Link href="/login" className="shell-drawer__link" onClick={onClose}>
              <UserRound className="size-4" />
              登录
            </Link>
          ) : null}

          {accountOpen ? (
            <div className="shell-account-menu">
              {workspaceAccountMenu.filter((item) => item.visible).map((item) => (
                <div key={item.id} className="shell-account-menu__item">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </div>
              ))}
            </div>
          ) : null}
        </nav>
      </aside>
    </>
  );
}

function ToolButton({
  item,
  active,
  compact,
  showDescription = true,
  onClick,
}: {
  item: WorkspaceToolEntry;
  active: boolean;
  compact?: boolean;
  showDescription?: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const SecondaryIcon = item.secondaryIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("shell-nav-item", active && "is-active", compact && "is-compact")}
      aria-current={active ? "page" : undefined}
    >
      <span className="shell-nav-item__icon-wrap" aria-hidden="true">
        <Icon className="shell-nav-item__icon" />
        {SecondaryIcon ? <SecondaryIcon className="shell-nav-item__icon-secondary" /> : null}
      </span>
      <span className={cn("shell-nav-item__text", compact && "sr-only")}>
        <span className="shell-nav-item__label">{item.label}</span>
        {showDescription ? <span className="shell-nav-item__desc">{item.description}</span> : null}
      </span>
    </button>
  );
}
