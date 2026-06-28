// terminal.js — terminal drawer stub.
//
// Phase 4: just toggles the drawer and shows a placeholder. The full
// implementation needs ws + xterm.js + node-pty on the backend, which
// lands in a later phase.

(function () {
  "use strict";

  let open = false;
  let ws = null;

  function toggle() {
    open = !open;
    const drawer = document.getElementById("terminal-drawer");
    if (!drawer) return;
    drawer.classList.toggle("open", open);
    if (open) {
      const cwd = (window.JarvisChat && window.JarvisChat.getCwd && window.JarvisChat.getCwd()) || "";
      const cwdEl = document.getElementById("term-cwd");
      if (cwdEl) cwdEl.textContent = cwd;
      const out = document.getElementById("terminal-output");
      if (out && !out.textContent) {
        out.textContent = "[terminal not yet wired — backend /terminal WebSocket is not implemented]\n";
      }
    }
  }

  function close() {
    open = false;
    const drawer = document.getElementById("terminal-drawer");
    if (drawer) drawer.classList.remove("open");
  }

  // Keyboard: Ctrl+` (Cmd+` on mac).
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "`" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      toggle();
    } else if (ev.key === "Escape" && open) {
      close();
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    const btn = document.getElementById("terminal-close");
    if (btn) btn.addEventListener("click", close);
    const toggleBtn = document.getElementById("chat-toggle-terminal");
    if (toggleBtn) toggleBtn.addEventListener("click", toggle);
  });

  window.JarvisTerminal = { toggle: toggle, close: close };
})();
