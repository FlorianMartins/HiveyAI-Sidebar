// The agent's « always ask » list (content.js): on a booking site, searching — destination, dates,
// travellers, the results, a room's page — stays free; the button that commits is confirmed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/content/content.js", import.meta.url), "utf8");
const block = src.slice(src.indexOf("// <sensitive>"), src.indexOf("// </sensitive>"));
const sensitiveReason = new Function(`${block}; return sensitiveReason;`)();

test("searching a booking site is not a sensitive action", () => {
  for (const label of ["Rechercher", "Search", "Voir les disponibilités", "Mes réservations", "Gérer ma réservation",
    "Réservez votre séjour au meilleur prix", "See availability", "Booking.com", "Reserved seating", "Hôtel du Lac — 131 € / nuit"]) {
    assert.equal(sensitiveReason(label), null, label);
  }
});

test("the button that commits a booking is confirmed", () => {
  for (const label of ["Réserver maintenant", "Réserver", "Je réserve", "Confirmer la réservation", "Book now", "Reserve", "Complete booking"]) {
    assert.ok(sensitiveReason(label), label);
  }
});

test("the other very sensitive actions still are, as whole words", () => {
  for (const label of ["Télécharger le fichier", "Supprimer", "Delete account", "Créer un compte", "Send message", "Publier"]) {
    assert.ok(sensitiveReason(label), label);
  }
  assert.equal(sensitiveReason("Firewire adapter"), null);
});
