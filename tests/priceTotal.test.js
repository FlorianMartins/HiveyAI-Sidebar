import test from "node:test";
import assert from "node:assert/strict";
import { priceTotal, unitFactors } from "../src/lib/calc.js";

test("the unit decides how many times a price counts", () => {
  const f = (per) => unitFactors(per).factors.join(" × ");
  assert.equal(f("par personne et par jour"), "people × days");
  assert.equal(f("par personne, pour toute la location"), "people");
  assert.equal(f("7 € par location"), "");
  assert.equal(f("une fois"), "");
  assert.equal(f("forfait unique"), "");
  assert.equal(f("la nuit"), "nights");
  assert.equal(f("par adulte et par nuit"), "adults × nights");
  assert.equal(f("per day"), "days");
  assert.equal(f("for the whole hire"), "");
  assert.equal(f("la demi-journée"), "sessions");
  assert.equal(f("par lit, pour le séjour"), "");
  assert.equal(f("3 € par pièce"), "items");
  assert.equal(unitFactors("selon la saison").known, false);
});

test("a rental: insurance once per bike, helmets every day", () => {
  const r = priceTotal([
    { item: "Vélo", price: 34, per: "par jour", count: 2 },
    { item: "Casque", price: 4, per: "la journée", count: 2 },
    { item: "Assurance", price: 7, per: "par location", count: 2 },
  ], { days: 3 });
  // A bike and a helmet are things: per day, counted per day; the model gives them as items when the page says « par vélo ».
  assert.equal(r.total, 34 * 3 + 4 * 3 + 7);
});

test("people and days; free lines; missing quantities are asked for", () => {
  const r = priceTotal([
    { item: "Cours", price: 30, per: "par personne et par jour" },
    { item: "Licence", price: 12, per: "par personne" },
    { item: "Dossier", price: 8, per: "forfait unique" },
    { item: "Livraison", price: 4, per: "par semaine", free: true },
  ], { people: 3, days: 2 });
  assert.equal(r.total, 180 + 36 + 8);
  assert.match(r.lines[0], /30 × 3 people × 2 days = 180/);
  const asked = priceTotal([{ item: "Cours", price: 30, per: "par personne et par jour" }], { people: 3 });
  assert.match(asked.error, /needs days/);
  const unread = priceTotal([{ item: "Option", price: 5, per: "selon la saison" }], {});
  assert.match(unread.error, /unit not read/);
  assert.equal(priceTotal([{ item: "Option", price: 5, per: "selon la saison", count: 2 }], {}).total, 10);
});

test("adults and children make the people when no total is given", () => {
  const r = priceTotal([{ item: "Entrée", price: 10, per: "par personne" }, { item: "Taxe", price: 1.2, per: "par adulte et par nuit" }], { adults: 2, children: 1, nights: 3 });
  assert.equal(r.total, 30 + 7.2);
});

test("a tariff written as arithmetic is recognised, other arithmetic is not", async () => {
  const { looksLikeTariffTotal } = await import("../src/lib/calc.js");
  assert.equal(looksLikeTariffTotal("2*14 + 9 + 2*4"), true);
  assert.equal(looksLikeTariffTotal("4 * 95 + 500 * 0.25 + 15 + 4 * 18"), true);
  assert.equal(looksLikeTariffTotal("329 + 0"), false);
  assert.equal(looksLikeTariffTotal("314 + 9.9"), false);
  assert.equal(looksLikeTariffTotal("15 * 24 + 80"), false);
  assert.equal(looksLikeTariffTotal("41 + 17 + 8"), false);
  assert.equal(looksLikeTariffTotal("1e3 + 2 + 3"), false);
});
