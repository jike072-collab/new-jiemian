"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

import type { SelectOption } from "./types";
import { cn } from "@/lib/utils";

export function CustomSelect({
  label,
  value,
  options,
  icon,
  disabled,
  placeholder = "请选择",
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  icon?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const listId = `${generatedId}-listbox`;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const availableBelow = window.innerHeight - rect.bottom;
      setOpenAbove(availableBelow < 280 && rect.top > availableBelow);
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [selectedIndex]);

  const enabledOptions = options.filter((option) => !option.disabled);
  const chooseOption = useCallback((option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }, [onChange]);

  const moveActive = useCallback((direction: 1 | -1) => {
    if (!enabledOptions.length) return;
    const currentValue = options[activeIndex]?.value;
    const enabledIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === currentValue));
    const nextEnabled = enabledOptions[(enabledIndex + direction + enabledOptions.length) % enabledOptions.length];
    const nextIndex = options.findIndex((option) => option.value === nextEnabled.value);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [activeIndex, enabledOptions, options]);

  return (
    <div className={cn("studio-custom-select", open && "is-open")}>
      <button
        ref={buttonRef}
        type="button"
        className="studio-custom-select__button"
        disabled={disabled || !options.length}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) openMenu();
            moveActive(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            moveActive(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            const option = options[activeIndex];
            if (option) chooseOption(option);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        {icon ? <span className="studio-custom-select__icon" aria-hidden="true">{icon}</span> : null}
        <span className="studio-custom-select__value">
          <span>{selectedOption?.label || placeholder}</span>
          {selectedOption?.description ? <small>{selectedOption.description}</small> : null}
        </span>
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div
        ref={listRef}
        id={listId}
        className={cn("studio-custom-select__menu", openAbove && "is-above")}
        role="listbox"
        aria-label={label}
        aria-hidden={!open}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const active = index === activeIndex;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              tabIndex={open ? 0 : -1}
              className={cn("studio-custom-select__option", selected && "is-selected", active && "is-active")}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                chooseOption(option);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                chooseOption(option);
              }}
              onClick={() => chooseOption(option)}
            >
              <span className="studio-custom-select__option-copy">
                <span>{option.label}</span>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              {selected ? <Check className="size-4" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type HierarchicalSelectItem =
  | { type: "option"; option: SelectOption }
  | { type: "group"; value: string; label: string; options: SelectOption[] };

function focusMenuItem(current: HTMLButtonElement, direction: 1 | -1) {
  const menu = current.closest<HTMLElement>("[role='menu']");
  if (!menu) return;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled), :scope > .studio-hierarchical-select__group > button:not(:disabled)"));
  const currentIndex = items.indexOf(current);
  const nextIndex = (Math.max(0, currentIndex) + direction + items.length) % items.length;
  items[nextIndex]?.focus();
}

export function HierarchicalSelect({
  label,
  value,
  items,
  disabled,
  placeholder = "请选择",
  onChange,
}: {
  label: string;
  value: string;
  items: HierarchicalSelectItem[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const flyoutTriggerRef = useRef<HTMLButtonElement | null>(null);
  const flyoutOptionsRef = useRef<SelectOption[]>([]);
  const closeGroupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [desktopFlyout, setDesktopFlyout] = useState(false);
  const [flyoutStyle, setFlyoutStyle] = useState<React.CSSProperties>();
  const allOptions = items.flatMap((item) => item.type === "group" ? item.options : [item.option]);
  const selectedOption = allOptions.find((option) => option.value === value) || null;
  const menuId = `${generatedId}-menu`;

  const closeMenu = useCallback(() => {
    setOpen(false);
    setOpenGroup(null);
    flyoutTriggerRef.current = null;
    flyoutOptionsRef.current = [];
  }, []);

  const cancelGroupClose = useCallback(() => {
    if (!closeGroupTimerRef.current) return;
    clearTimeout(closeGroupTimerRef.current);
    closeGroupTimerRef.current = null;
  }, []);

  const scheduleGroupClose = useCallback(() => {
    cancelGroupClose();
    closeGroupTimerRef.current = setTimeout(() => setOpenGroup(null), 140);
  }, [cancelGroupClose]);

  const positionFlyout = useCallback((trigger: HTMLButtonElement, options: SelectOption[]) => {
    const rect = trigger.getBoundingClientRect();
    const edge = 12;
    const gap = 6;
    const context = document.createElement("canvas").getContext("2d");
    const triggerStyle = window.getComputedStyle(trigger);
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const measure = (text: string, font: string) => {
      if (!context) return text.length * rootFontSize * 0.75;
      context.font = font;
      return context.measureText(text).width;
    };
    const labelFont = triggerStyle.font;
    const descriptionFont = `500 ${rootFontSize * 0.75}px ${triggerStyle.fontFamily}`;
    const contentWidth = options.reduce((longest, option) => {
      return Math.max(
        longest,
        measure(option.label, labelFont),
        option.description ? measure(option.description, descriptionFont) : 0,
      );
    }, 0);
    const preferredWidth = Math.min(520, Math.max(280, Math.ceil(contentWidth + 32)));
    const rightSpace = window.innerWidth - rect.right - gap - edge;
    const leftSpace = rect.left - gap - edge;
    const openToRight = rightSpace >= Math.min(360, preferredWidth) || rightSpace >= leftSpace;
    const availableWidth = openToRight ? rightSpace : leftSpace;
    const width = Math.max(280, Math.min(preferredWidth, availableWidth));
    const left = openToRight
      ? Math.min(rect.right + gap, window.innerWidth - edge - width)
      : Math.max(edge, rect.left - gap - width);
    const maxHeight = Math.min(560, window.innerHeight * 0.72);
    const top = Math.max(edge, Math.min(rect.top - 5, window.innerHeight - edge - maxHeight));
    setFlyoutStyle({
      position: "fixed",
      zIndex: 1000,
      top,
      left,
      width,
      maxHeight,
      opacity: 1,
      pointerEvents: "auto",
      transform: "none",
    });
  }, []);

  const showGroup = useCallback((group: string, trigger: HTMLButtonElement, options: SelectOption[]) => {
    cancelGroupClose();
    flyoutTriggerRef.current = trigger;
    flyoutOptionsRef.current = options;
    if (desktopFlyout) positionFlyout(trigger, options);
    setOpenGroup(group);
  }, [cancelGroupClose, desktopFlyout, positionFlyout]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktopFlyout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!desktopFlyout || !openGroup) return undefined;
    const update = () => {
      if (flyoutTriggerRef.current) positionFlyout(flyoutTriggerRef.current, flyoutOptionsRef.current);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [desktopFlyout, openGroup, positionFlyout]);

  useEffect(() => () => cancelGroupClose(), [cancelGroupClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) || flyoutRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeMenu, open]);

  const openMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const availableBelow = window.innerHeight - rect.bottom;
      setOpenAbove(availableBelow < 320 && rect.top > availableBelow);
    }
    setOpen(true);
  }, []);

  const chooseOption = useCallback((option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu();
    buttonRef.current?.focus();
  }, [closeMenu, onChange]);

  const focusFirstMainItem = useCallback(() => {
    requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>(".studio-custom-select__menu > button, .studio-custom-select__menu > .studio-hierarchical-select__group > button")?.focus();
    });
  }, []);

  return (
    <div ref={rootRef} className={cn("studio-custom-select studio-hierarchical-select", open && "is-open")}>
      <button
        ref={buttonRef}
        type="button"
        className="studio-custom-select__button"
        disabled={disabled || !allOptions.length}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (open) closeMenu();
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) openMenu();
            focusFirstMainItem();
          } else if (event.key === "Escape") {
            closeMenu();
          }
        }}
      >
        <span className="studio-custom-select__value">
          <span>{selectedOption?.label || placeholder}</span>
        </span>
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div
        id={menuId}
        className={cn("studio-custom-select__menu", openAbove && "is-above")}
        role="menu"
        aria-label={label}
        aria-hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (openGroup) setOpenGroup(null);
            else {
              closeMenu();
              buttonRef.current?.focus();
            }
          }
        }}
      >
        {items.map((item, itemIndex) => {
          if (item.type === "option") {
            const selected = item.option.value === value;
            return (
              <button
                key={item.option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={item.option.disabled}
                tabIndex={open ? 0 : -1}
              className={cn("studio-custom-select__option", selected && "is-selected")}
                onPointerEnter={() => setOpenGroup(null)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    focusMenuItem(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
                  }
                }}
                onClick={() => chooseOption(item.option)}
              >
                <span className="studio-custom-select__option-copy">
                  <span>{item.option.label}</span>
                  {item.option.description ? <small>{item.option.description}</small> : null}
                </span>
                {selected ? <Check className="size-4" aria-hidden="true" /> : null}
              </button>
            );
          }

          const selected = item.options.some((option) => option.value === value);
          const groupOpen = openGroup === item.value;
          const groupId = `${generatedId}-group-${itemIndex}`;
          const submenu = (
            <div
              ref={desktopFlyout ? flyoutRef : undefined}
              id={`${groupId}-menu`}
              className={cn("studio-hierarchical-select__submenu", desktopFlyout && "is-portal")}
              role="menu"
              aria-label={`${item.label} 模型`}
              aria-hidden={!groupOpen}
              style={desktopFlyout ? flyoutStyle : undefined}
              onPointerEnter={cancelGroupClose}
              onPointerLeave={scheduleGroupClose}
            >
              {item.options.map((option) => {
                const optionSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={optionSelected}
                    disabled={option.disabled}
                    tabIndex={open && groupOpen ? 0 : -1}
                    className={cn("studio-custom-select__option", optionSelected && "is-selected")}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        focusMenuItem(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
                      } else if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        setOpenGroup(null);
                        document.getElementById(`${groupId}-trigger`)?.focus();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setOpenGroup(null);
                        document.getElementById(`${groupId}-trigger`)?.focus();
                      }
                    }}
                    onClick={() => chooseOption(option)}
                  >
                    <span className="studio-custom-select__option-copy">
                      <span>{option.label}</span>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>
                    {optionSelected ? <Check className="size-4" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          );
          return (
            <div
              key={item.value}
              className={cn("studio-hierarchical-select__group", groupOpen && "is-open")}
              onPointerEnter={(event) => showGroup(item.value, event.currentTarget.querySelector("button") as HTMLButtonElement, item.options)}
              onPointerLeave={scheduleGroupClose}
            >
              <button
                id={`${groupId}-trigger`}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={groupOpen}
                aria-controls={`${groupId}-menu`}
                tabIndex={open ? 0 : -1}
                className={cn("studio-custom-select__option studio-hierarchical-select__group-trigger", selected && "is-selected")}
                onClick={(event) => {
                  if (groupOpen) setOpenGroup(null);
                  else showGroup(item.value, event.currentTarget, item.options);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    focusMenuItem(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
                  } else if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    showGroup(item.value, event.currentTarget, item.options);
                    requestAnimationFrame(() => document.getElementById(`${groupId}-menu`)?.querySelector<HTMLButtonElement>("button")?.focus());
                  }
                }}
              >
                <span>{item.label}</span>
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
              {desktopFlyout
                ? (open && groupOpen && typeof document !== "undefined" ? createPortal(submenu, document.body) : null)
                : submenu}
            </div>
          );
        })}
      </div>
    </div>
  );
}
