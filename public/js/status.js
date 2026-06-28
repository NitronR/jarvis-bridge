// status.js — polls /status/active while the Status tab is visible.

(function () {
  "use strict";

  let timer = null;

  async function poll() {
    const root = document.getElementById("status-content");
    if (!root) return;
    try {
      const res = await fetch("/status/active");
      if (!res.ok) {
        root.textContent = "(status unavailable)";
        return;
      }
      const data = await res.json();
      root.innerHTML =
        '<div class="row"><span class="key">Busy</span><span class="val">' +
        (data.busy ? "yes" : "no") + '</span></div>' +
        '<div class="row"><span class="key">Active chat streams</span><span class="val">' +
        (data.chat && data.chat.activeCount) + '</span></div>';
      const streams = (data.chat && data.chat.streams) || [];
      if (streams.length) {
        const ul = document.createElement("ul");
        streams.forEach(function (s) {
          const li = document.createElement("li");
          li.textContent = s.sessionId + " — " + (s.preview || "");
          ul.appendChild(li);
        });
        root.appendChild(ul);
      }
    } catch (err) {
      root.textContent = "(status error)";
    }
  }

  function start() {
    if (timer) return;
    poll();
    timer = setInterval(poll, 5000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  document.addEventListener("jarvis:tab-changed", function (e) {
    if (e.detail && e.detail.tab === "status") start();
    else stop();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
  });

  window.JarvisStatus = { poll: poll, start: start, stop: stop };
})();
