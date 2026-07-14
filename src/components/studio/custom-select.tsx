"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

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
