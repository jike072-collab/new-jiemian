"use client";

import { Command, CornerDownLeft, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { filterCanvasCommands, type CanvasCommandSearchItem } from "@/lib/canvas/commands";

export type CanvasCommand = CanvasCommandSearchItem & {
  icon: LucideIcon;
  shortcut?: string;
  run: () => void;
};

export function CanvasCommandPalette({ commands, onClose }: { commands: CanvasCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = useMemo(() => filterCanvasCommands(commands, query), [commands, query]);
  const safeActiveIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runCommand = (command: CanvasCommand | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div className="canvas-command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="canvas-command"
        role="dialog"
        aria-modal="true"
        aria-label="搜索节点和操作"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((value) => results.length ? (value + 1) % results.length : 0);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((value) => results.length ? (value - 1 + results.length) % results.length : 0);
          } else if (event.key === "Enter") {
            event.preventDefault();
            runCommand(results[safeActiveIndex]);
          }
        }}
      >
        <header className="canvas-command__search">
          <Search />
          <input
            ref={inputRef}
            value={query}
            aria-label="搜索节点和操作"
            placeholder="搜索节点、创建内容或执行操作"
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          />
          {query ? <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setQuery("")}><X /></button> : <kbd>Ctrl K</kbd>}
        </header>
        <div className="canvas-command__results" role="listbox" aria-label="命令结果">
          {results.map((command, index) => {
            const Icon = command.icon;
            const firstInGroup = index === 0 || results[index - 1]?.group !== command.group;
            return (
              <div key={command.id} className="canvas-command__row">
                {firstInGroup ? <span className="canvas-command__group">{command.group}</span> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={safeActiveIndex === index}
                  className={safeActiveIndex === index ? "is-active" : undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runCommand(command)}
                >
                  <span className="canvas-command__icon"><Icon /></span>
                  <span className="canvas-command__copy"><strong>{command.label}</strong>{command.description ? <small>{command.description}</small> : null}</span>
                  {command.shortcut ? <kbd>{command.shortcut}</kbd> : safeActiveIndex === index ? <CornerDownLeft /> : null}
                </button>
              </div>
            );
          })}
          {!results.length ? <div className="canvas-command__empty"><Command /><span>没有匹配的节点或操作</span></div> : null}
        </div>
        <footer className="canvas-command__footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 执行</span><span><kbd>Esc</kbd> 关闭</span></footer>
      </section>
    </div>
  );
}
