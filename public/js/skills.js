// skills.js — skill discovery + iframe hosting + management.
// In Phase 4 the server has /skills returning { skills: [] } (no skills
// installed), so the sub-nav group stays hidden.

(function () {
  "use strict";

  async function discover() {
    const res = await fetch("/skills");
    if (!res.ok) return [];
    const data = await res.json();
    return data.skills || [];
  }

  async function refreshNav() {
    const skills = await discover();
    const hasUi = skills.filter(function (s) { return s.hasUi; });
    const navList = document.getElementById("skills-nav-list");
    if (!navList) return;
    // Reset.
    navList.innerHTML = "";
    if (hasUi.length === 0) {
      navList.style.display = "none";
      return;
    }
    navList.style.display = "";
    hasUi.forEach(function (s) {
      const btn = document.createElement("button");
      btn.className = "tab skill-tab";
      btn.dataset.tab = "skill/" + s.name;
      btn.textContent = s.displayName || s.name;
      btn.addEventListener("click", function () {
        onActivate(s.name);
      });
      navList.appendChild(btn);
    });
  }

  function onActivate(name) {
    const frame = document.getElementById("skill-frame");
    if (frame) frame.src = "/skills/" + encodeURIComponent(name) + "/ui/";
    // Toggle panels manually for the skill/<name> route.
    document.querySelectorAll(".sidenav button.tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === "skill/" + name);
    });
    document.querySelectorAll("main .panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "skill-panel");
    });
  }

  async function loadManagePanel() {
    const list = document.getElementById("skills-manage-list");
    if (!list) return;
    list.innerHTML = "";
    const initial = await fetch("/skills/initial").then(function (r) {
      return r.ok ? r.json() : { skills: [] };
    });
    const installed = await discover();
    if (!initial.skills.length && !installed.length) {
      list.textContent = "(no skills installed)";
      return;
    }
    installed.forEach(function (s) {
      const row = document.createElement("div");
      row.className = "row";
      row.textContent = s.name + (s.hasUi ? " [ui]" : "");
      list.appendChild(row);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    refreshNav();
    document.addEventListener("jarvis:tab-changed", function (e) {
      if (e.detail && e.detail.tab === "skills-manage") {
        loadManagePanel();
      }
    });
  });

  window.JarvisSkills = {
    discover: discover,
    refreshNav: refreshNav,
    onActivate: onActivate,
    loadManage: loadManagePanel,
  };
})();
