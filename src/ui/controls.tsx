// Shared form controls ported from CocoaCanvas: unit-aware scrub field,
// segmented control, toggle.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatNumber, parseQuantity, type Quantity } from "../core/units";

interface NumberFieldProps {
  value: number;
  onChange: (v: number, opts: { live: boolean }) => void;
  quantity?: Quantity;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
  autoFocus?: boolean;
}

/** `.nf` field: type "1 in", "10+5" etc.; drag the inner label to scrub. */
export function NumberField({ value, onChange, quantity = "length", label, min = -Infinity, max = Infinity, step = 1, title, autoFocus }: NumberFieldProps) {
  const unit = quantity === "angle" ? "°" : quantity === "length" ? " mm" : "";
  const fmt = (v: number) => formatNumber(v, 3) + unit;
  const [text, setText] = useState(fmt(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, quantity]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    try {
      const v = clamp(parseQuantity(text, quantity));
      setBad(false);
      setText(fmt(v));
      if (v !== value) onChange(v, { live: false });
    } catch {
      setBad(true);
    }
  };

  const scrub = (e: React.PointerEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const v0 = value;
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(Math.round((v0 + ((ev.clientX - x0) / 4) * step * k) * 1000) / 1000);
      onChange(v, { live: true });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <label className={`nf${label ? "" : " nolabel"}`} title={title}>
      {label ? <span onPointerDown={scrub}>{label}</span> : null}
      <input
        type="text"
        inputMode="decimal"
        className={bad ? "bad" : undefined}
        value={text}
        autoFocus={autoFocus}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setText(fmt(value));
            setBad(false);
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            onChange(clamp(value + (e.key === "ArrowUp" ? step : -step) * k), { live: false });
          }
          e.stopPropagation();
        }}
      />
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : undefined} role="radio" aria-checked={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="sw2">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fld">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}
