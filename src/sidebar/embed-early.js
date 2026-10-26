// Hivey Browser's side panel loads this page with ?embed=hivey: mark <html> before the stylesheet
// paints, so the workspace rail (replaced by the browser's own Hivey bar) never flashes in.
// A classic script, loaded first in <head>: a module would only run after the first paint.
// The contract and its tests live in src/lib/embed.js — keep this check identical to isHiveyEmbed.
(function () {
  try {
    if (new URLSearchParams(location.search).get("embed") === "hivey") document.documentElement.classList.add("embed-hivey");
  } catch (_) { /* never block the page */ }
})();
