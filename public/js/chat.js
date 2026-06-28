// chat.js — chat lifecycle, SSE renderer, sessions, fork, steer, model,
// auto-approve, images, approval modal, health dot, info panel.
//
// Global: window.JarvisChat

(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────

  const state = {
    sessionId: null,
    cwd: null,
    backend: null,
    capabilities: null,
    slashCommands: [],
    models: [],
    currentModel: null,
    autoApprove: { default: false, override: null, effective: false },
    busy: false,
    steerEnabled: false,
    queuedMessage: null,
    abortController: null,
    title: "New chat",
  };

  // ── DOM lookups (lazy) ────────────────────────────────────────────

  function el(id) {
    const e = document.getElementById(id);
    if (!e) throw new Error("missing #" + id);
    return e;
  }

  // ── Networking helpers ────────────────────────────────────────────

  async function fetchJSON(url, opts) {
    opts = opts || {};
    if (opts.body && typeof opts.body !== "string") {
      opts.body = JSON.stringify(opts.body);
      opts.headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  // ── Chat init ─────────────────────────────────────────────────────

  async function init(sessionId) {
    const url = "/chat/init" + (sessionId ? "?sessionId=" + encodeURIComponent(sessionId) : "");
    const res = await fetchJSON(url);
    if (!res.ok || !res.data || !res.data.ok) {
      window.JarvisToast.push("Chat init failed: " + (res.data && res.data.error || res.status), "error");
      return;
    }
    Object.assign(state, {
      sessionId: res.data.sessionId,
      cwd: res.data.cwd,
      backend: res.data.backend,
      capabilities: res.data.capabilities,
      slashCommands: res.data.slashCommands || [],
      autoApprove: res.data.autoApprove,
    });
    if (res.data.model) {
      state.models = res.data.model.available || [];
      state.currentModel = res.data.model.current;
    }
    document.dispatchEvent(
      new CustomEvent("jarvis:chat-init", { detail: { state: state } }),
    );
    renderAfterInit();
    renderEmptyStateIfFresh();
  }

  function renderAfterInit() {
    // Header.
    el("chat-info-sessionid").textContent = state.sessionId;
    el("chat-info-workspace").textContent = state.cwd || "—";
    el("chat-info-slashcount").textContent = state.slashCommands.length;
    el("chat-info-auto-approve").textContent = state.autoApprove.effective ? "on" : "off";
    el("chat-form-cwd").textContent = state.cwd ? "@ " + state.cwd : "";

    // Capabilities-gated buttons.
    const cap = state.capabilities || {};
    el("chat-fork-btn").disabled = !cap.canFork;
    el("chat-toggle-steer").disabled = !cap.steer;
    el("chat-toggle-auto-approve").disabled = !cap.toolApprovals;
    el("chat-attach").disabled = !cap.images;

    // Model picker.
    const picker = el("chat-model-picker");
    picker.innerHTML = "";
    state.models.forEach(function (m) {
      const opt = document.createElement("option");
      opt.value = m.modelId;
      opt.textContent = m.name || m.modelId;
      picker.appendChild(opt);
    });
    picker.value = state.currentModel || "";
    picker.disabled = state.models.length === 0;
  }

  function renderEmptyStateIfFresh() {
    const transcript = el("chat");
    if (transcript.children.length > 0) return;
    transcript.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.innerHTML = '<h2>Start a conversation</h2><p>Send a message to begin. Try one of these starters:</p>';
    const cards = document.createElement("div");
    cards.className = "starter-cards";
    [
      "What can you help with?",
      "Summarize this workspace",
      "Find and fix any TODO comments",
      "Write a quick README for this project",
    ].forEach(function (text) {
      const c = document.createElement("button");
      c.className = "starter-card";
      c.textContent = text;
      c.addEventListener("click", function () {
        el("input").value = text;
        el("input").focus();
      });
      cards.appendChild(c);
    });
    empty.appendChild(cards);
    transcript.appendChild(empty);
  }

  // ── SSE stream consumer ───────────────────────────────────────────

  async function consumeStream(res, onPatch) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let sawDone = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6);
        if (!json) continue;
        let patch;
        try {
          patch = JSON.parse(json);
        } catch {
          continue;
        }
        if (patch && patch.type === "done") {
          sawDone = true;
          onPatch(patch);
          return true;
        }
        onPatch(patch);
      }
    }
    // No explicit done — synthesize one for the caller.
    onPatch({ type: "done" });
    return sawDone;
  }

  // ── SSE renderer — the timeline state machine ─────────────────────

  function newTimeline(parentEl) {
    return {
      parent: parentEl,
      msgEl: null,
      textBubble: null,
      textBuf: "",
      thoughtEl: null,
      thoughtBuf: "",
      usage: null,
      tools: new Map(), // by index AND by toolCallId
      finished: false,
    };
  }

  function ensureMsgEl(t) {
    if (t.msgEl) return t.msgEl;
    const m = document.createElement("div");
    m.className = "chat-message assistant";
    const role = document.createElement("div");
    role.className = "role";
    role.textContent = "Assistant";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = '<div class="timeline"></div>';
    m.appendChild(role);
    m.appendChild(bubble);
    t.parent.appendChild(m);
    t.msgEl = m;
    return m;
  }

  function getTimelineRoot(t) {
    return ensureMsgEl(t).querySelector(".timeline");
  }

  function appendText(t, text, isFirst) {
    if (!text) return;
    if (!t.textBubble) {
      const root = getTimelineRoot(t);
      t.textBubble = document.createElement("div");
      t.textBubble.className = "prose";
      t.textBubble.textContent = isFirst ? text : "";
      if (!isFirst) t.textBubble.textContent = "";
      root.appendChild(t.textBubble);
      if (!isFirst) t.textBubble.textContent = "";
      t.textBuf = isFirst ? text : "";
      if (isFirst) renderMarkdownInto(t.textBubble, t.textBuf);
    } else {
      t.textBuf += text;
      renderMarkdownInto(t.textBubble, t.textBuf);
    }
  }

  function appendThought(t, text, isFirst) {
    if (!text) return;
    if (!t.thoughtEl) {
      const root = getTimelineRoot(t);
      t.thoughtEl = document.createElement("details");
      t.thoughtEl.className = "thought-block";
      t.thoughtEl.open = true;
      const summary = document.createElement("summary");
      summary.textContent = "Thinking…";
      const body = document.createElement("div");
      body.className = "thought-body";
      body.textContent = isFirst ? text : "";
      t.thoughtEl.appendChild(summary);
      t.thoughtEl.appendChild(body);
      root.appendChild(t.thoughtEl);
      t.thoughtBuf = isFirst ? text : "";
    } else {
      t.thoughtBuf += text;
      t.thoughtEl.querySelector(".thought-body").textContent = t.thoughtBuf;
    }
  }

  function ensureToolCard(t, index) {
    if (t.tools.has(index)) return t.tools.get(index);
    const root = getTimelineRoot(t);
    const card = document.createElement("details");
    card.className = "tool-card";
    card.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "running tool…";
    card.appendChild(summary);
    const argsEl = document.createElement("div");
    argsEl.className = "tool-args";
    card.appendChild(argsEl);
    const retEl = document.createElement("div");
    retEl.className = "tool-return";
    card.appendChild(retEl);
    root.appendChild(card);
    const entry = { card: card, summary: summary, argsEl: argsEl, retEl: retEl, finalized: false };
    t.tools.set(index, entry);
    return entry;
  }

  function renderMarkdownInto(target, text) {
    // Plain-text escape for now; full markdown rendering belongs in a later
    // iteration. Safe by default.
    target.textContent = text;
  }

  function applyPatch(t, patch) {
    if (!patch || typeof patch !== "object") return;
    switch (patch.type) {
      case "text-start":
        // Seed the buffer with the first chunk's content.
        t.textBuf = patch.content || "";
        appendText(t, patch.content || "", true);
        break;
      case "text-delta":
        appendText(t, patch.delta || "", false);
        break;
      case "thought-start":
        t.thoughtBuf = patch.content || "";
        appendThought(t, patch.content || "", true);
        break;
      case "thought-delta":
        appendThought(t, patch.delta || "", false);
        break;
      case "tool-call-start": {
        const e = ensureToolCard(t, patch.index);
        e.summary.textContent = patch.toolName || "tool";
        if (patch.argsInitial) {
          e.argsEl.textContent = patch.argsInitial;
        }
        if (patch.toolCallId) e.toolCallId = patch.toolCallId;
        break;
      }
      case "tool-call-name-delta":
      case "tool-call-args-delta":
        // Not emitted by ACP backend today; no-op.
        break;
      case "tool-call-finalized": {
        const e = ensureToolCard(t, patch.index);
        e.finalized = true;
        if (patch.args !== undefined) {
          e.argsEl.textContent = JSON.stringify(patch.args, null, 2);
        } else if (patch.argsRaw) {
          e.argsEl.textContent = patch.argsRaw;
        }
        if (patch.toolCallId) e.toolCallId = patch.toolCallId;
        if (patch.intent) e.summary.textContent = patch.intent;
        break;
      }
      case "tool-return":
      case "tool-error": {
        const e = findToolEntry(t, patch.toolCallId);
        if (e) {
          if (patch.type === "tool-error") {
            e.card.classList.add("error");
            e.card.open = true;
            e.retEl.innerHTML = '<span class="error">error</span> ' + escape(String(patch.content || ""));
          } else {
            e.retEl.innerHTML = '<span class="ok">ok</span> ' + escape(String(patch.content || ""));
          }
        }
        break;
      }
      case "tool-return-orphan":
        // Standalone return block.
        {
          const root = getTimelineRoot(t);
          const div = document.createElement("div");
          div.className = "tool-return";
          div.innerHTML = '<span class="ok">return</span> ' + escape(String(patch.content || ""));
          root.appendChild(div);
        }
        break;
      case "usage":
        t.usage = patch.usage;
        renderUsage(t);
        break;
      case "error":
        ensureMsgEl(t).classList.add("error");
        {
          const root = getTimelineRoot(t);
          const div = document.createElement("div");
          div.className = "error-msg";
          div.textContent = patch.message || "error";
          root.appendChild(div);
        }
        break;
      case "slash-commands":
        state.slashCommands = patch.commands || [];
        el("chat-info-slashcount").textContent = state.slashCommands.length;
        break;
      case "approval-request":
        openApprovalModal(patch);
        break;
      case "steer-ack":
        window.JarvisToast.push(
          patch.accepted ? "Steer accepted" : "Steer rejected: " + (patch.reason || ""),
          patch.accepted ? "success" : "warning",
        );
        break;
      case "images-skipped":
        window.JarvisToast.push(
          "Skipped " + (patch.skipped || []).length + " image(s)",
          "warning",
        );
        break;
      case "done":
        t.finished = true;
        break;
      default:
        // Unknown patch type — ignore (forward-compat).
        break;
    }
  }

  function findToolEntry(t, toolCallId) {
    if (toolCallId && t.tools) {
      for (const e of t.tools.values()) {
        if (e.toolCallId === toolCallId) return e;
      }
    }
    // Fall back: last tool card.
    if (t.tools.size > 0) {
      return Array.from(t.tools.values())[t.tools.size - 1];
    }
    return null;
  }

  function escape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderUsage(t) {
    const root = getTimelineRoot(t);
    let pills = root.querySelector(".usage-pills");
    if (!pills) {
      pills = document.createElement("div");
      pills.className = "usage-pills";
      root.appendChild(pills);
    }
    const u = t.usage || {};
    const items = [];
    if (u.input_tokens) items.push("in " + u.input_tokens);
    if (u.output_tokens) items.push("out " + u.output_tokens);
    if (u.thought_tokens) items.push("think " + u.thought_tokens);
    if (u.cached_read_tokens) items.push("cache " + u.cached_read_tokens);
    pills.innerHTML = items.map(function (s) { return "<span>" + s + "</span>"; }).join("");
    // Composer status line.
    el("chat-form-metrics").textContent = items.join(" · ");
  }

  // ── User bubble + attachments ─────────────────────────────────────

  function appendUserBubble(text, images, opts) {
    opts = opts || {};
    const transcript = el("chat");
    const wrap = document.createElement("div");
    wrap.className = "chat-message user" + (opts.queued ? " queued" : "");
    const role = document.createElement("div");
    role.className = "role";
    role.textContent = opts.queued ? "You (queued)" : "You";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (text) bubble.textContent = text;
    if (images && images.length) {
      const att = document.createElement("div");
      att.className = "attachments";
      images.forEach(function (img) {
        const im = document.createElement("img");
        im.src = "data:" + img.mimeType + ";base64," + img.data;
        im.title = img.filename || "image";
        att.appendChild(im);
      });
      bubble.appendChild(att);
    }
    wrap.appendChild(role);
    wrap.appendChild(bubble);
    transcript.appendChild(wrap);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function clearTranscript() {
    el("chat").innerHTML = "";
  }

  // ── Send / queue ──────────────────────────────────────────────────

  let currentTimeline = null;

  async function sendMessage() {
    if (state.busy) return;
    const text = el("input").value.trim();
    const attachments = collectAttachments();
    if (!text && attachments.length === 0) return;
    if (!state.sessionId) {
      window.JarvisToast.push("No session", "error");
      return;
    }
    appendUserBubble(text, attachments);
    el("input").value = "";
    clearAttachments();

    const t = newTimeline(el("chat"));
    currentTimeline = t;
    state.busy = true;
    setComposerBusy(true);
    setHeaderBusy(true);

    state.abortController = new AbortController();
    try {
      const res = await fetch("/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId: state.sessionId,
          images: attachments.map(function (a) {
            return { data: a.data, mimeType: a.mimeType, filename: a.filename };
          }),
        }),
        signal: state.abortController.signal,
      });
      if (!res.ok && !res.body) {
        const text = await res.text();
        applyPatch(t, { type: "error", message: "send failed: " + (text || res.status) });
        applyPatch(t, { type: "done" });
      } else {
        await consumeStream(res, function (patch) { applyPatch(t, patch); });
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        applyPatch(t, { type: "error", message: "aborted" });
      } else {
        applyPatch(t, { type: "error", message: String(err && err.message || err) });
      }
      applyPatch(t, { type: "done" });
    } finally {
      state.busy = false;
      state.abortController = null;
      currentTimeline = null;
      setComposerBusy(false);
      setHeaderBusy(false);
      el("chat").scrollTop = el("chat").scrollHeight;
      // Drain queued message if present.
      if (state.queuedMessage) {
        const next = state.queuedMessage;
        state.queuedMessage = null;
        el("input").value = next;
        // Slight delay so the user sees the composer reset.
        setTimeout(function () { sendMessage(); }, 50);
      }
    }
  }

  async function cancelTurn() {
    if (!state.busy) return;
    state.abortController && state.abortController.abort();
    try {
      await fetchJSON("/chat/cancel", { method: "POST", body: { sessionId: state.sessionId } });
    } catch (err) {
      // Best-effort.
    }
  }

  async function sendSteer() {
    if (!state.busy) return;
    const text = el("input").value.trim();
    if (!text) return;
    if (!state.capabilities || !state.capabilities.steer) {
      window.JarvisToast.push("Steer not supported", "warning");
      return;
    }
    el("input").value = "";
    appendUserBubble("(steer) " + text, []);
    const res = await fetchJSON("/chat/steer", {
      method: "POST",
      body: { sessionId: state.sessionId, prompt: text },
    });
    if (!res.ok || !res.data || !res.data.accepted) {
      window.JarvisToast.push("Steer rejected: " + (res.data && res.data.reason || "?"), "warning");
    }
  }

  function setComposerBusy(busy) {
    el("input").disabled = busy && !state.steerEnabled;
    el("send").style.display = busy ? "none" : "";
    el("chat-cancel").style.display = busy ? "" : "none";
    el("queue").disabled = !busy;
    if (state.capabilities && state.capabilities.steer) {
      el("chat-steer-send").style.display = busy ? "" : "none";
      el("chat-steer-send").disabled = !busy;
    }
    el("chat-toggle-steer").classList.toggle("active", state.steerEnabled);
  }

  function setHeaderBusy(busy) {
    el("chat-fork-btn").disabled = busy || !(state.capabilities && state.capabilities.canFork);
    if (!busy) {
      // Read the latest title from the rename field, persist it.
      const t = el("chat-rename").value.trim();
      if (t && t !== state.title) {
        state.title = t;
        el("chat-title").textContent = t;
        saveSessionMetadata({ customTitle: t });
      }
    }
  }

  // ── Approval modal ────────────────────────────────────────────────

  function openApprovalModal(patch) {
    const modal = el("approval-modal");
    el("approval-modal-tool").textContent = patch.toolName || "(tool)";
    el("approval-modal-options").innerHTML = "";
    (patch.options || []).forEach(function (opt) {
      const btn = document.createElement("button");
      btn.textContent = opt.name || opt.id;
      btn.addEventListener("click", function () {
        modal.classList.remove("active");
        resolveApproval(patch.requestId, opt.id);
      });
      el("approval-modal-options").appendChild(btn);
    });
    // Also offer a deny button if no explicit reject option.
    const hasReject = (patch.options || []).some(function (o) {
      return /reject|deny|cancel/i.test(o.id || "") || /reject|deny|cancel/i.test(o.name || "");
    });
    if (!hasReject) {
      const deny = document.createElement("button");
      deny.textContent = "Deny";
      deny.className = "danger";
      deny.addEventListener("click", function () {
        modal.classList.remove("active");
        resolveApproval(patch.requestId, "reject");
      });
      el("approval-modal-options").appendChild(deny);
    }
    modal.classList.add("active");
  }

  async function resolveApproval(requestId, optionId) {
    const res = await fetchJSON("/chat/approval", {
      method: "POST",
      body: { sessionId: state.sessionId, requestId: requestId, optionId: optionId },
    });
    if (!res.ok) {
      window.JarvisToast.push("Approval failed: " + res.status, "error");
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────

  async function refreshSessions() {
    const res = await fetchJSON("/chat/sessions");
    if (!res.ok || !res.data) return [];
    return res.data.sessions || [];
  }

  async function switchSession(sessionId) {
    if (state.busy) {
      // Cancel first.
      await cancelTurn();
    }
    clearTranscript();
    await init(sessionId);
  }

  async function forkCurrent() {
    if (!state.sessionId || !(state.capabilities && state.capabilities.canFork)) return;
    const res = await fetchJSON("/chat/sessions/fork", {
      method: "POST",
      body: { sessionId: state.sessionId },
    });
    if (!res.ok || !res.data || !res.data.ok) {
      window.JarvisToast.push("Fork failed: " + (res.data && res.data.error || res.status), "error");
      return;
    }
    window.JarvisToast.push("Forked new session", "success");
    await switchSession(res.data.sessionId);
  }

  async function startNewChat() {
    if (state.busy) await cancelTurn();
    clearTranscript();
    await init(null);
    el("chat-rename").value = "";
    el("chat-title").textContent = "New chat";
  }

  async function saveSessionMetadata(patch) {
    if (!state.sessionId) return;
    await fetchJSON("/chat/sessions/" + encodeURIComponent(state.sessionId), {
      method: "PATCH",
      body: patch,
    });
  }

  // ── Past chats menu ───────────────────────────────────────────────

  async function openPastChats() {
    const sessions = await refreshSessions();
    const list = el("past-chats-list");
    list.innerHTML = "";
    if (!sessions.length) {
      list.textContent = "(no past chats yet)";
    } else {
      sessions.forEach(function (s) {
        const row = document.createElement("div");
        row.className = "row";
        row.style.padding = "6px 0";
        const title = document.createElement("span");
        title.textContent = s.customTitle || s.title || s.sessionId.slice(0, 12);
        title.style.cursor = "pointer";
        title.style.color = "var(--color-accent)";
        title.addEventListener("click", function () {
          window.JarvisModal.close("past-chats-menu");
          switchSession(s.sessionId);
        });
        row.appendChild(title);
        if (s.pinned) {
          const pin = document.createElement("span");
          pin.textContent = "📌";
          pin.style.marginLeft = "6px";
          row.appendChild(pin);
        }
        list.appendChild(row);
      });
    }
    window.JarvisModal.open("past-chats-menu");
  }

  // ── Auto-approve toggle ───────────────────────────────────────────

  async function toggleAutoApprove() {
    const next = !state.autoApprove.effective;
    const res = await fetchJSON("/chat/auto-approve", {
      method: "POST",
      body: { enabled: next, sessionId: state.sessionId },
    });
    if (res.ok && res.data) {
      state.autoApprove = res.data;
      el("chat-info-auto-approve").textContent = state.autoApprove.effective ? "on" : "off";
      el("chat-toggle-auto-approve").classList.toggle("active", state.autoApprove.effective);
    }
  }

  // ── Steer toggle ──────────────────────────────────────────────────

  function toggleSteer() {
    if (!state.capabilities || !state.capabilities.steer) return;
    state.steerEnabled = !state.steerEnabled;
    el("chat-toggle-steer").classList.toggle("active", state.steerEnabled);
    el("chat-steer-send").style.display = state.steerEnabled ? "" : "none";
    el("input").placeholder = state.steerEnabled
      ? "Steer the running turn…"
      : "Type a message… (Shift+Enter for newline, Enter to send)";
  }

  // ── Model picker ──────────────────────────────────────────────────

  async function onModelChange() {
    const picker = el("chat-model-picker");
    const modelId = picker.value;
    if (!modelId || modelId === state.currentModel) return;
    const res = await fetchJSON("/chat/model", {
      method: "POST",
      body: { sessionId: state.sessionId, modelId: modelId },
    });
    if (res.ok) {
      state.currentModel = modelId;
      window.JarvisToast.push("Model → " + modelId, "success");
    } else {
      window.JarvisToast.push("Model switch failed: " + (res.data && res.data.error || res.status), "error");
      picker.value = state.currentModel;
    }
  }

  // ── Image attachments ─────────────────────────────────────────────

  let attachedImages = [];

  function collectAttachments() {
    return attachedImages.slice();
  }

  function clearAttachments() {
    attachedImages = [];
    el("chat-attachments").innerHTML = "";
  }

  function attachFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      const data = String(reader.result || "");
      const base64 = data.split(",")[1] || "";
      attachedImages.push({
        data: base64,
        mimeType: file.type,
        filename: file.name,
      });
      renderAttachments();
    };
    reader.readAsDataURL(file);
  }

  function renderAttachments() {
    const tray = el("chat-attachments");
    tray.innerHTML = "";
    attachedImages.forEach(function (img, idx) {
      const wrap = document.createElement("div");
      wrap.className = "attachment";
      const im = document.createElement("img");
      im.src = "data:" + img.mimeType + ";base64," + img.data;
      const name = document.createElement("span");
      name.textContent = img.filename || "image " + (idx + 1);
      const rm = document.createElement("button");
      rm.textContent = "×";
      rm.type = "button";
      rm.title = "Remove";
      rm.addEventListener("click", function () {
        attachedImages.splice(idx, 1);
        renderAttachments();
      });
      wrap.appendChild(im);
      wrap.appendChild(name);
      wrap.appendChild(rm);
      tray.appendChild(wrap);
    });
  }

  // ── Wiring ────────────────────────────────────────────────────────

  function wireComposer() {
    el("chat-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (state.steerEnabled) {
        sendSteer();
      } else {
        sendMessage();
      }
    });
    el("input").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        if (state.steerEnabled) {
          sendSteer();
        } else {
          sendMessage();
        }
      }
    });
    el("queue").addEventListener("click", function () {
      const text = el("input").value.trim();
      if (!text) return;
      state.queuedMessage = text;
      el("input").value = "";
      window.JarvisToast.push("Queued for after current turn", "info");
    });
    el("chat-cancel").addEventListener("click", cancelTurn);
    el("chat-steer-send").addEventListener("click", sendSteer);
    el("chat-attach").addEventListener("click", function () {
      el("chat-image-input").click();
    });
    el("chat-image-input").addEventListener("change", function (ev) {
      const files = Array.from(ev.target.files || []);
      files.forEach(attachFile);
      ev.target.value = "";
    });
    el("input").addEventListener("paste", function (ev) {
      const items = Array.from(ev.clipboardData && ev.clipboardData.items || []);
      items.forEach(function (it) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) attachFile(f);
        }
      });
    });
  }

  function wireHeader() {
    el("chat-fork-btn").addEventListener("click", forkCurrent);
    el("past-chats-btn").addEventListener("click", openPastChats);
    el("new-chat-btn").addEventListener("click", function () {
      window.JarvisModal.open("new-chat-menu");
    });
    el("new-chat-empty-workspace").addEventListener("click", function () {
      window.JarvisModal.close("new-chat-menu");
      startNewChat();
    });
    el("new-chat-pick-folder").addEventListener("click", function () {
      window.JarvisModal.close("new-chat-menu");
      fetchJSON("/chat/pick-folder", { method: "POST", body: {} }).then(function (res) {
        if (res.ok && res.data && res.data.cwd) {
          init(null);
          window.JarvisToast.push("Switched to " + res.data.cwd, "success");
        } else {
          window.JarvisToast.push("Folder picker: " + (res.data && res.data.error || "not supported"), "warning");
        }
      });
    });
    el("chat-toggle-auto-approve").addEventListener("click", toggleAutoApprove);
    el("chat-toggle-steer").addEventListener("click", toggleSteer);
    el("chat-toggle-terminal").addEventListener("click", function () {
      if (window.JarvisTerminal && window.JarvisTerminal.toggle) {
        window.JarvisTerminal.toggle();
      }
    });
    el("chat-info-toggle-btn").addEventListener("click", function () {
      el("chat-info-panel").classList.toggle("hidden");
    });
    el("chat-model-picker").addEventListener("change", onModelChange);
    el("chat-rename").addEventListener("change", function () {
      const t = el("chat-rename").value.trim();
      state.title = t || "Untitled";
      el("chat-title").textContent = state.title;
      saveSessionMetadata({ customTitle: t || null });
    });
    el("chat-group").addEventListener("change", function () {
      saveSessionMetadata({ group: el("chat-group").value || null });
    });
    el("chat-pinned").addEventListener("change", function () {
      saveSessionMetadata({ pinned: el("chat-pinned").checked });
    });
  }

  // ── Health dot ────────────────────────────────────────────────────

  let healthTimer = null;
  async function pollHealth() {
    try {
      const res = await fetchJSON("/health/agent");
      const dot = el("brand-health");
      dot.classList.toggle("ok", !!(res.data && res.data.agent));
      dot.classList.toggle("bad", !(res.data && res.data.agent));
    } catch {
      el("brand-health").classList.add("bad");
    }
  }
  function startHealthPolling() {
    pollHealth();
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = setInterval(pollHealth, 15000);
  }

  // ── Boot ──────────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", function () {
    wireComposer();
    wireHeader();
    startHealthPolling();
    init(null);
  });

  // ── Expose ────────────────────────────────────────────────────────

  window.JarvisChat = {
    init: init,
    sendMessage: sendMessage,
    cancel: cancelTurn,
    switchSession: switchSession,
    forkCurrent: forkCurrent,
    startNewChat: startNewChat,
    refreshSessions: refreshSessions,
    getCwd: function () { return state.cwd; },
  };
})();
