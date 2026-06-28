// settings.js — local-only preferences (quick phrases).
// Single writer: persists to localStorage and dispatches the
// "jarvis:quick-phrases-changed" event.

(function () {
  "use strict";

  const KEY = "jarvis.quickPhrases";

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function save(phrases) {
    localStorage.setItem(KEY, JSON.stringify(phrases));
    document.dispatchEvent(
      new CustomEvent("jarvis:quick-phrases-changed", { detail: { phrases: phrases } }),
    );
  }

  function render() {
    const root = document.getElementById("quick-phrases");
    if (!root) return;
    root.innerHTML = "";
    load().forEach(function (text) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.title = "Insert into composer";
      b.addEventListener("click", function () {
        const input = document.getElementById("input");
        if (input) {
          input.value = input.value ? input.value + " " + text : text;
          input.focus();
        }
      });
      root.appendChild(b);
    });
  }

  function renderSettingsPanel() {
    const root = document.getElementById("settings-content");
    if (!root) return;
    const phrases = load();
    root.innerHTML =
      '<h3>Quick phrases</h3>' +
      '<p>Click to insert into the composer. Saved locally.</p>' +
      '<div id="quick-phrases-settings"></div>' +
      '<form id="add-phrase-form" style="margin-top: 8px;">' +
      '<input id="add-phrase-input" placeholder="New quick phrase…" />' +
      '<button type="submit">Add</button>' +
      '</form>';
    const list = root.querySelector("#quick-phrases-settings");
    phrases.forEach(function (text, idx) {
      const row = document.createElement("div");
      row.className = "row";
      row.textContent = text + " ";
      const rm = document.createElement("button");
      rm.textContent = "remove";
      rm.type = "button";
      rm.addEventListener("click", function () {
        phrases.splice(idx, 1);
        save(phrases);
        render();
        renderSettingsPanel();
      });
      row.appendChild(rm);
      list.appendChild(row);
    });
    root.querySelector("#add-phrase-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      const v = root.querySelector("#add-phrase-input").value.trim();
      if (!v) return;
      phrases.push(v);
      save(phrases);
      render();
      renderSettingsPanel();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    render();
    document.addEventListener("jarvis:tab-changed", function (e) {
      if (e.detail && e.detail.tab === "settings") renderSettingsPanel();
    });
    document.addEventListener("jarvis:quick-phrases-changed", render);
  });

  window.JarvisSettings = {
    load: load,
    save: save,
    render: render,
  };
})();
