// nav.js — hash tab router + toast + confirm-modal helpers.
// Globals: window.JarvisNav, window.JarvisToast, window.JarvisModal.

(function () {
  "use strict";

  // ── Tab router ────────────────────────────────────────────────────

  const TABS = ["chat", "skills-manage", "settings", "status"];

  function findTabForHash(hash) {
    if (hash.startsWith("#skill/")) return "skill";
    const bare = (hash || "#chat").replace(/^#/, "");
    return TABS.includes(bare) ? bare : "chat";
  }

  function activateTab(target, opts) {
    opts = opts || {};
    const tabs = document.querySelectorAll(".sidenav button.tab");
    const panels = document.querySelectorAll("main .panel");
    tabs.forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === target);
    });
    panels.forEach(function (p) {
      p.classList.toggle("active", p.id === target + "-panel");
    });
    if (opts.updateHash !== false) {
      const newHash = target === "chat" ? "" : "#" + target;
      if (location.hash !== newHash) {
        if (newHash) location.hash = newHash;
        else history.replaceState(null, "", location.pathname + location.search);
      }
    }
    // Hook for modules that want to know.
    document.dispatchEvent(
      new CustomEvent("jarvis:tab-changed", { detail: { tab: target } }),
    );
  }

  function getCurrentTab() {
    const active = document.querySelector(".sidenav button.tab.active");
    return active ? active.dataset.tab : "chat";
  }

  function bindTabs() {
    document.querySelectorAll(".sidenav button.tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activateTab(btn.dataset.tab);
      });
    });
    window.addEventListener("hashchange", function () {
      const tab = findTabForHash(location.hash);
      if (tab === "skill") {
        const name = location.hash.replace(/^#skill\//, "");
        if (window.JarvisSkills && window.JarvisSkills.onActivate) {
          window.JarvisSkills.onActivate(name);
        }
      }
      activateTab(tab, { updateHash: false });
    });
  }

  // ── Toast stack ──────────────────────────────────────────────────

  const TOAST_KIND_MS = {
    info: 4000,
    success: 3000,
    warning: 5000,
    error: null, // sticky
  };

  function pushToast(message, kind, opts) {
    opts = opts || {};
    const el = document.createElement("div");
    el.className = "toast " + (kind || "info");
    el.textContent = String(message);
    document.getElementById("toast-stack").appendChild(el);
    const ttl = opts.durationMs !== undefined ? opts.durationMs : TOAST_KIND_MS[kind || "info"];
    if (ttl) {
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, ttl);
    }
    return el;
  }

  // ── Confirm modal ────────────────────────────────────────────────

  function confirmModal(opts) {
    return new Promise(function (resolve) {
      const modal = document.getElementById("confirm-modal");
      document.getElementById("confirm-modal-title").textContent = opts.title || "Confirm";
      document.getElementById("confirm-modal-message").textContent = opts.message || "";
      const confirmBtn = document.getElementById("confirm-modal-confirm");
      const cancelBtn = document.getElementById("confirm-modal-cancel");
      confirmBtn.textContent = opts.confirmLabel || "OK";
      cancelBtn.textContent = opts.cancelLabel || "Cancel";
      confirmBtn.classList.toggle("danger", !!opts.danger);
      modal.classList.add("active");
      function done(result) {
        modal.classList.remove("active");
        confirmBtn.removeEventListener("click", onYes);
        cancelBtn.removeEventListener("click", onNo);
        resolve(result);
      }
      function onYes() { done(true); }
      function onNo() { done(false); }
      confirmBtn.addEventListener("click", onYes);
      cancelBtn.addEventListener("click", onNo);
    });
  }

  // ── Generic modal opener for arbitrary DOM ────────────────────────

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("active");
    el.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function once() {
        el.classList.remove("active");
        btn.removeEventListener("click", once);
      });
    });
    // Click outside the modal panel closes it.
    el.addEventListener("click", function outside(e) {
      if (e.target === el) {
        el.classList.remove("active");
        el.removeEventListener("click", outside);
      }
    });
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
  }

  // ── Boot ──────────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", function () {
    bindTabs();
    const initial = findTabForHash(location.hash);
    activateTab(initial, { updateHash: false });
  });

  // Expose.
  window.JarvisNav = { activate: activateTab, getCurrent: getCurrentTab };
  window.JarvisToast = { push: pushToast };
  window.JarvisModal = { confirm: confirmModal, open: openModal, close: closeModal };
})();
