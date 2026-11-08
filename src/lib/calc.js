// Arithmetic for the agent: a model adding twelve numbers in its head gets 291 for 300. A small parser, no eval.

/** The value of an expression of numbers, + - * / %, parentheses; throws on anything else. */
export function calculate(expression) {
  const src = String(expression ?? "").replace(/\s+/g, "").replace(/,(?=\d)/g, ".");
  if (!src || src.length > 2000) throw new Error("Not an arithmetic expression.");
  let i = 0;
  const atom = () => {
    if (src[i] === "-") { i++; return -atom(); }
    if (src[i] === "+") { i++; return atom(); }
    if (src[i] === "(") {
      i++;
      const v = sum();
      if (src[i] !== ")") throw new Error("Missing closing parenthesis.");
      i++;
      return v;
    }
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) throw new Error(`Unexpected "${src[i] ?? "end"}" in the expression.`);
    i += m[0].length;
    return Number(m[0]);
  };
  const product = () => {
    let v = atom();
    while (src[i] === "*" || src[i] === "/" || src[i] === "%") {
      const op = src[i++];
      const r = atom();
      if (op !== "*" && r === 0) throw new Error("Division by zero.");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const sum = () => {
    let v = product();
    while (src[i] === "+" || src[i] === "-") {
      const op = src[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const value = sum();
  if (i !== src.length) throw new Error(`Unexpected "${src[i]}" in the expression.`);
  return Math.round(value * 1e9) / 1e9;
}

/**
 * A total from its lines. The unit stays next to the count it explains: a small model that multiplies
 * "7 € per rental" by the days writes « per rental » × 3 and can see it is wrong; the sum is exact.
 */
export function priceTotal(lines) {
  if (!Array.isArray(lines) || !lines.length) return { error: "Give the lines: each price, its unit as the page writes it, and how many times it applies." };
  let total = 0;
  const shown = [];
  for (const line of lines) {
    const price = Number(String(line && line.price).replace(",", "."));
    const count = Number(String(line && line.count).replace(",", "."));
    if (!Number.isFinite(price) || !Number.isFinite(count)) return { error: `Line « ${line && line.item} »: price and count must be numbers.` };
    const amount = Math.round(price * count * 100) / 100;
    total = Math.round((total + amount) * 100) / 100;
    shown.push(`${line.item}: ${price} × ${count} = ${amount} (${line.per || "unit not given"})`);
  }
  return { total, lines: shown, check: "Each count must match its unit: per day × days, per person × people, per person and per day × both, once or per rental × 1; apply any offer or threshold the page states." };
}
