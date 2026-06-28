// analytics.js — no-op event-hooks stub. The server's /analytics/*
// endpoints are also no-ops when no sink is configured.

(function () {
  "use strict";

  function track(_event) {
    // Intentionally empty. Real sink wiring is per-deployment.
  }

  window.JarvisAnalytics = { track: track };
})();
