"use client";

import { Keyboard, MousePointer2, X } from "lucide-react";

const shortcutGroups = [
  {
    title: "画布与选择",
    items: [
      { label: "框选多个节点", keys: ["拖动空白处"] },
      { label: "移动画布", keys: ["Space", "+", "拖动"] },
      { label: "移动画布", keys: ["中键拖动 / 滚轮"] },
      { label: "追加或取消选中", keys: ["Ctrl / ⌘ / Shift", "+", "点击节点"] },
      { label: "选择全部节点", keys: ["Ctrl / ⌘", "+", "A"] },
      { label: "适应选中或查看全部", keys: ["."] },
      { label: "清除选择或关闭面板", keys: ["Esc"] },
      { label: "打开快捷菜单", keys: ["右键"] },
      { label: "搜索节点与操作", keys: ["Ctrl / ⌘", "+", "K"] },
    ],
  },
  {
    title: "节点编辑",
    items: [
      { label: "复制选中节点", keys: ["Ctrl / ⌘", "+", "C"] },
      { label: "粘贴节点、文字或图片", keys: ["Ctrl / ⌘", "+", "V"] },
      { label: "重复选中节点", keys: ["Ctrl / ⌘", "+", "D"] },
      { label: "组合选中节点", keys: ["Ctrl / ⌘", "+", "G"] },
      { label: "删除选中节点", keys: ["Delete / Backspace"] },
      { label: "空白处快速添加", keys: ["双击空白处"] },
      { label: "微移 1 像素", keys: ["方向键"] },
      { label: "微移 10 像素", keys: ["Shift", "+", "方向键"] },
    ],
  },
  {
    title: "历史与文件",
    items: [
      { label: "撤销", keys: ["Ctrl / ⌘", "+", "Z"] },
      { label: "重做", keys: ["Ctrl / ⌘", "+", "Y"] },
      { label: "另一种重做", keys: ["Ctrl / ⌘", "+", "Shift", "+", "Z"] },
      { label: "保存画布", keys: ["Ctrl / ⌘", "+", "S"] },
      { label: "导出画布图片", keys: ["Ctrl / ⌘", "+", "Shift", "+", "E"] },
      { label: "打开本面板", keys: ["?"] },
    ],
  },
] as const;

export function CanvasShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="canvas-shortcuts" role="dialog" aria-modal="false" aria-label="画布操作与快捷键">
      <header className="canvas-shortcuts__header">
        <div><Keyboard /><span><strong>操作与快捷键</strong><small>鼠标、键盘与触控操作</small></span></div>
        <button type="button" className="canvas-icon-button" onClick={onClose} aria-label="关闭快捷键" title="关闭快捷键"><X /></button>
      </header>
      <div className="canvas-shortcuts__content">
        {shortcutGroups.map((group) => (
          <section key={group.title} className="canvas-shortcuts__group">
            <h3>{group.title}</h3>
            <dl>
              {group.items.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.keys.map((key, index) => key === "+" ? <span key={`${key}-${index}`}>+</span> : <kbd key={`${key}-${index}`}>{key}</kbd>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="canvas-shortcuts__touch">触屏设备可点击底部“多选”图标逐个点选节点；图片和视频可直接拖入画布。</p>
      </div>
    </aside>
  );
}

export function CanvasSelectionHint({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className="canvas-selection-hint" role="status">
      <MousePointer2 />
      <button type="button" onClick={onOpen}><strong>拖动空白处框选</strong></button>
      <button type="button" className="canvas-selection-hint__close" onClick={onDismiss} aria-label="关闭框选提示" title="关闭框选提示"><X /></button>
    </div>
  );
}
