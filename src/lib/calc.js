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
