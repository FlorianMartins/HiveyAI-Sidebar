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

// ── Totals: the browser counts, from each price's unit ───────────────────────────────────────
//
// « 7 € par location » counted every day, « 2 € par personne, pour toute la location » counted every
// day for each person: a small model reads the unit and still multiplies by habit (the agent 4B got
// 2 to 4 of 8 such totals right). Here the model copies the unit as the page writes it and gives the
// request's quantities once; the code decides how many times each price counts. What it cannot read
// (« offert dès 4 semaines », « première heure ») stays the model's: `free`, or a `count` of its own.

const PLAIN = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const WHO = [
  ["adults", /\b(adultes?|adults?)\b/],
  ["children", /\b(enfants?|children|child|kids?)\b/],
  ["people", /\b(personnes?|pers\b|participants?|joueurs?|cavaliers?|voyageurs?|passagers?|chacun|chacune|par tete|person|people|head|each guest|guests?|pax)\b|\/\s*pers/],
];
const WHEN = [
  // First: « demi-journée » is not a day.
  ["sessions", /\b(seances?|sessions?|cours|lessons?|demi-journees?|half-days?)\b/],
  ["nights", /\b(nuits?|nuitees?|nights?)\b/],
  ["days", /\b(jours?|journees?|day|days|daily)\b/],
  ["hours", /\b(heures?|hours?|hourly)\b|\/\s*h\b/],
  ["weeks", /\b(semaines?|weeks?|weekly)\b/],
  ["months", /\b(mois|months?|monthly)\b/],
];
// The whole stay, the booking: no time in it, even when a time word follows (« pour toute la durée »).
const WHOLE = /\b(une (seule )?fois|forfait|par (reservation|commande|dossier|location|sejour|stage|inscription)|pour (tout|toute) (le|la|l')|quelle que soit la duree|per (booking|order|rental|stay|hire)|for the whole|one-?off|once)\b/;
const ITEM = /\b(unite|piece|paire|exemplaire|page|km|kilometres?|kilometers?|article|bouteille|carte|item|pair|copy|each one)\b/;

/** Which of the request's quantities a unit, as a page writes it, multiplies by. */
export function unitFactors(per) {
  const text = PLAIN(per);
  const factors = [];
  const who = WHO.find(([, re]) => re.test(text));
  if (who) factors.push(who[0]);
  if (!WHOLE.test(text)) {
    const when = WHEN.find(([, re]) => re.test(text));
    if (when) factors.push(when[0]);
  }
  if (ITEM.test(text)) factors.push("items");
  const known = factors.length > 0 || WHOLE.test(text);
  return { factors, known };
}

// Absent is not zero: a missing count must be asked for, not priced at nothing.
const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(String(v).replace(",", ".")));
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * lines: [{ item, price, per, count?, free? }]; quantities: { people, adults, children, days, nights,
 * hours, weeks, months, sessions }. `count` is how many of the item (pieces, pages, km) for a price
 * « par unité », or the count itself where the unit is not one the browser reads.
 */
export function priceTotal(lines, quantities = {}) {
  if (!Array.isArray(lines) || !lines.length) return { error: "Give the request's quantities, then each price with its unit copied from the page." };
  const q = {};
  for (const [k, v] of Object.entries(quantities || {})) if (Number.isFinite(num(v))) q[k] = num(v);
  if (q.people === undefined && (q.adults !== undefined || q.children !== undefined)) q.people = (q.adults || 0) + (q.children || 0);
  let total = 0;
  const shown = [];
  const missing = [];
  for (const line of lines) {
    const price = num(line && line.price);
    if (!Number.isFinite(price)) return { error: `Line « ${line && line.item} »: the price must be a number.` };
    const { factors, known } = unitFactors(line.per);
    let times = 1;
    const why = [];
    if (line.free) {
      times = 0;
      why.push("offert");
    } else if (!known) {
      const count = num(line.count);
      if (!Number.isFinite(count)) { missing.push(`« ${line.item} » (${line.per || "no unit"}): unit not read, give its count`); continue; }
      times = count;
      why.push(`${count} (count given)`);
    } else {
      for (const f of factors) {
        const value = f === "items" ? num(line.count) : q[f];
        if (!Number.isFinite(value)) { missing.push(`« ${line.item} » needs ${f === "items" ? "its count" : f}`); times = NaN; break; }
        times *= value;
        why.push(`${value} ${f}`);
      }
      if (!Number.isFinite(times)) continue;
      if (!factors.length) why.push("once");
    }
    const amount = round2(price * times);
    total = round2(total + amount);
    shown.push(`${line.item}: ${price} × ${why.join(" × ")} = ${amount}  [« ${line.per || ""} »]`);
  }
  if (missing.length) return { error: "Missing: " + missing.join("; ") + ". Call again with them.", lines: shown };
  return { total, lines: shown };
}

