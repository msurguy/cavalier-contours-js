/** Hand-rolled sidebar control builders (no UI libraries). */

export function controlGroup(root: HTMLElement, title: string): HTMLElement {
  const group = document.createElement("div");
  group.className = "ctl-group";
  const head = document.createElement("div");
  head.className = "ctl-group-title";
  head.textContent = title;
  group.appendChild(head);
  root.appendChild(group);
  return group;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}

export interface SliderHandle {
  set(v: number): void;
}

export function slider(root: HTMLElement, opts: SliderOptions): SliderHandle {
  const wrap = document.createElement("label");
  wrap.className = "ctl ctl-slider";
  const fmt = opts.format ?? ((v: number) => v.toString());

  const row = document.createElement("div");
  row.className = "ctl-label-row";
  const label = document.createElement("span");
  label.className = "ctl-label";
  label.textContent = opts.label;
  const value = document.createElement("span");
  value.className = "ctl-value";
  value.textContent = fmt(opts.value);
  row.append(label, value);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    value.textContent = fmt(v);
    opts.onInput(v);
  });

  wrap.append(row, input);
  root.appendChild(wrap);
  return {
    set(v: number) {
      input.value = String(v);
      value.textContent = fmt(v);
    },
  };
}

export function checkbox(
  root: HTMLElement,
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): void {
  const wrap = document.createElement("label");
  wrap.className = "ctl ctl-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const box = document.createElement("span");
  box.className = "check-box";
  const text = document.createElement("span");
  text.className = "ctl-label";
  text.textContent = label;
  wrap.append(input, box, text);
  root.appendChild(wrap);
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export function segmented<T extends string>(
  root: HTMLElement,
  options: readonly SegmentedOption<T>[],
  value: T,
  onChange: (v: T) => void,
): void {
  const wrap = document.createElement("div");
  wrap.className = "ctl ctl-segmented";
  wrap.setAttribute("role", "radiogroup");
  const buttons = new Map<T, HTMLButtonElement>();
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = opt.label;
    if (opt.hint) btn.title = opt.hint;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(opt.value === value));
    if (opt.value === value) btn.classList.add("active");
    btn.addEventListener("click", () => {
      for (const [v, b] of buttons) {
        b.classList.toggle("active", v === opt.value);
        b.setAttribute("aria-checked", String(v === opt.value));
      }
      onChange(opt.value);
    });
    buttons.set(opt.value, btn);
    wrap.appendChild(btn);
  }
  root.appendChild(wrap);
}

/** A full-width action button (blueprint style). Returns the element for later tweaks. */
export function button(
  root: HTMLElement,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ctl ctl-button";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  root.appendChild(btn);
  return btn;
}

/**
 * A styled file-picker button. The native input is hidden; clicking the label
 * opens the file dialog. `onFile` fires with the chosen File (input is reset so
 * re-picking the same file fires again).
 */
export function fileButton(
  root: HTMLElement,
  label: string,
  accept: string,
  onFile: (file: File) => void,
): void {
  const wrap = document.createElement("label");
  wrap.className = "ctl ctl-button ctl-file";
  wrap.tabIndex = 0;
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) onFile(file);
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  wrap.append(text, input);
  root.appendChild(wrap);
}

export interface ColorHandle {
  set(v: string): void;
}

/** A labelled color swatch backed by a native `<input type="color">`. */
export function colorPicker(
  root: HTMLElement,
  label: string,
  value: string,
  onChange: (v: string) => void,
): ColorHandle {
  const wrap = document.createElement("label");
  wrap.className = "ctl ctl-color";
  const text = document.createElement("span");
  text.className = "ctl-label";
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  wrap.append(text, input);
  root.appendChild(wrap);
  return {
    set(v: string) {
      input.value = v;
    },
  };
}

export interface VirtualListOptions<T> {
  items: readonly T[];
  /** Fixed pixel height of every row (required for windowing). */
  rowHeight: number;
  /** Max pixel height of the scroll viewport before it scrolls. */
  maxHeight: number;
  /** Extra rows rendered above/below the viewport to smooth scrolling. */
  overscan?: number;
  /** Populate a (recycled) row element for `items[index]`. */
  renderRow: (item: T, index: number, row: HTMLElement) => void;
}

export interface VirtualListHandle {
  el: HTMLElement;
  /** Re-render the currently mounted rows in place (after external state changes). */
  refresh(): void;
}

/**
 * A windowed (virtualized) scroll list: only the rows near the viewport are in
 * the DOM, so a list of thousands of items stays light. Rows are absolutely
 * positioned inside a full-height spacer; content is (re)built by `renderRow`
 * whenever a row scrolls into view or `refresh()` is called.
 */
export function virtualList<T>(root: HTMLElement, opts: VirtualListOptions<T>): VirtualListHandle {
  const overscan = opts.overscan ?? 4;
  const viewport = document.createElement("div");
  viewport.className = "vlist";
  viewport.style.maxHeight = `${opts.maxHeight}px`;

  const spacer = document.createElement("div");
  spacer.className = "vlist-spacer";
  spacer.style.height = `${opts.items.length * opts.rowHeight}px`;
  viewport.appendChild(spacer);

  const mounted = new Map<number, HTMLElement>();

  const render = (): void => {
    const scrollTop = viewport.scrollTop;
    const h = viewport.clientHeight || opts.maxHeight;
    const start = Math.max(0, Math.floor(scrollTop / opts.rowHeight) - overscan);
    const end = Math.min(
      opts.items.length,
      Math.ceil((scrollTop + h) / opts.rowHeight) + overscan,
    );
    for (const [idx, el] of mounted) {
      if (idx < start || idx >= end) {
        el.remove();
        mounted.delete(idx);
      }
    }
    for (let i = start; i < end; i++) {
      let el = mounted.get(i);
      if (!el) {
        el = document.createElement("div");
        el.className = "vlist-row";
        el.style.top = `${i * opts.rowHeight}px`;
        el.style.height = `${opts.rowHeight}px`;
        spacer.appendChild(el);
        mounted.set(i, el);
      }
      el.replaceChildren();
      opts.renderRow(opts.items[i]!, i, el);
    }
  };

  viewport.addEventListener("scroll", render, { passive: true });
  root.appendChild(viewport);
  render();
  // clientHeight can be 0 until laid out; re-render once on the next frame.
  requestAnimationFrame(render);

  return {
    el: viewport,
    refresh() {
      for (const [i, el] of mounted) {
        el.replaceChildren();
        opts.renderRow(opts.items[i]!, i, el);
      }
    },
  };
}

/** A short explanatory / empty-state line. */
export function note(root: HTMLElement, text: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "ctl-note";
  el.textContent = text;
  root.appendChild(el);
  return el;
}

export function legend(root: HTMLElement, entries: readonly [color: string, label: string][]): void {
  const wrap = document.createElement("div");
  wrap.className = "ctl-legend";
  for (const [color, label] of entries) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = color;
    const text = document.createElement("span");
    text.textContent = label;
    item.append(swatch, text);
    wrap.appendChild(item);
  }
  root.appendChild(wrap);
}
