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
