// Unit-aware numeric input: "25", "25 mm", "1 in", "2.5cm + 3", "(10+2)*3 mm".
// The document unit is millimetres; parse() returns mm (or degrees for angles).

export type Quantity = "length" | "angle" | "count";

const LENGTH: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  '"': 25.4,
  ft: 304.8,
  "'": 304.8,
  мм: 1,
  см: 10,
  м: 1000,
};
const ANGLE: Record<string, number> = { deg: 1, "°": 1, rad: 180 / Math.PI, град: 1 };

type Tok = { k: "num"; v: number } | { k: "op"; v: string } | { k: "unit"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src.trim().replace(/,/g, ".");
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      out.push({ k: "num", v: parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }
    if ("+-*/()".includes(ch)) {
      out.push({ k: "op", v: ch });
      i++;
      continue;
    }
    const unit = /^([a-zа-я]+|°|"|')/i.exec(s.slice(i));
    if (unit) {
      out.push({ k: "unit", v: unit[0].toLowerCase() });
      i += unit[0].length;
      continue;
    }
    throw new Error(`Unexpected "${ch}"`);
  }
  return out;
}

/** Recursive-descent evaluator; no eval(). */
export function parseQuantity(src: string, q: Quantity = "length"): number {
  const toks = tokenize(src);
  let p = 0;
  const table = q === "angle" ? ANGLE : q === "length" ? LENGTH : {};

  const peek = () => toks[p];
  function primary(): number {
    const t = toks[p++];
    if (!t) throw new Error("Incomplete expression");
    let v: number;
    if (t.k === "num") v = t.v;
    else if (t.k === "op" && t.v === "(") {
      v = expr();
      const close = toks[p++];
      if (!close || close.k !== "op" || close.v !== ")") throw new Error("Missing )");
    } else if (t.k === "op" && t.v === "-") return -primary();
    else if (t.k === "op" && t.v === "+") return primary();
    else throw new Error("Expected a number");
    const u = peek();
    if (u && u.k === "unit") {
      const f = table[u.v];
      if (f === undefined) throw new Error(`Unknown unit "${u.v}"`);
      v *= f;
      p++;
    }
    return v;
  }
  function term(): number {
    let v = primary();
    for (;;) {
      const t = peek();
      if (t?.k === "op" && (t.v === "*" || t.v === "/")) {
        p++;
        const r = primary();
        v = t.v === "*" ? v * r : v / r;
      } else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      const t = peek();
      if (t?.k === "op" && (t.v === "+" || t.v === "-")) {
        p++;
        const r = term();
        v = t.v === "+" ? v + r : v - r;
      } else return v;
    }
  }
  const v = expr();
  if (p !== toks.length) throw new Error("Unexpected input");
  if (!Number.isFinite(v)) throw new Error("Not a finite number");
  return v;
}

export function formatQuantity(v: number, q: Quantity = "length", digits = 3): string {
  const n = Number(v.toFixed(digits)).toString();
  if (q === "length") return `${n} mm`;
  if (q === "angle") return `${n}°`;
  return n;
}

export function formatNumber(v: number, digits = 2): string {
  return Number(v.toFixed(digits)).toString();
}
