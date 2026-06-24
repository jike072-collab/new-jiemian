"use client";

import Link from "next/link";
import {
  ChevronDown,
  CreditCard,
  LogIn,
  Menu,
  PanelLeft,
  PanelRight,
  UserRound,
  X,
} from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";

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
  canAccessAdmin?: boolean;
  accountName?: string | null;
  accountPointsLabel?: string | null;
  headerRightSlot?: ReactNode;
  accountSlot?: ReactNode;
  accountCloseSignal?: number;
  onOpenAccountCenter?: () => void;
  onOpenAccountRecharge?: () => void;
  parameterSlot: ReactNode;
  previewSlot: ReactNode;
  mobileActionSlot?: ReactNode;
  mobilePreviewSignal?: number;
  toolTitle?: string;
  contentMode?: "default" | "account";
};

export function WorkbenchShell({
  state,
  onToolAction,
  isAuthenticated,
  canAccessAdmin = false,
  accountName,
  accountPointsLabel,
  headerRightSlot,
  accountSlot,
  accountCloseSignal,
  onOpenAccountCenter,
  onOpenAccountRecharge,
  parameterSlot,
  previewSlot,
  mobileActionSlot,
  mobilePreviewSignal,
  toolTitle,
  contentMode = "default",
}: WorkbenchShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pane, setPane] = useState<ShellPane>("parameters");
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountPopoverVisible, setAccountPopoverVisible] = useState(false);
  const [accountPopoverClosing, setAccountPopoverClosing] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const desktopAccountRef = useRef<HTMLDivElement>(null);
  const lastAccountTriggerRef = useRef<HTMLElement | null>(null);
  const accountCloseTimerRef = useRef<number | null>(null);
  const previousOverflowRef = useRef("");

  const activeTool = workspaceToolById(state.activeToolId) || workspaceToolEntries[0];
  const drawerId = "workspace-mobile-drawer";
  const accountPopoverBaseId = useId();
  const desktopAccountPopoverId = `${accountPopoverBaseId}-desktop-account`;
  const headerAccountPopoverId = `${accountPopoverBaseId}-header-account`;
  const contentOnly = contentMode === "account";
  const singlePaneMobile = contentOnly || activeTool.id === "templates" || activeTool.id === "library";

  const openAccountPopover = useCallback((trigger?: HTMLElement | null) => {
    if (trigger) lastAccountTriggerRef.current = trigger;
    if (accountCloseTimerRef.current) {
      window.clearTimeout(accountCloseTimerRef.current);
      accountCloseTimerRef.current = null;
    }
    setAccountPopoverVisible(true);
    setAccountPopoverClosing(false);
    setAccountOpen(true);
  }, []);

  const closeAccountPopover = useCallback((options?: { restoreFocus?: boolean }) => {
    if (accountCloseTimerRef.current) {
      window.clearTimeout(accountCloseTimerRef.current);
      accountCloseTimerRef.current = null;
    }
    setAccountOpen(false);
    setAccountPopoverClosing(true);
    accountCloseTimerRef.current = window.setTimeout(() => {
      setAccountPopoverVisible(false);
      setAccountPopoverClosing(false);
      accountCloseTimerRef.current = null;
      if (options?.restoreFocus !== false) lastAccountTriggerRef.current?.focus();
    }, 140);
  }, []);

  const toggleAccountPopover = useCallback((trigger?: HTMLElement | null) => {
    if (accountOpen) {
      closeAccountPopover();
      return;
    }
    openAccountPopover(trigger);
  }, [accountOpen, closeAccountPopover, openAccountPopover]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPane(singlePaneMobile ? "preview" : "parameters");
    });
    rootRef.current?.querySelector<HTMLElement>("[data-shell-scroll='parameters']")?.scrollTo({ top: 0 });
    rootRef.current?.querySelector<HTMLElement>("[data-shell-scroll='preview']")?.scrollTo({ top: 0 });
    return () => window.cancelAnimationFrame(frame);
  }, [singlePaneMobile, state.activeToolId]);

  useEffect(() => {
    if (!mobilePreviewSignal) return;
    const frame = window.requestAnimationFrame(() => {
      setPane("preview");
      rootRef.current?.querySelector<HTMLElement>("[data-shell-scroll='preview']")?.scrollTo({ top: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobilePreviewSignal]);

  useEffect(() => {
    if (!accountCloseSignal) return;
    const frame = window.requestAnimationFrame(() => {
      closeAccountPopover({ restoreFocus: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [accountCloseSignal, closeAccountPopover]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      closeAccountPopover({ restoreFocus: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [closeAccountPopover, state.activeToolId, contentMode]);

  useEffect(() => {
    if (!accountOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const targetPopoverId = lastAccountTriggerRef.current?.closest(".shell-header")
        ? headerAccountPopoverId
        : desktopAccountPopoverId;
      const panel = rootRef.current?.querySelector<HTMLElement>(`#${CSS.escape(targetPopoverId)}`);
      const firstAction = panel?.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (firstAction || panel)?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element && target.closest(".account-popover-card, .shell-account")) return;
      if (desktopAccountRef.current?.contains(target)) return;
      closeAccountPopover();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAccountPopover();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen, desktopAccountPopoverId, headerAccountPopoverId, closeAccountPopover]);

  useEffect(() => {
    return () => {
      if (accountCloseTimerRef.current) {
        window.clearTimeout(accountCloseTimerRef.current);
        accountCloseTimerRef.current = null;
      }
    };
  }, []);

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
    <div
      ref={rootRef}
      className={cn(
        "shell-root min-h-[100dvh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]",
        !contentOnly && `shell-root--tool-${state.activeToolId}`,
        contentOnly && "shell-root--account-center",
      )}
    >
      <Header
        isAuthenticated={isAuthenticated}
        accountName={accountName}
        accountPointsLabel={accountPointsLabel}
        onToggleDrawer={() => setDrawerOpen((value) => !value)}
        onToggleAccount={toggleAccountPopover}
        onOpenAccountCenter={onOpenAccountCenter}
        accountOpen={accountOpen}
        accountPopoverVisible={accountPopoverVisible}
        accountPopoverClosing={accountPopoverClosing}
        headerRightSlot={headerRightSlot}
        accountSlot={accountSlot}
        accountPopoverId={headerAccountPopoverId}
        drawerButtonRef={drawerButtonRef}
        drawerId={drawerId}
        drawerOpen={drawerOpen}
      />

      <MobileOverlay
        activeTool={activeTool}
        drawerOpen={drawerOpen}
        pane={pane}
        singlePane={singlePaneMobile}
        accountCenterActive={contentOnly}
        onClose={() => setDrawerOpen(false)}
        onSelect={(action, tool) => {
          onToolAction(action, tool);
          setDrawerOpen(false);
        }}
        onChangePane={setPane}
        isAuthenticated={isAuthenticated}
        canAccessAdmin={canAccessAdmin}
        accountSlot={accountSlot}
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
            canAccessAdmin={canAccessAdmin}
            accountName={accountName}
            accountPointsLabel={accountPointsLabel}
            accountOpen={accountOpen}
            accountPopoverVisible={accountPopoverVisible}
            accountPopoverClosing={accountPopoverClosing}
            accountCenterActive={contentOnly}
            accountSlot={accountSlot}
            accountPopoverId={desktopAccountPopoverId}
            accountContainerRef={desktopAccountRef}
            onToggleAccount={toggleAccountPopover}
            onOpenAccountCenter={onOpenAccountCenter}
            onOpenAccountRecharge={onOpenAccountRecharge}
          />

          <section className={cn("shell-panel shell-panel--controls", singlePaneMobile && "shell-panel--mobile-single-hidden")}>
            <div className="shell-panel__header shell-panel__header--tool">
              <div>
                <h2 className="shell-title">{toolTitle || activeTool.label}</h2>
              </div>
            </div>
            <div id="shell-parameters-panel" data-shell-scroll="parameters" className="shell-panel__body">
              {parameterSlot}
            </div>
          </section>

          <section className={cn("shell-panel shell-panel--preview", singlePaneMobile && "shell-panel--mobile-single")}>
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
  accountName,
  accountPointsLabel,
  onToggleDrawer,
  onToggleAccount,
  onOpenAccountCenter,
  accountOpen,
  accountPopoverVisible,
  accountPopoverClosing,
  headerRightSlot,
  accountSlot,
  accountPopoverId,
  drawerButtonRef,
  drawerId,
  drawerOpen,
}: {
  isAuthenticated: boolean;
  accountName?: string | null;
  accountPointsLabel?: string | null;
  onToggleDrawer: () => void;
  onToggleAccount: (trigger?: HTMLElement | null) => void;
  onOpenAccountCenter?: () => void;
  accountOpen: boolean;
  accountPopoverVisible: boolean;
  accountPopoverClosing: boolean;
  headerRightSlot?: ReactNode;
  accountSlot?: ReactNode;
  accountPopoverId: string;
  drawerButtonRef: RefObject<HTMLButtonElement | null>;
  drawerId: string;
  drawerOpen: boolean;
}) {
  return (
    <header className="shell-header relative">
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
          <button
            type="button"
            className="shell-account"
            onClick={(event) => {
              if (accountSlot) {
                onToggleAccount(event.currentTarget);
                return;
              }
              onOpenAccountCenter?.();
            }}
            title={accountName || "账户"}
            aria-haspopup={accountSlot ? "dialog" : undefined}
            aria-expanded={accountSlot ? accountOpen : undefined}
            aria-controls={accountSlot && accountPopoverVisible ? accountPopoverId : undefined}
          >
            <span className="shell-account__avatar">{(accountName || "账户").slice(0, 2).toUpperCase()}</span>
            <span className="shell-account__meta">
              <span className="shell-account__name">{accountName || "账户"}</span>
              <span className="shell-account__points">{accountPointsLabel || "—"}</span>
            </span>
            {accountSlot ? <ChevronDown className={cn("size-4 transition", accountOpen && "rotate-180")} /> : null}
          </button>
        ) : (
          <Link href="/login" className="shell-login">
            <UserRound className="size-4" />
            登录
          </Link>
        )}
      </div>

      {isAuthenticated && accountSlot && accountPopoverVisible ? (
        <div
          id={accountPopoverId}
          className={cn("shell-header-account__popover", accountPopoverClosing && "is-closing")}
          role="dialog"
          aria-label="快捷账户面板"
          tabIndex={-1}
        >
          {accountSlot}
        </div>
      ) : null}

    </header>
  );
}

function DesktopNavigation({
  activeToolId,
  onSelect,
  groups,
  isAuthenticated,
  canAccessAdmin,
  accountName,
  accountPointsLabel,
  accountOpen,
  accountPopoverVisible,
  accountPopoverClosing,
  accountCenterActive,
  accountSlot,
  accountPopoverId,
  accountContainerRef,
  onToggleAccount,
  onOpenAccountCenter,
  onOpenAccountRecharge,
}: {
  activeToolId: WorkspaceToolId;
  onSelect: (action: WorkspaceAction, tool: WorkspaceToolId) => void;
  groups: Array<{ title: WorkspaceToolGroup; items: WorkspaceToolId[] }>;
  isAuthenticated: boolean;
  canAccessAdmin: boolean;
  accountName?: string | null;
  accountPointsLabel?: string | null;
  accountOpen: boolean;
  accountPopoverVisible: boolean;
  accountPopoverClosing: boolean;
  accountCenterActive: boolean;
  accountSlot?: ReactNode;
  accountPopoverId: string;
  accountContainerRef: RefObject<HTMLDivElement | null>;
  onToggleAccount: (trigger?: HTMLElement | null) => void;
  onOpenAccountCenter?: () => void;
  onOpenAccountRecharge?: () => void;
}) {
  const displayName = accountName || "账户";
  const avatarText = displayName.slice(0, 2).toUpperCase();

  return (
    <aside className="shell-nav" aria-label="工作台导航">
      <Link href="/?preview=1" className="shell-nav__brand" aria-label="奥皇 AI 工作台">
        <BrandLogo className="shell-nav__brand-logo" />
        <span className="shell-nav__brand-copy">
          <strong>奥皇 AI</strong>
          <small>AI VISUAL STUDIO</small>
        </span>
      </Link>

      <nav className="shell-nav__scroll" aria-label="功能导航">
        <div className="shell-nav__groups">
          {groups.map((group) => {
            const visibleItems = group.items
              .map((id) => workspaceToolById(id))
              .filter((item): item is WorkspaceToolEntry => canShowWorkspaceTool(item, { isAuthenticated, canAccessAdmin }));
            if (!visibleItems.length) return null;
            return (
              <section key={group.title} className="shell-nav__group">
                <h3 className="shell-nav__group-title">{group.title}</h3>
                <div className="shell-nav__items">
                  {visibleItems.map((item) => (
                    <ToolButton
                      key={item.id}
                      item={item}
                      active={!accountCenterActive && activeToolId === item.id}
                      showDescription={false}
                      onClick={() => onSelect(item.action, item.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </nav>

      <div
        ref={accountContainerRef}
        className={cn("shell-nav__account", isAuthenticated && accountOpen && "is-open", accountCenterActive && "is-active")}
        aria-label="账户状态"
      >
        {isAuthenticated ? (
          <>
            <button
              type="button"
              className="shell-nav-account__main shell-nav-account__main--button"
              onClick={(event) => {
                if (accountSlot) {
                  onToggleAccount(event.currentTarget);
                  return;
                }
                onOpenAccountCenter?.();
              }}
              aria-haspopup={accountSlot ? "dialog" : undefined}
              aria-expanded={accountSlot ? accountOpen : undefined}
              aria-controls={accountSlot && accountPopoverVisible ? accountPopoverId : undefined}
            >
              <span className="shell-nav-account__avatar">{avatarText}</span>
              <span className="shell-nav-account__copy">
                <strong>{displayName}</strong>
                <span>剩余积分 {accountPointsLabel || "—"}</span>
              </span>
            </button>
            <div className="shell-nav-account__actions is-split">
              <button
                type="button"
                className={cn("shell-nav-account__button", accountCenterActive && "is-active")}
                onClick={onOpenAccountCenter || ((event) => onToggleAccount(event.currentTarget))}
              >
                <UserRound className="size-4" aria-hidden="true" />
                用户中心
              </button>
              <button type="button" className="shell-nav-account__button shell-nav-account__button--primary" onClick={onOpenAccountRecharge || ((event) => onToggleAccount(event.currentTarget))}>
                <CreditCard className="size-4" aria-hidden="true" />
                充值
              </button>
            </div>
            {accountSlot && accountPopoverVisible ? (
              <div
                id={accountPopoverId}
                className={cn("shell-nav-account__popover", accountPopoverClosing && "is-closing")}
                role="dialog"
                aria-label="快捷账户面板"
                tabIndex={-1}
              >
                {accountSlot}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="shell-nav-account__main">
              <span className="shell-nav-account__avatar">
                <UserRound className="size-4" aria-hidden="true" />
              </span>
              <span className="shell-nav-account__copy">
                <strong>未登录</strong>
                <span>登录后查看额度与作品</span>
              </span>
            </div>
            <Link href="/login" className="shell-nav-account__button">
              <LogIn className="size-4" aria-hidden="true" />
              登录
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}

function MobileOverlay({
  activeTool,
  drawerOpen,
  pane,
  singlePane,
  accountCenterActive,
  onClose,
  onSelect,
  onChangePane,
  isAuthenticated,
  canAccessAdmin,
  accountSlot,
  accountOpen,
  mobileActionSlot,
  drawerRef,
  drawerId,
}: {
  activeTool: WorkspaceToolEntry;
  drawerOpen: boolean;
  pane: ShellPane;
  singlePane: boolean;
  accountCenterActive: boolean;
  onClose: () => void;
  onSelect: (action: WorkspaceAction, tool: WorkspaceToolId) => void;
  onChangePane: (value: ShellPane) => void;
  isAuthenticated: boolean;
  canAccessAdmin: boolean;
  accountSlot?: ReactNode;
  accountOpen: boolean;
  mobileActionSlot?: ReactNode;
  drawerRef: RefObject<HTMLDivElement | null>;
  drawerId: string;
}) {
  const parametersTabLabel = activeTool.id === "templates" || activeTool.id === "library" ? "选项" : "参数";

  return (
    <>
      <div className={cn("shell-mobile-tabs", singlePane && "is-single-pane")}>
        <div className="shell-mobile-tabs__left">
          <span className="shell-eyebrow">当前工具</span>
          <strong className="shell-mobile-tabs__title">{activeTool.label}</strong>
        </div>
        {!singlePane ? <div className="shell-mobile-tabs__switch" role="tablist" aria-label="参数和预览视图">
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
            {parametersTabLabel}
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
        </div> : null}
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
              .filter((item): item is WorkspaceToolEntry => canShowWorkspaceTool(item, { isAuthenticated, canAccessAdmin }));
            if (!visibleItems.length) return null;
            return (
              <section key={group.title} className="shell-nav__group">
                <h3 className="shell-nav__group-title">{group.title}</h3>
                <div className="shell-nav__items">
                  {visibleItems.map((item) => (
                    <ToolButton
                      key={item.id}
                      item={item}
                      active={!accountCenterActive && activeTool.id === item.id}
                      showDescription={false}
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
            accountSlot ? (
              accountSlot
            ) : (
              <div className="shell-account-menu">
                {workspaceAccountMenu.filter((item) => item.visible).map((item) => (
                  <div key={item.id} className="shell-account-menu__item">
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </nav>
      </aside>
    </>
  );
}

function canShowWorkspaceTool(
  item: WorkspaceToolEntry | null | undefined,
  auth: { isAuthenticated: boolean; canAccessAdmin: boolean },
): item is WorkspaceToolEntry {
  if (!item) return false;
  if (item.requiresAuth && !auth.isAuthenticated) return false;
  if (item.id === "admin-settings") return auth.canAccessAdmin;
  return item.visible;
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
      <span className="shell-nav-item__indicator" aria-hidden="true" />
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
