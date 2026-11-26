(() => {
  // src/host-bridge.js
  function sanitizePaths(text) {
    if (!text) return "";
    return String(text).replace(/\/Users\/[^/\s"'`]+/g, "/Users/<user>").replace(/\/home\/[^/\s"'`]+/g, "/home/<user>").replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/g, "C:\\Users\\<user>");
  }
  function extractDomMessages(doc) {
    if (!doc) return [];
    const content = doc.querySelector("[data-conversation-content]") || doc.querySelector("#thread");
    if (!content) return [];
    const rows = [];
    const flowNodes = content.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-chat-flow-kind="assistant"]');
    if (flowNodes.length) {
      for (const node of flowNodes) {
        if (node.closest('[hidden], [aria-hidden="true"]') || node.dataset.chatGroupPart === "process") continue;
        const text = (node.textContent || "").trim();
        if (!text) continue;
        rows.push({
          role: node.dataset.chatFlowKind === "assistant" ? "assistant" : "user",
          text
        });
      }
      return rows;
    }
    const article = content.matches("article") ? content : content.querySelector("article");
    if (!article) return rows;
    for (const el of article.children) {
      const text = (el.textContent || "").trim();
      if (!text) continue;
      if (el.matches(".user-message")) {
        rows.push({ role: "user", text });
      } else if (rows.at(-1)?.role === "assistant") {
        rows.at(-1).text += "\n\n" + text;
      } else {
        rows.push({ role: "assistant", text });
      }
    }
    return rows;
  }
  function legacyMessageText(blocks) {
    return (blocks || []).map((block) => {
      const type = block.kind || block.type;
      if (type === "text" && typeof block.text === "string") return block.text;
      if (type === "image") return "[\u56FE\u7247]";
      if (type === "file") return "[\u6587\u4EF6" + (block.attachment?.name ? "\uFF1A" + block.attachment.name : "") + "]";
      return "";
    }).filter(Boolean).join("\n\n");
  }
  function extractLegacyMessages(legacy) {
    if (!Array.isArray(legacy?.nodes)) return null;
    const rows = [];
    for (const node of legacy.nodes) {
      if (node.kind === "user" || node.kind === "steering") {
        const text = legacyMessageText(node.content);
        if (text.trim()) rows.push({ role: "user", text });
      } else if (node.kind === "assistant") {
        const text = legacyMessageText(node.blocks);
        if (text.trim()) rows.push({ role: "assistant", text });
      }
    }
    if (legacy.partial) {
      const exists = legacy.nodes.some((n) => n.kind === "assistant" && n.turn === legacy.partial.turn && n.step === legacy.partial.step);
      if (!exists) {
        const text = legacyMessageText(legacy.partial.blocks);
        if (text.trim()) rows.push({ role: "assistant", text });
      }
    }
    return rows;
  }
  function createHostBridge(win, options = {}) {
    const doc = win?.document;
    const listeners = /* @__PURE__ */ new Set();
    const transitionListeners = /* @__PURE__ */ new Set();
    let state = {
      status: "idle",
      sessionId: null,
      sessionTitle: "",
      workspaceName: "\u9ED8\u8BA4\u5DE5\u4F5C\u533A",
      sessions: [],
      ...options.initialState || {}
    };
    let latestLegacy = null;
    let inputController = null;
    let openSessionHandler = options.openSession || null;
    let sendMessageHandler = options.sendMessage || null;
    function emit() {
      const snap = getSnapshot();
      for (const fn of listeners) {
        try {
          fn(snap);
        } catch {
        }
      }
    }
    function update(patch) {
      const prevStatus = state.status;
      const prevSession = state.sessionId;
      state = { ...state, ...patch };
      if (patch.status && patch.status !== prevStatus) {
        for (const fn of transitionListeners) {
          try {
            fn(prevStatus, patch.status, {
              sessionId: state.sessionId,
              sessionTitle: state.sessionTitle,
              sameSession: prevSession === state.sessionId
            });
          } catch {
          }
        }
      }
      emit();
    }
    function getSnapshot() {
      return {
        ...state,
        sessions: state.sessions.map((s) => ({ ...s }))
      };
    }
    function findComposerInput() {
      if (!doc) return null;
      return doc.querySelector("[data-composer-input]") || doc.querySelector("textarea#draft") || doc.querySelector("textarea");
    }
    function getHostDraft() {
      if (inputController?.getDraft) {
        const val = inputController.getDraft();
        if (typeof val === "string") return val;
      }
      const el = findComposerInput();
      if (!el) return "";
      return typeof el.value === "string" ? el.value : el.textContent || "";
    }
    function fillHostDraft(text, { replace = false } = {}) {
      const value = String(text ?? "");
      if (!value) return false;
      if (inputController?.insertText && inputController?.captureInsertion) {
        try {
          const span = inputController.captureInsertion();
          if (span && inputController.insertText(value, replace ? { ...span, start: 0, end: getHostDraft().length } : span)) {
            return true;
          }
        } catch {
        }
      }
      const el = findComposerInput();
      if (!el) return false;
      if ("value" in el) {
        const current = el.value || "";
        const next = replace ? value : current ? current + "\n" + value : value;
        const proto = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement?.prototype || {}, "value");
        if (proto?.set) proto.set.call(el, next);
        else el.value = next;
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
        el.focus?.();
        return true;
      }
      if (el.isContentEditable) {
        const current = el.textContent || "";
        el.textContent = replace ? value : current ? current + "\n" + value : value;
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
        el.focus?.();
        return true;
      }
      return false;
    }
    function sendHostMessage(text) {
      const content = String(text ?? "").trim();
      if (!content) return false;
      if (typeof sendMessageHandler === "function") {
        return sendMessageHandler(content) !== false;
      }
      const filled = fillHostDraft(content, { replace: true });
      if (!filled || !doc) return false;
      const form = findComposerInput()?.closest("form");
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"], button#send, button[aria-label*="\u53D1"]');
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.click();
          return true;
        }
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
          return true;
        }
        form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
        return true;
      }
      return filled;
    }
    function openSession(id) {
      if (!id) return false;
      if (typeof openSessionHandler === "function") {
        openSessionHandler(id);
        return true;
      }
      const row = doc?.querySelector(`[data-row-key="session:${id}"]`);
      if (row) {
        row.click();
        return true;
      }
      return false;
    }
    function getConversationMessages() {
      const fromLegacy = extractLegacyMessages(latestLegacy);
      if (fromLegacy && fromLegacy.length) return fromLegacy;
      return extractDomMessages(doc);
    }
    function getLatestAssistantMessage() {
      const msgs = getConversationMessages();
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") return msgs[i].text;
      }
      return "";
    }
    return {
      getSnapshot,
      update,
      setLegacy(legacy) {
        latestLegacy = legacy;
      },
      setInputController(ctrl) {
        inputController = ctrl;
      },
      setOpenSessionHandler(fn) {
        openSessionHandler = fn;
      },
      setSendMessageHandler(fn) {
        sendMessageHandler = fn;
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      onTransition(fn) {
        transitionListeners.add(fn);
        return () => transitionListeners.delete(fn);
      },
      openSession,
      getHostDraft,
      fillHostDraft,
      sendHostMessage,
      getConversationMessages,
      getLatestAssistantMessage
    };
  }
  function normalizeSessions(list, workspaces, statuses) {
    if (!list || list.phase !== "ready") return [];
    const archived = new Set(workspaces?.archivedSessionIds || []);
    const pinned = new Set(workspaces?.pinnedSessionIds || []);
    const rows = [];
    for (const id of list.ids || []) {
      const row = list.byId?.[id];
      if (!row || row.blank || row.origin === "subagent" || archived.has(id)) continue;
      const live = statuses?.get?.(id);
      const waiting = Boolean(live?.pendingInteraction);
      const running = Boolean(live?.running ?? row.running);
      const failed = list.projectionsBySession?.[id]?.values?.conversationContinuation != null;
      const status = waiting ? "waiting" : running ? "busy" : failed ? "error" : "idle";
      rows.push({
        id,
        title: row.title?.trim() || row.displayTitle?.trim() || "\u672A\u547D\u540D\u4F1A\u8BDD",
        updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
        pinned: pinned.has(id),
        running,
        waiting,
        status
      });
    }
    rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return rows;
  }

  // src/prefs.js
  var PREFIX = "dsh-hello84.";
  var cache = /* @__PURE__ */ new WeakMap();
  function createPrefs(win) {
    const memory = /* @__PURE__ */ new Map();
    const listeners = /* @__PURE__ */ new Set();
    function storage() {
      try {
        return win?.localStorage ?? null;
      } catch {
        return null;
      }
    }
    function get(key, fallback = void 0) {
      const full = PREFIX + key;
      const store = storage();
      if (store) {
        try {
          const raw = store.getItem(full);
          if (raw !== null) return JSON.parse(raw);
        } catch {
        }
      }
      return memory.has(full) ? memory.get(full) : fallback;
    }
    function set(key, value) {
      const full = PREFIX + key;
      memory.set(full, value);
      let persisted = false;
      const store = storage();
      if (store) {
        try {
          store.setItem(full, JSON.stringify(value));
          persisted = true;
        } catch {
          persisted = false;
        }
      }
      for (const fn of listeners) {
        try {
          fn(key, value);
        } catch {
        }
      }
      return persisted;
    }
    function remove(key) {
      const full = PREFIX + key;
      memory.delete(full);
      const store = storage();
      if (store) {
        try {
          store.removeItem(full);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    }
    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
    return { get, set, remove, subscribe };
  }
  function getPrefs(win) {
    if (!win || typeof win !== "object") return createPrefs(null);
    if (!cache.has(win)) cache.set(win, createPrefs(win));
    return cache.get(win);
  }

  // src/sound.js
  function playTone(win, sequence, force = false) {
    if (!win) return false;
    const prefs = getPrefs(win);
    if (!force && prefs.get("sound", false) !== true) return false;
    const AudioCtx = win.AudioContext || win.webkitAudioContext;
    if (!AudioCtx) return false;
    let ctx;
    try {
      ctx = new AudioCtx();
      if (ctx.state === "suspended") Promise.resolve(ctx.resume()).catch(() => {
      });
      const now = ctx.currentTime;
      let maxEnd = 0;
      for (const note of sequence) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = note.type || "square";
        osc.frequency.setValueAtTime(note.freq, now + (note.start || 0));
        if (note.freqEnd) {
          osc.frequency.exponentialRampToValueAtTime(note.freqEnd, now + (note.start || 0) + note.dur);
        }
        const vol = note.vol ?? 0.045;
        gain.gain.setValueAtTime(1e-4, now + (note.start || 0));
        gain.gain.linearRampToValueAtTime(vol, now + (note.start || 0) + 5e-3);
        gain.gain.exponentialRampToValueAtTime(1e-4, now + (note.start || 0) + note.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + (note.start || 0));
        osc.stop(now + (note.start || 0) + note.dur + 0.02);
        maxEnd = Math.max(maxEnd, (note.start || 0) + note.dur + 0.05);
      }
      win.setTimeout(() => {
        if (ctx && ctx.state !== "closed") Promise.resolve(ctx.close()).catch(() => {
        });
      }, Math.ceil(maxEnd * 1e3) + 60);
      return true;
    } catch {
      if (ctx && ctx.state !== "closed") Promise.resolve(ctx.close()).catch(() => {
      });
      return false;
    }
  }
  var sound = {
    click(win) {
      return playTone(win, [{ freq: 1800, freqEnd: 900, dur: 0.022, type: "square", vol: 0.028 }]);
    },
    startup(win) {
      return playTone(win, [
        { freq: 349.23, dur: 0.55, type: "triangle", vol: 0.045, start: 0 },
        { freq: 523.25, dur: 0.55, type: "triangle", vol: 0.04, start: 0.01 },
        { freq: 698.46, dur: 0.52, type: "sine", vol: 0.035, start: 0.02 }
      ]);
    },
    floppy(win) {
      return playTone(win, [
        { freq: 140, freqEnd: 110, dur: 0.045, type: "sawtooth", vol: 0.03, start: 0 },
        { freq: 175, freqEnd: 130, dur: 0.045, type: "sawtooth", vol: 0.03, start: 0.065 },
        { freq: 150, freqEnd: 120, dur: 0.05, type: "sawtooth", vol: 0.025, start: 0.13 }
      ]);
    },
    happy(win) {
      return playTone(win, [
        { freq: 587.33, dur: 0.09, type: "square", vol: 0.035, start: 0 },
        { freq: 880, dur: 0.16, type: "square", vol: 0.04, start: 0.1 }
      ]);
    },
    sad(win) {
      return playTone(win, [
        { freq: 240, freqEnd: 180, dur: 0.18, type: "sawtooth", vol: 0.04, start: 0 },
        { freq: 160, freqEnd: 110, dur: 0.28, type: "sawtooth", vol: 0.045, start: 0.2 }
      ]);
    },
    alarm(win, force = false) {
      return playTone(win, [
        { freq: 1046.5, dur: 0.1, type: "square", vol: 0.045, start: 0 },
        { freq: 1046.5, dur: 0.1, type: "square", vol: 0.045, start: 0.14 },
        { freq: 1318.5, dur: 0.18, type: "square", vol: 0.045, start: 0.28 }
      ], force);
    }
  };

  // src/icons.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICONS = {
    // Classic 1984 Happy Mac
    happyMac: `
    <path fill="currentColor" d="M2 1h12v1h1v12h-1v1H2v-1H1V2h1V1zm0 1v12h12V2H2z"/>
    <path fill="currentColor" d="M3 3h10v7H3V3zm1 1v5h8V4H4z"/>
    <rect x="6" y="5" width="1" height="2" fill="currentColor"/>
    <rect x="9" y="5" width="1" height="2" fill="currentColor"/>
    <path fill="currentColor" d="M6 7h1v1h2V7h1v1H9v1H7V8H6V7z"/>
    <rect x="9" y="12" width="4" height="1" fill="currentColor"/>
    <rect x="3" y="12" width="2" height="1" fill="currentColor"/>`,
    // Classic Sad Mac
    sadMac: `
    <path fill="currentColor" d="M2 1h12v1h1v12h-1v1H2v-1H1V2h1V1zm0 1v12h12V2H2z"/>
    <path fill="currentColor" d="M3 3h10v7H3V3zm1 1v5h8V4H4z"/>
    <path fill="currentColor" d="M5 5h1v1H5zm1 1h1v1H6zm1-1h1v1H7zM5 7h1v1H5zM9 5h1v1H9zm1 1h1v1h-1zm1-1h1v1h-1zM9 7h1v1H9z"/>
    <path fill="currentColor" d="M6 8h4v1H6z"/>
    <rect x="9" y="12" width="4" height="1" fill="currentColor"/>`,
    // System 6 Wristwatch busy cursor
    wristwatch: `
    <rect x="5" y="1" width="6" height="2" fill="currentColor"/>
    <rect x="5" y="13" width="6" height="2" fill="currentColor"/>
    <path fill="currentColor" d="M4 3h8v1h1v8h-1v1H4v-1H3V4h1V3zm0 1v8h8V4H4z"/>
    <rect x="13" y="7" width="1" height="2" fill="currentColor"/>
    <rect x="7" y="5" width="1" height="4" fill="currentColor"/>
    <rect x="8" y="8" width="3" height="1" fill="currentColor"/>`,
    // 3.5" Sony Floppy Disk
    floppy: `
    <path fill="currentColor" d="M1 1h12l2 2v12H1V1zm1 1v12h12V3.4L12.6 2H2z"/>
    <path fill="currentColor" d="M4 2h7v5H4V2zm1 1v3h5V3H5z"/>
    <rect x="8" y="3" width="1" height="3" fill="currentColor"/>
    <path fill="currentColor" d="M3 9h10v5H3V9zm1 1v3h8v-3H4z"/>
    <rect x="5" y="11" width="6" height="1" fill="currentColor"/>`,
    // Mini DSH Retro Terminal
    miniDsh: `
    <path fill="currentColor" d="M1 2h14v12H1V2zm1 1v2h12V3H2zm0 3v7h12V6H2z"/>
    <rect x="3" y="3" width="1" height="1" fill="var(--h84-surface, #fff)"/>
    <path fill="currentColor" d="M4 8h1v1H4zm1 1h1v1H5zm-1 1h1v1H4z"/>
    <rect x="7" y="10" width="4" height="1" fill="currentColor"/>`,
    // Classic Note Pad with dog-ear
    notepad: `
    <path fill="currentColor" d="M2 1h12v14H6l-4-4V1zm1 1v8h4v4h6V2H3zm0 9l3 3v-3H3z"/>
    <rect x="5" y="4" width="6" height="1" fill="currentColor"/>
    <rect x="5" y="6" width="6" height="1" fill="currentColor"/>
    <rect x="5" y="8" width="4" height="1" fill="currentColor"/>`,
    // Classic Alarm Clock
    alarm: `
    <path fill="currentColor" d="M2 2h3v1H4v1H2V2zm9 0h3v2h-2V3h-1V2z"/>
    <path fill="currentColor" d="M5 3h6v1h2v2h1v5h-1v2h-2v1H5v-1H3v-2H2V6h1V4h2V3zm0 1v1H4v1H3v5h1v1h1v1h6v-1h1v-1h1V6h-1V5h-1V4H5z"/>
    <rect x="7" y="6" width="1" height="3" fill="currentColor"/>
    <rect x="8" y="8" width="3" height="1" fill="currentColor"/>
    <rect x="3" y="14" width="2" height="1" fill="currentColor"/>
    <rect x="11" y="14" width="2" height="1" fill="currentColor"/>`,
    // MacPaint Brush & Canvas
    macpaint: `
    <path fill="currentColor" d="M1 2h14v12H1V2zm1 1v10h12V3H2z"/>
    <path fill="currentColor" d="M10 4h2v2h-1v1h-1v1H9v1H8v1H6v1H4v-2h1V8h1V7h1V6h1V5h2V4z"/>
    <rect x="3" y="11" width="3" height="1" fill="currentColor"/>`,
    // Classic Minesweeper Bomb
    minesweeper: `
    <rect x="7" y="1" width="2" height="2" fill="currentColor"/>
    <rect x="7" y="13" width="2" height="2" fill="currentColor"/>
    <rect x="1" y="7" width="2" height="2" fill="currentColor"/>
    <rect x="13" y="7" width="2" height="2" fill="currentColor"/>
    <rect x="3" y="3" width="2" height="2" fill="currentColor"/>
    <rect x="11" y="3" width="2" height="2" fill="currentColor"/>
    <rect x="3" y="11" width="2" height="2" fill="currentColor"/>
    <rect x="11" y="11" width="2" height="2" fill="currentColor"/>
    <path fill="currentColor" d="M5 4h6v1h1v6h-1v1H5v-1H4V5h1V4z"/>
    <rect x="6" y="6" width="2" height="2" fill="var(--h84-surface, #fff)"/>`,
    // Pixel Apple Menu Emblem
    apple: `
    <rect x="8" y="2" width="2" height="1" fill="currentColor"/>
    <rect x="7" y="3" width="2" height="1" fill="currentColor"/>
    <path fill="currentColor" d="M4 5h3v1h2V5h3v1h1v2h-1v2h1v2h-1v2H9v-1H7v1H4v-2H3V6h1V5z"/>`,
    soundOn: `
    <path fill="currentColor" d="M2 6h3l3-3v10l-3-3H2V6z"/>
    <rect x="10" y="6" width="1" height="4" fill="currentColor"/>
    <rect x="12" y="4" width="1" height="8" fill="currentColor"/>`,
    soundOff: `
    <path fill="currentColor" d="M2 6h3l3-3v10l-3-3H2V6z"/>
    <path fill="currentColor" d="M10 6h1v1h1v1h-1v1h-1V8h1V7h-1V6zm3 0h1v1h-1v1h1v1h-1V8h-1V7h1V6z"/>`,
    // InnerLife thought-cloud pixel icon
    innerlife: `
    <path fill="currentColor" d="M5 2h6v1h2v1h1v4h-1v1h-2v1H5V9H3V8H2V4h1V3h2V2zm0 1v1H3v4h2v1h6V8h2V4h-2V3H5z"/>
    <rect x="6" y="5" width="1" height="2" fill="currentColor"/>
    <rect x="9" y="5" width="1" height="2" fill="currentColor"/>
    <rect x="4" y="11" width="2" height="2" fill="currentColor"/>
    <rect x="2" y="13" width="2" height="2" fill="currentColor"/>`,
    // Classic 1984 Flying Toaster pixel icon
    toaster: `
    <path fill="currentColor" d="M1 4h4v1H3v1h2v1H2V6H1V4zm10 0h4v2h-1v1h-3V6h2V5h-2V4z"/>
    <path fill="currentColor" d="M5 5h6v1h1v6H4V6h1V5zm0 1v5h6V6H5z"/>
    <rect x="6" y="3" width="4" height="2" fill="currentColor"/>
    <rect x="6" y="8" width="1" height="2" fill="currentColor"/>
    <rect x="9" y="8" width="1" height="2" fill="currentColor"/>`,
    // Classic pixel starfield icon
    stars: `
    <rect x="3" y="2" width="1" height="3" fill="currentColor"/>
    <rect x="2" y="3" width="3" height="1" fill="currentColor"/>
    <rect x="11" y="4" width="1" height="5" fill="currentColor"/>
    <rect x="9" y="6" width="5" height="1" fill="currentColor"/>
    <rect x="6" y="10" width="1" height="3" fill="currentColor"/>
    <rect x="5" y="11" width="3" height="1" fill="currentColor"/>
    <rect x="12" y="12" width="1" height="1" fill="currentColor"/>`,
    // Retro 1-bit Terminal (solid screen with bright >_ prompt)
    terminal: `
    <path fill="currentColor" d="M1 2h14v12H1V2z"/>
    <path fill="var(--h84-surface, #fff)" d="M3 5h1v1H3zm1 1h1v1H4zm1 1h1v1H5zm-1 1h1v1H4zm-1 1h1v1H3z"/>
    <rect x="7" y="9" width="5" height="1" fill="var(--h84-surface, #fff)"/>`
  };
  function pixelIcon(doc, name, size = 16) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("h84-icon");
    svg.innerHTML = ICONS[name] || ICONS.happyMac;
    return svg;
  }
  function helloBootSvg(doc) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 260 96");
    svg.setAttribute("class", "h84-hello-svg");
    svg.setAttribute("aria-label", "hello.");
    svg.innerHTML = `
    <path class="h84-hello-path" d="M22 68 C 30 48, 42 18, 46 14 C 49 11, 44 38, 36 68 M 39 50 C 48 38, 60 36, 60 48 C 60 58, 56 68, 64 68 C 72 68, 82 58, 88 48 C 94 38, 82 36, 76 46 C 70 56, 76 69, 90 68 C 102 67, 114 48, 122 20 C 125 10, 116 18, 110 46 C 106 64, 112 70, 122 68 C 132 66, 146 48, 154 20 C 157 10, 148 18, 142 46 C 138 64, 144 70, 154 68 C 164 66, 174 56, 180 46 C 186 38, 198 38, 200 50 C 202 62, 190 70, 180 66 C 172 62, 174 44, 188 42 C 200 40, 208 48, 214 48" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="h84-hello-dot" cx="228" cy="64" r="4" fill="currentColor"/>
  `;
    return svg;
  }

  // src/apps/notepad.js
  var STORAGE_KEY = "notepad.v1";
  var MAX_PAGES = 16;
  function defaultState() {
    return {
      index: 0,
      pages: [
        "Hello '84 \u7FFB\u9875\u4FBF\u7B7E\n\u2014 \u8DE8\u4F1A\u8BDD\u6682\u5B58\u8349\u7A3F\u3001trace_id \u6216\u63D0\u793A\u8BCD\u7247\u6BB5\n\u2014 \u70B9\u51FB\u5DE6\u4E0B\u89D2\u6298\u89D2\u7FFB\u9875\uFF0C\u6216\u4E00\u952E\u6CE8\u5165\u5916\u90E8 DSH \u8F93\u5165\u6846",
        "",
        "",
        ""
      ]
    };
  }
  function createNotePadStore(win) {
    const prefs = getPrefs(win);
    const listeners = /* @__PURE__ */ new Set();
    function load() {
      const raw = prefs.get(STORAGE_KEY);
      if (raw && Array.isArray(raw.pages) && raw.pages.length) {
        const pages = raw.pages.slice(0, MAX_PAGES).map((p) => String(p ?? ""));
        const index = Math.max(0, Math.min(pages.length - 1, Number(raw.index) || 0));
        return { index, pages };
      }
      return defaultState();
    }
    let state = load();
    function save() {
      prefs.set(STORAGE_KEY, state);
      const snap = getSnapshot();
      for (const fn of listeners) {
        try {
          fn(snap);
        } catch {
        }
      }
    }
    function getSnapshot() {
      return { index: state.index, pages: [...state.pages] };
    }
    function setPageText(text) {
      state.pages[state.index] = String(text ?? "");
      save();
    }
    function goTo(idx) {
      state.index = (idx % state.pages.length + state.pages.length) % state.pages.length;
      save();
    }
    function nextPage() {
      goTo(state.index + 1);
    }
    function prevPage() {
      goTo(state.index - 1);
    }
    function addPage(initialText = "") {
      if (state.pages.length >= MAX_PAGES) {
        state.index = state.pages.length - 1;
        if (initialText) state.pages[state.index] = (state.pages[state.index] ? state.pages[state.index] + "\n\n" : "") + initialText;
        save();
        return state.index;
      }
      state.pages.push(String(initialText ?? ""));
      state.index = state.pages.length - 1;
      save();
      return state.index;
    }
    function appendNote(title, content) {
      const entry = title ? `[${title}]
${content}` : String(content ?? "");
      const emptyIdx = state.pages.findIndex((p) => !p.trim());
      if (emptyIdx !== -1) {
        state.index = emptyIdx;
        state.pages[emptyIdx] = entry;
        save();
        return emptyIdx;
      }
      return addPage(entry);
    }
    return {
      getSnapshot,
      setPageText,
      goTo,
      nextPage,
      prevPage,
      addPage,
      appendNote,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    };
  }
  function renderNotePad(doc, { win, bridge, noteStore, notify }) {
    const root = doc.createElement("div");
    root.className = "h84-notepad";
    const toolbar = doc.createElement("div");
    toolbar.className = "h84-app-bar";
    toolbar.innerHTML = `
    <button type="button" class="h84-btn" data-act="inject" title="\u5C06\u5F53\u524D\u9875\u5199\u5165\u5916\u90E8 DSH \u8F93\u5165\u6846">\u6CE8\u5165\u5916\u90E8\u8F93\u5165\u6846</button>
    <button type="button" class="h84-btn" data-act="copy">\u590D\u5236</button>
    <button type="button" class="h84-btn" data-act="add">+ \u65B0\u9875</button>
    <button type="button" class="h84-btn" data-act="clear">\u6E05\u7A7A</button>
  `;
    const area = doc.createElement("textarea");
    area.className = "h84-notepad-area";
    area.placeholder = "\u5728\u6B64\u5199\u4E0B\u4FBF\u7B7E\u2026";
    area.setAttribute("aria-label", "\u4FBF\u7B7E\u6B63\u6587");
    const footer = doc.createElement("div");
    footer.className = "h84-notepad-footer";
    footer.innerHTML = `
    <button type="button" class="h84-dogear" data-act="next" title="\u70B9\u51FB\u6298\u89D2\u7FFB\u5230\u4E0B\u4E00\u9875" aria-label="\u7FFB\u5230\u4E0B\u4E00\u9875"></button>
    <div class="h84-notepad-nav">
      <button type="button" class="h84-btn-sm" data-act="prev">\u25C0</button>
      <span class="h84-notepad-page">1 / 4</span>
      <button type="button" class="h84-btn-sm" data-act="next">\u25B6</button>
    </div>
  `;
    root.append(toolbar, area, footer);
    const pageLabel = footer.querySelector(".h84-notepad-page");
    function sync() {
      const snap = noteStore.getSnapshot();
      if (area.value !== snap.pages[snap.index]) {
        area.value = snap.pages[snap.index];
      }
      pageLabel.textContent = `Page ${snap.index + 1} / ${snap.pages.length}`;
    }
    const unsub = noteStore.subscribe(sync);
    area.addEventListener("input", () => {
      noteStore.setPageText(area.value);
    });
    root.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      sound.click(win);
      if (act === "next") noteStore.nextPage();
      else if (act === "prev") noteStore.prevPage();
      else if (act === "add") noteStore.addPage("");
      else if (act === "clear") noteStore.setPageText("");
      else if (act === "copy") {
        const text = area.value.trim();
        if (!text) return notify?.("\u5F53\u524D\u4FBF\u7B7E\u4E3A\u7A7A");
        try {
          await win.navigator.clipboard.writeText(text);
          notify?.("\u4FBF\u7B7E\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F");
        } catch {
          notify?.("\u526A\u8D34\u677F\u4E0D\u53EF\u7528");
        }
      } else if (act === "inject") {
        const text = area.value.trim();
        if (!text) return notify?.("\u5F53\u524D\u4FBF\u7B7E\u4E3A\u7A7A");
        const ok = bridge.fillHostDraft(text, { replace: false });
        notify?.(ok ? "\u5DF2\u6CE8\u5165\u5916\u90E8 DSH \u8F93\u5165\u6846" : "\u672A\u627E\u5230\u5916\u90E8 DSH \u8F93\u5165\u6846");
      }
    });
    sync();
    return { element: root, destroy: unsub };
  }

  // src/apps/floppy.js
  function formatConversationMarkdown(messages, { title = "", sanitize = true } = {}) {
    if (!Array.isArray(messages) || !messages.length) return "";
    const clean = (text) => sanitize ? sanitizePaths(text) : String(text || "");
    const lines = [];
    if (title) lines.push(`# ${clean(title)}`, "");
    for (const msg of messages) {
      const body = clean(msg.text).trim();
      if (!body) continue;
      lines.push(`## ${msg.role === "user" ? "\u7528\u6237" : "\u52A9\u624B"}`, "", body, "");
    }
    return lines.join("\n").trim();
  }
  var PALETTES = {
    classic: { bg: "#f4f4ec", fg: "#111111", muted: "#555550", card: "#ffffff", userBg: "#e8e8de" },
    green: { bg: "#07160b", fg: "#39ff7a", muted: "#1f9e49", card: "#0b2212", userBg: "#10311a" },
    amber: { bg: "#180f04", fg: "#ffb238", muted: "#b07419", card: "#241707", userBg: "#32200a" }
  };
  function wrapText(ctx, text, maxWidth) {
    const out = [];
    for (const rawLine of String(text || "").split("\n")) {
      if (!rawLine) {
        out.push("");
        continue;
      }
      let line = "";
      for (const ch of rawLine) {
        const test = line + ch;
        if (ctx.measureText(test).width > maxWidth && line) {
          out.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }
  function renderRetroCardToCanvas(canvas, { title = "DSH Session", messages = [], screenMode = "classic", sanitize = true } = {}) {
    const pal = PALETTES[screenMode] || PALETTES.classic;
    const width = 640;
    const pad = 24;
    const innerW = width - pad * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const clean = (text) => sanitize ? sanitizePaths(text) : String(text || "");
    const fontBody = '14px "SF Mono", Menlo, Monaco, Consolas, monospace';
    const fontBold = 'bold 14px "SF Mono", Menlo, Monaco, Consolas, monospace';
    ctx.font = fontBody;
    const blocks = [];
    const maxMsgs = messages.slice(-12);
    for (const msg of maxMsgs) {
      const lines = wrapText(ctx, clean(msg.text).trim().slice(0, 1200), innerW - 36);
      blocks.push({ role: msg.role, lines: lines.slice(0, 28) });
    }
    let height = 96;
    for (const b of blocks) {
      height += 26 + b.lines.length * 20 + 22;
    }
    height = Math.max(240, Math.min(2600, height + 44));
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, width, height);
    const wx = 14;
    const wy = 14;
    const ww = width - 28;
    const wh = height - 28;
    ctx.fillStyle = pal.fg;
    ctx.fillRect(wx + 4, wy + 4, ww, wh);
    ctx.fillStyle = pal.card;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeStyle = pal.fg;
    ctx.lineWidth = 2;
    ctx.strokeRect(wx, wy, ww, wh);
    const tbH = 30;
    for (let y = wy + 6; y < wy + tbH - 5; y += 4) {
      ctx.beginPath();
      ctx.moveTo(wx + 28, y);
      ctx.lineTo(wx + ww - 10, y);
      ctx.strokeStyle = pal.fg;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = pal.card;
    ctx.fillRect(wx + 8, wy + 7, 14, 14);
    ctx.strokeStyle = pal.fg;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(wx + 8, wy + 7, 14, 14);
    const displayTitle = ` ${clean(title || "DSH Archive").slice(0, 32)} `;
    ctx.font = fontBold;
    const tw = ctx.measureText(displayTitle).width + 12;
    ctx.fillStyle = pal.card;
    ctx.fillRect(wx + (ww - tw) / 2, wy + 4, tw, 20);
    ctx.fillStyle = pal.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayTitle, wx + ww / 2, wy + 15);
    ctx.beginPath();
    ctx.moveTo(wx, wy + tbH);
    ctx.lineTo(wx + ww, wy + tbH);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let cy = wy + tbH + 16;
    for (const b of blocks) {
      const bh = 22 + b.lines.length * 20 + 10;
      if (b.role === "user") {
        ctx.fillStyle = pal.userBg;
        ctx.fillRect(wx + 14, cy, ww - 28, bh);
      }
      ctx.strokeStyle = pal.fg;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(wx + 14, cy, ww - 28, bh);
      ctx.font = fontBold;
      ctx.fillStyle = pal.fg;
      ctx.fillText(b.role === "user" ? "\u25B8 USER" : "\uF8FF ASSISTANT", wx + 24, cy + 7);
      ctx.font = fontBody;
      let ly = cy + 28;
      for (const line of b.lines) {
        ctx.fillText(line, wx + 24, ly);
        ly += 20;
      }
      cy += bh + 12;
    }
    ctx.font = '11px "SF Mono", Menlo, monospace';
    ctx.fillStyle = pal.muted;
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ");
    ctx.fillText(`HELLO '84 \xB7 3.5" FLOPPY SNAPSHOT \xB7 ${stamp}`, wx + 16, wy + wh - 22);
    return canvas;
  }
  function renderFloppyDisk(doc, { win, bridge, getScreenMode, notify }) {
    const root = doc.createElement("div");
    root.className = "h84-floppy";
    root.innerHTML = `
    <div class="h84-floppy-head">
      <div class="h84-floppy-meta">\u5F53\u524D\u4F1A\u8BDD\uFF1A<strong data-meta-title>-</strong>\uFF08<span data-meta-count>0</span> \u6761\u6D88\u606F\uFF09</div>
      <label class="h84-check"><input type="checkbox" data-sanitize checked> \u5BFC\u51FA\u65F6\u81EA\u52A8\u8131\u654F\u672C\u673A\u8DEF\u5F84</label>
    </div>
    <div class="h84-app-bar">
      <button type="button" class="h84-btn" data-act="copy-md">\u590D\u5236 Markdown</button>
      <button type="button" class="h84-btn" data-act="dl-md">\u4E0B\u8F7D .md</button>
      <button type="button" class="h84-btn" data-act="render-png">\u751F\u6210\u590D\u53E4\u957F\u56FE</button>
      <button type="button" class="h84-btn" data-act="dl-png" disabled>\u4FDD\u5B58 PNG</button>
    </div>
    <div class="h84-floppy-preview">
      <div class="h84-floppy-empty">\u70B9\u51FB\u300C\u751F\u6210\u590D\u53E4\u957F\u56FE\u300D\u9884\u89C8 1984 Macintosh \u5206\u4EAB\u5361\u7247</div>
      <canvas class="h84-floppy-canvas" hidden></canvas>
    </div>
  `;
    const titleEl = root.querySelector("[data-meta-title]");
    const countEl = root.querySelector("[data-meta-count]");
    const sanitizeEl = root.querySelector("[data-sanitize]");
    const canvas = root.querySelector(".h84-floppy-canvas");
    const emptyEl = root.querySelector(".h84-floppy-empty");
    const dlPngBtn = root.querySelector('[data-act="dl-png"]');
    function refreshMeta() {
      const snap = bridge.getSnapshot();
      const msgs = bridge.getConversationMessages();
      titleEl.textContent = snap.sessionTitle || "\u5F53\u524D\u5BF9\u8BDD";
      countEl.textContent = String(msgs.length);
    }
    const unsub = bridge.subscribe(refreshMeta);
    refreshMeta();
    root.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const snap = bridge.getSnapshot();
      const msgs = bridge.getConversationMessages();
      const sanitize = sanitizeEl.checked;
      const title = snap.sessionTitle || "DSH-Session";
      if (!msgs.length) {
        notify?.("\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u6D88\u606F");
        return;
      }
      if (act === "copy-md") {
        sound.floppy(win);
        const md = formatConversationMarkdown(msgs, { title, sanitize });
        try {
          await win.navigator.clipboard.writeText(md);
          notify?.("Markdown \u5DF2\u5199\u5165\u526A\u8D34\u677F");
        } catch {
          notify?.("\u526A\u8D34\u677F\u4E0D\u53EF\u7528\uFF0C\u8BF7\u6539\u7528\u4E0B\u8F7D .md");
        }
      } else if (act === "dl-md") {
        sound.floppy(win);
        const md = formatConversationMarkdown(msgs, { title, sanitize });
        const blob = new win.Blob([md + "\n"], { type: "text/markdown;charset=utf-8" });
        const url = win.URL.createObjectURL(blob);
        const a = doc.createElement("a");
        a.href = url;
        a.download = `hello84-${Date.now()}.md`;
        a.click();
        win.setTimeout(() => win.URL.revokeObjectURL(url), 1e3);
        notify?.("\u5DF2\u5BFC\u51FA Markdown \u5230\u8F6F\u76D8");
      } else if (act === "render-png") {
        sound.floppy(win);
        renderRetroCardToCanvas(canvas, {
          title,
          messages: msgs,
          screenMode: getScreenMode?.() || "classic",
          sanitize
        });
        canvas.hidden = false;
        emptyEl.hidden = true;
        dlPngBtn.disabled = false;
        notify?.("\u590D\u53E4\u957F\u56FE\u5DF2\u6E32\u67D3");
      } else if (act === "dl-png") {
        sound.floppy(win);
        const url = canvas.toDataURL("image/png");
        const a = doc.createElement("a");
        a.href = url;
        a.download = `hello84-card-${Date.now()}.png`;
        a.click();
        notify?.("\u590D\u53E4\u957F\u56FE PNG \u5DF2\u4FDD\u5B58");
      }
    });
    return { element: root, destroy: unsub };
  }

  // src/apps/alarm.js
  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  function createAlarmStore(win, bridge, onRing) {
    const prefs = getPrefs(win);
    const listeners = /* @__PURE__ */ new Set();
    let timer = null;
    let state = {
      running: false,
      paused: false,
      remaining: 25 * 60,
      total: 25 * 60,
      label: "\u756A\u8304\u949F",
      watchComplete: prefs.get("alarm.watchComplete", true),
      watchAttention: prefs.get("alarm.watchAttention", true)
    };
    function emit() {
      const snap = { ...state };
      for (const fn of listeners) {
        try {
          fn(snap);
        } catch {
        }
      }
    }
    function stopInterval() {
      if (timer) {
        win.clearInterval(timer);
        timer = null;
      }
    }
    function start(minutes = 25, label = "\u5012\u8BA1\u65F6") {
      const secs = Math.max(1, Math.round(Number(minutes) * 60));
      stopInterval();
      state = { ...state, running: true, paused: false, remaining: secs, total: secs, label: label || "\u5012\u8BA1\u65F6" };
      timer = win.setInterval(() => {
        if (!state.running || state.paused) return;
        state.remaining = Math.max(0, state.remaining - 1);
        if (state.remaining <= 0) {
          stopInterval();
          state.running = false;
          state.paused = false;
          sound.alarm(win, false);
          onRing?.(`\u95F9\u949F\u5230\u70B9\uFF1A${state.label}`, "alarm");
        }
        emit();
      }, 1e3);
      emit();
    }
    function togglePause() {
      if (!state.running) return;
      state.paused = !state.paused;
      emit();
    }
    function reset() {
      stopInterval();
      state = { ...state, running: false, paused: false, remaining: state.total };
      emit();
    }
    function setWatch(key, value) {
      const bool = Boolean(value);
      state[key] = bool;
      prefs.set(`alarm.${key}`, bool);
      emit();
    }
    const unsubBridge = bridge.onTransition((prev, next, info) => {
      const wasActive = ["thinking", "working", "tool", "busy"].includes(prev);
      if (state.watchComplete && wasActive && next === "idle") {
        sound.happy(win);
        onRing?.(`\u5916\u90E8\u4EFB\u52A1\u5DF2\u5B8C\u6210\uFF1A${info.sessionTitle || "\u5F53\u524D\u4F1A\u8BDD"}`, "complete");
      } else if (state.watchAttention && next === "waiting") {
        sound.happy(win);
        onRing?.(`\u5916\u90E8\u4F1A\u8BDD\u7B49\u5F85\u5BA1\u6279\uFF1A${info.sessionTitle || "\u5F53\u524D\u4F1A\u8BDD"}`, "waiting");
      } else if (state.watchAttention && next === "error") {
        sound.sad(win);
        onRing?.(`\u5916\u90E8\u4F1A\u8BDD\u53D1\u751F\u5F02\u5E38\uFF1A${info.sessionTitle || "\u5F53\u524D\u4F1A\u8BDD"}`, "error");
      }
    });
    return {
      getSnapshot: () => ({ ...state }),
      start,
      togglePause,
      reset,
      setWatch,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      destroy() {
        stopInterval();
        unsubBridge();
        listeners.clear();
      }
    };
  }
  function renderAlarmClock(doc, { win, alarmStore, notify }) {
    const root = doc.createElement("div");
    root.className = "h84-alarm";
    root.innerHTML = `
    <div class="h84-alarm-face">
      <div class="h84-alarm-clock" data-wall>00:00:00</div>
      <div class="h84-alarm-countdown" data-cd>25:00</div>
      <div class="h84-alarm-label" data-label>\u756A\u8304\u949F \xB7 \u5F85\u673A</div>
    </div>
    <div class="h84-app-bar">
      <button type="button" class="h84-btn" data-preset="5">5m</button>
      <button type="button" class="h84-btn" data-preset="15">15m</button>
      <button type="button" class="h84-btn" data-preset="25">25m</button>
      <input type="number" class="h84-input-num" data-custom min="1" max="180" value="10" aria-label="\u81EA\u5B9A\u4E49\u5206\u949F">
      <button type="button" class="h84-btn" data-act="start-custom">\u542F\u52A8</button>
    </div>
    <div class="h84-app-bar">
      <button type="button" class="h84-btn" data-act="pause">\u6682\u505C/\u7EE7\u7EED</button>
      <button type="button" class="h84-btn" data-act="reset">\u91CD\u7F6E</button>
      <button type="button" class="h84-btn" data-act="ding">\u8BD5\u542C\u53EE\u4E00\u58F0</button>
    </div>
    <div class="h84-alarm-watches">
      <label class="h84-check"><input type="checkbox" data-watch="watchComplete"> \u5916\u90E8 DSH \u4EFB\u52A1\u8DD1\u5B8C\u65F6\u53EE\u6211</label>
      <label class="h84-check"><input type="checkbox" data-watch="watchAttention"> \u5361\u5BA1\u6279 / \u62A5\u9519\u65F6\u5F39\u7A97\u63D0\u9192</label>
    </div>
  `;
    const wallEl = root.querySelector("[data-wall]");
    const cdEl = root.querySelector("[data-cd]");
    const labelEl = root.querySelector("[data-label]");
    const customInput = root.querySelector("[data-custom]");
    const watchCompleteEl = root.querySelector('[data-watch="watchComplete"]');
    const watchAttentionEl = root.querySelector('[data-watch="watchAttention"]');
    function tickWall() {
      const now = /* @__PURE__ */ new Date();
      wallEl.textContent = now.toTimeString().slice(0, 8);
    }
    tickWall();
    const wallTimer = win.setInterval(tickWall, 1e3);
    function sync() {
      const snap = alarmStore.getSnapshot();
      cdEl.textContent = formatDuration(snap.remaining);
      labelEl.textContent = `${snap.label} \xB7 ${snap.running ? snap.paused ? "\u5DF2\u6682\u505C" : "\u8BA1\u65F6\u4E2D" : "\u5F85\u673A"}`;
      watchCompleteEl.checked = snap.watchComplete;
      watchAttentionEl.checked = snap.watchAttention;
    }
    const unsub = alarmStore.subscribe(sync);
    sync();
    root.addEventListener("click", (e) => {
      const preset = e.target.closest("[data-preset]");
      if (preset) {
        sound.click(win);
        const mins = Number(preset.dataset.preset);
        alarmStore.start(mins, `${mins} \u5206\u949F\u4E13\u6CE8`);
        notify?.(`\u5DF2\u542F\u52A8 ${mins} \u5206\u949F\u5012\u8BA1\u65F6`);
        return;
      }
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      sound.click(win);
      if (act === "start-custom") {
        const mins = Math.max(1, Number(customInput.value) || 10);
        alarmStore.start(mins, `${mins} \u5206\u949F\u5012\u8BA1\u65F6`);
        notify?.(`\u5DF2\u542F\u52A8 ${mins} \u5206\u949F\u5012\u8BA1\u65F6`);
      } else if (act === "pause") {
        alarmStore.togglePause();
      } else if (act === "reset") {
        alarmStore.reset();
      } else if (act === "ding") {
        sound.alarm(win, true);
        notify?.("\u53EE\uFF01\u590D\u53E4\u63D0\u793A\u97F3\u6D4B\u8BD5");
      }
    });
    root.addEventListener("change", (e) => {
      const w = e.target.closest("[data-watch]");
      if (!w) return;
      alarmStore.setWatch(w.dataset.watch, w.checked);
    });
    return {
      element: root,
      destroy() {
        win.clearInterval(wallTimer);
        unsub();
      }
    };
  }

  // src/apps/mini-dsh.js
  var CONFIG_KEY = "minidsh.config.v1";
  var DEFAULT_SIDECAR_CONFIG = {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-flash",
    proxyUrl: ""
  };
  var SIDECAR_TOOLS = [
    {
      type: "function",
      function: {
        name: "write_note",
        description: "Write a snippet or summary into the Macintosh Note Pad app.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short note title" },
            content: { type: "string", description: "Note body text" }
          },
          required: ["content"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "set_alarm",
        description: "Start a countdown timer in the Macintosh Alarm Clock app.",
        parameters: {
          type: "object",
          properties: {
            minutes: { type: "number", description: "Countdown duration in minutes" },
            label: { type: "string", description: "Short label for the alarm" }
          },
          required: ["minutes"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "fill_host_draft",
        description: "Insert or replace text in the external DSH composer input box.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to place into the host composer" },
            replace: { type: "boolean", description: "Whether to replace existing draft" }
          },
          required: ["text"]
        }
      }
    }
  ];
  async function runSidecarTurn({ config, messages, toolHandlers = {}, fetchImpl = globalThis.fetch }) {
    if (!config?.apiKey?.trim()) {
      throw new Error("\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199 API Key\uFF08\u652F\u6301 DeepSeek \u6216\u4EFB\u610F OpenAI \u517C\u5BB9\u63A5\u53E3\uFF09");
    }
    const endpoint = `${String(config.baseUrl || DEFAULT_SIDECAR_CONFIG.baseUrl).replace(/\/+$/, "")}/chat/completions`;
    const useProxy = Boolean(config.proxyUrl?.trim());
    const targetUrl = useProxy ? config.proxyUrl.trim() : endpoint;
    const history = [
      {
        role: "system",
        content: "\u4F60\u662F\u8FD0\u884C\u5728 1984 Macintosh \u91CC\u7684 Mini DSH \u65C1\u8DEF\u526F\u8111\u3002\u56DE\u7B54\u7B80\u6D01\u3001\u76F4\u63A5\u3001\u5B9E\u7528\uFF0C\u9ED8\u8BA4\u7528\u4E2D\u6587\u3002\u5FC5\u8981\u65F6\u53EF\u8C03\u7528 write_note\u3001set_alarm \u6216 fill_host_draft \u5DE5\u5177\u3002"
      },
      ...messages
    ];
    const toolLogs = [];
    let finalReply = "";
    for (let step = 0; step < 3; step++) {
      const payload = {
        model: config.model || "deepseek-flash",
        messages: history,
        tools: SIDECAR_TOOLS,
        temperature: 0.4
      };
      const fetchOpts = useProxy ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: endpoint,
          authorization: `Bearer ${config.apiKey.trim()}`,
          payload
        })
      } : {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey.trim()}`
        },
        body: JSON.stringify(payload)
      };
      let res;
      try {
        res = await fetchImpl(targetUrl, fetchOpts);
      } catch (err) {
        throw new Error(`\u7F51\u7EDC/CORS \u8BF7\u6C42\u5931\u8D25\uFF1A${err?.message || err}\u3002\u82E5\u76EE\u6807\u63A5\u53E3\u672A\u5F00\u653E\u6D4F\u89C8\u5668 CORS\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199\u4EE3\u7406\u5730\u5740\uFF08\u5982 /hello84/proxy\uFF09\u3002`);
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`\u63A5\u53E3\u8FD4\u56DE HTTP ${res.status}\uFF1A${errText.slice(0, 180)}`);
      }
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new Error("\u6A21\u578B\u8FD4\u56DE\u683C\u5F0F\u5F02\u5E38\uFF08\u7F3A\u5C11 choices[0].message\uFF09");
      const calls = msg.tool_calls || [];
      if (!calls.length) {
        finalReply = msg.content || "";
        break;
      }
      history.push(msg);
      for (const call of calls) {
        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
        }
        let result = { ok: false, error: `Unknown tool: ${name}` };
        if (typeof toolHandlers[name] === "function") {
          try {
            result = await toolHandlers[name](args);
          } catch (err) {
            result = { ok: false, error: String(err?.message || err) };
          }
        }
        toolLogs.push({ name, args, result });
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
    }
    return { reply: finalReply || "\uFF08\u5DE5\u5177\u5DF2\u6267\u884C\u5B8C\u6BD5\uFF09", toolLogs };
  }
  var STATUS_GLYPH = {
    idle: "\u25CB",
    thinking: "\u25F7",
    working: "\u25CF",
    tool: "\u25A3",
    busy: "\u25CF",
    waiting: "!",
    error: "\u2715"
  };
  function renderMiniDsh(doc, { win, bridge, noteStore, alarmStore, notify }) {
    const prefs = getPrefs(win);
    const savedConfig = { ...DEFAULT_SIDECAR_CONFIG, ...prefs.get(CONFIG_KEY) || {} };
    let activeTab = "remote";
    let showConfig = false;
    let busy = false;
    const sidecarMessages = [];
    const root = doc.createElement("div");
    root.className = "h84-minidsh";
    root.innerHTML = `
    <div class="h84-tabs">
      <button type="button" class="h84-tab is-active" data-tab="remote">\u5BBF\u4E3B\u9065\u63A7 (\u96F6\u914D\u7F6E)</button>
      <button type="button" class="h84-tab" data-tab="sidecar">\u65C1\u8DEF\u526F\u8111 (\u914D Key)</button>
    </div>
    <div class="h84-pane" data-pane="remote">
      <div class="h84-remote-status" data-status-bar>\u72B6\u6001\uFF1AIDLE</div>
      <div class="h84-session-list" data-sessions></div>
      <div class="h84-terminal-bar">
        <input type="text" class="h84-input" data-remote-input placeholder="\u8F93\u5165\u6307\u4EE4\u586B\u5165\u6216\u53D1\u5F80\u5916\u90E8 DSH\u2026">
        <button type="button" class="h84-btn" data-act="fill">\u586B\u5165</button>
        <button type="button" class="h84-btn" data-act="send">\u53D1\u9001</button>
      </div>
    </div>
    <div class="h84-pane" data-pane="sidecar" hidden>
      <div class="h84-app-bar">
        <button type="button" class="h84-btn" data-quick="polish">\u6DA6\u8272\u8349\u7A3F</button>
        <button type="button" class="h84-btn" data-quick="critique">\u6311\u523A\u56DE\u590D</button>
        <button type="button" class="h84-btn" data-quick="translate">\u7FFB\u8BD1</button>
        <button type="button" class="h84-btn" data-quick="summary">\u603B\u7ED3</button>
        <button type="button" class="h84-btn" data-act="toggle-cfg">\u2699 API</button>
      </div>
      <div class="h84-sidecar-cfg" data-cfg hidden>
        <label>Base URL<input type="text" data-field="baseUrl"></label>
        <label>API Key<input type="password" data-field="apiKey" placeholder="sk-..."></label>
        <label>Model<input type="text" data-field="model"></label>
        <label>Proxy (\u53EF\u9009)<input type="text" data-field="proxyUrl" placeholder="\u7559\u7A7A\u76F4\u8FDE\uFF0C\u6216\u586B /hello84/proxy"></label>
        <button type="button" class="h84-btn" data-act="save-cfg">\u4FDD\u5B58\u914D\u7F6E</button>
      </div>
      <div class="h84-sidecar-log" data-log>
        <div class="h84-msg h84-msg-sys">READY. \u914D Key \u540E\u53EF\u72EC\u7ACB\u65C1\u8DEF\u95EE\u7B54\uFF0C\u5E76\u53EF\u81EA\u52A8\u8C03\u7528 Note Pad / Alarm / \u5916\u90E8\u8349\u7A3F\u3002</div>
      </div>
      <div class="h84-terminal-bar">
        <input type="text" class="h84-input" data-sidecar-input placeholder="\u95EE\u526F\u8111\uFF0C\u4E0D\u6C61\u67D3\u4E3B\u4F1A\u8BDD\u2026">
        <button type="button" class="h84-btn" data-act="ask">\u95EE</button>
        <button type="button" class="h84-btn" data-act="clear-log">\u6E05</button>
      </div>
    </div>
  `;
    const statusBar = root.querySelector("[data-status-bar]");
    const sessionsEl = root.querySelector("[data-sessions]");
    const remoteInput = root.querySelector("[data-remote-input]");
    const cfgBox = root.querySelector("[data-cfg]");
    const logEl = root.querySelector("[data-log]");
    const sidecarInput = root.querySelector("[data-sidecar-input]");
    function fillConfigInputs() {
      for (const key of ["baseUrl", "apiKey", "model", "proxyUrl"]) {
        cfgBox.querySelector(`[data-field="${key}"]`).value = savedConfig[key] || "";
      }
    }
    fillConfigInputs();
    function renderRemote() {
      const snap = bridge.getSnapshot();
      statusBar.textContent = `[${snap.workspaceName || "DSH"}] ${snap.sessionTitle || "\u4E3B\u754C\u9762"} \xB7 ${snap.status.toUpperCase()}`;
      sessionsEl.replaceChildren();
      if (!snap.sessions.length) {
        const empty = doc.createElement("div");
        empty.className = "h84-empty";
        empty.textContent = "\u6682\u65E0\u540C\u6B65\u4F1A\u8BDD\uFF08\u6253\u5F00 DSH \u5DE5\u4F5C\u533A\u540E\u81EA\u52A8\u540C\u6B65\uFF09";
        sessionsEl.append(empty);
        return;
      }
      for (const s of snap.sessions) {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "h84-session-row" + (s.id === snap.sessionId ? " is-current" : "") + (s.waiting ? " is-waiting" : "");
        btn.dataset.openSession = s.id;
        const glyph = STATUS_GLYPH[s.status] || "\u25CB";
        btn.textContent = `${glyph} ${s.title}`;
        sessionsEl.append(btn);
      }
    }
    function appendLog(kind, text) {
      const item = doc.createElement("div");
      item.className = `h84-msg h84-msg-${kind}`;
      item.textContent = text;
      logEl.append(item);
      logEl.scrollTop = logEl.scrollHeight;
    }
    const toolHandlers = {
      write_note({ title, content }) {
        const idx = noteStore.appendNote(title || "Mini DSH", content || "");
        notify?.(`\u526F\u8111\u5DF2\u5199\u5165\u4FBF\u7B7E\u7B2C ${idx + 1} \u9875`);
        return { ok: true, page: idx + 1 };
      },
      set_alarm({ minutes, label }) {
        alarmStore.start(minutes || 5, label || "\u526F\u8111\u63D0\u9192");
        notify?.(`\u526F\u8111\u5DF2\u8BBE\u5B9A ${minutes} \u5206\u949F\u95F9\u949F`);
        return { ok: true, minutes };
      },
      fill_host_draft({ text, replace }) {
        const ok = bridge.fillHostDraft(text || "", { replace: Boolean(replace) });
        notify?.(ok ? "\u526F\u8111\u5DF2\u56DE\u586B\u5916\u90E8\u8349\u7A3F" : "\u672A\u627E\u5230\u5916\u90E8\u8F93\u5165\u6846");
        return { ok };
      }
    };
    async function askSidecar(promptText) {
      const text = String(promptText || "").trim();
      if (!text || busy) return;
      busy = true;
      sidecarMessages.push({ role: "user", content: text });
      appendLog("user", `> ${text}`);
      try {
        const { reply, toolLogs } = await runSidecarTurn({
          config: savedConfig,
          messages: sidecarMessages.slice(-10),
          toolHandlers,
          fetchImpl: win.fetch?.bind(win) || globalThis.fetch
        });
        for (const tl of toolLogs) {
          appendLog("tool", `[TOOL:${tl.name}] ${JSON.stringify(tl.result)}`);
        }
        sidecarMessages.push({ role: "assistant", content: reply });
        appendLog("assistant", reply);
      } catch (err) {
        appendLog("error", String(err?.message || err));
      } finally {
        busy = false;
      }
    }
    const unsub = bridge.subscribe(renderRemote);
    renderRemote();
    root.addEventListener("click", (e) => {
      const tabBtn = e.target.closest("[data-tab]");
      if (tabBtn) {
        sound.click(win);
        activeTab = tabBtn.dataset.tab;
        for (const b of root.querySelectorAll("[data-tab]")) b.classList.toggle("is-active", b.dataset.tab === activeTab);
        for (const p of root.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== activeTab;
        return;
      }
      const openRow = e.target.closest("[data-open-session]");
      if (openRow) {
        sound.click(win);
        bridge.openSession(openRow.dataset.openSession);
        notify?.("\u5DF2\u5207\u6362\u5916\u90E8 DSH \u4F1A\u8BDD");
        return;
      }
      const quick = e.target.closest("[data-quick]");
      if (quick) {
        sound.click(win);
        const kind = quick.dataset.quick;
        const draft = bridge.getHostDraft().trim();
        const last = bridge.getLatestAssistantMessage().trim();
        if (kind === "polish") {
          if (!draft) return notify?.("\u5916\u90E8\u8F93\u5165\u6846\u6682\u65E0\u8349\u7A3F");
          askSidecar(`\u8BF7\u5E2E\u6211\u6DA6\u8272\u4EE5\u4E0B\u51C6\u5907\u53D1\u7ED9 AI \u7684\u8349\u7A3F\uFF0C\u4F7F\u5176\u66F4\u6E05\u6670\u5177\u4F53\uFF1A

${draft}`);
        } else if (kind === "critique") {
          if (!last) return notify?.("\u5F53\u524D\u4F1A\u8BDD\u6682\u65E0\u52A9\u624B\u56DE\u590D\u53EF\u6311\u523A");
          askSidecar(`\u8BF7\u5BA1\u67E5\u4EE5\u4E0B\u56DE\u590D\uFF0C\u6307\u51FA\u6F0F\u6D1E\u3001\u9057\u6F0F\u6216\u6F5C\u5728\u98CE\u9669\uFF1A

${last.slice(0, 3e3)}`);
        } else if (kind === "translate") {
          const src = draft || last;
          if (!src) return notify?.("\u6CA1\u6709\u53EF\u7FFB\u8BD1\u7684\u8349\u7A3F\u6216\u56DE\u590D");
          askSidecar(`\u8BF7\u5C06\u4EE5\u4E0B\u5185\u5BB9\u81EA\u7136\u5730\u7FFB\u8BD1\uFF08\u4E2D\u8BD1\u82F1\u6216\u82F1\u8BD1\u4E2D\uFF09\uFF1A

${src.slice(0, 3e3)}`);
        } else if (kind === "summary") {
          if (!last) return notify?.("\u5F53\u524D\u4F1A\u8BDD\u6682\u65E0\u52A9\u624B\u56DE\u590D\u53EF\u603B\u7ED3");
          askSidecar(`\u8BF7\u7528 3-5 \u6761\u8981\u70B9\u603B\u7ED3\u4EE5\u4E0B\u5185\u5BB9\uFF1A

${last.slice(0, 3e3)}`);
        }
        return;
      }
      const actBtn = e.target.closest("[data-act]");
      if (!actBtn) return;
      const act = actBtn.dataset.act;
      sound.click(win);
      if (act === "fill") {
        const val = remoteInput.value.trim();
        if (!val) return;
        const ok = bridge.fillHostDraft(val, { replace: false });
        if (ok) remoteInput.value = "";
        notify?.(ok ? "\u5DF2\u586B\u5165\u5916\u90E8\u8F93\u5165\u6846" : "\u672A\u627E\u5230\u5916\u90E8\u8F93\u5165\u6846");
      } else if (act === "send") {
        const val = remoteInput.value.trim();
        if (!val) return;
        const ok = bridge.sendHostMessage(val);
        if (ok) remoteInput.value = "";
        notify?.(ok ? "\u5DF2\u53D1\u9001\u81F3\u5916\u90E8 DSH" : "\u53D1\u9001\u5931\u8D25\uFF08\u672A\u627E\u5230\u8F93\u5165\u6846\uFF09");
      } else if (act === "toggle-cfg") {
        showConfig = !showConfig;
        cfgBox.hidden = !showConfig;
      } else if (act === "save-cfg") {
        for (const key of ["baseUrl", "apiKey", "model", "proxyUrl"]) {
          savedConfig[key] = cfgBox.querySelector(`[data-field="${key}"]`).value.trim();
        }
        prefs.set(CONFIG_KEY, savedConfig);
        showConfig = false;
        cfgBox.hidden = true;
        notify?.("Sidecar API \u914D\u7F6E\u5DF2\u4FDD\u5B58");
      } else if (act === "ask") {
        const val = sidecarInput.value.trim();
        if (!val) return;
        sidecarInput.value = "";
        askSidecar(val);
      } else if (act === "clear-log") {
        sidecarMessages.length = 0;
        logEl.replaceChildren();
        appendLog("sys", "SESSION CLEARED.");
      }
    });
    remoteInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        root.querySelector('[data-act="send"]').click();
      }
    });
    sidecarInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        root.querySelector('[data-act="ask"]').click();
      }
    });
    function switchToSidecar(promptText = "") {
      activeTab = "sidecar";
      for (const b of root.querySelectorAll("[data-tab]")) b.classList.toggle("is-active", b.dataset.tab === activeTab);
      for (const p of root.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== activeTab;
      if (promptText) {
        sidecarInput.value = promptText;
        sidecarInput.focus();
      }
    }
    return { element: root, switchToSidecar, destroy: unsub };
  }

  // src/apps/macpaint.js
  var MODE_COLORS = {
    classic: { bg: "#ffffff", fg: "#111111" },
    green: { bg: "#07160b", fg: "#39ff7a" },
    amber: { bg: "#180f04", fg: "#ffb238" }
  };
  function renderMacPaint(doc, { win, getScreenMode, notify }) {
    const root = doc.createElement("div");
    root.className = "h84-paint";
    root.innerHTML = `
    <div class="h84-app-bar">
      <button type="button" class="h84-btn is-active" data-tool="pen">\u753B\u7B14</button>
      <button type="button" class="h84-btn" data-tool="spray">\u55B7\u67AA</button>
      <button type="button" class="h84-btn" data-tool="eraser">\u6A61\u76AE</button>
      <select class="h84-select" data-size aria-label="\u753B\u7B14\u7C97\u7EC6">
        <option value="2">2px</option>
        <option value="4" selected>4px</option>
        <option value="8">8px</option>
      </select>
      <button type="button" class="h84-btn" data-act="clear">\u6E05\u7A7A</button>
      <button type="button" class="h84-btn" data-act="save">\u5B58 PNG</button>
    </div>
    <div class="h84-paint-stage">
      <canvas class="h84-paint-canvas" width="320" height="190"></canvas>
    </div>
  `;
    const canvas = root.querySelector(".h84-paint-canvas");
    const ctx = canvas.getContext("2d");
    const sizeSel = root.querySelector("[data-size]");
    let tool = "pen";
    let drawing = false;
    function colors() {
      return MODE_COLORS[getScreenMode?.() || "classic"] || MODE_COLORS.classic;
    }
    function clearCanvas() {
      if (!ctx) return;
      ctx.fillStyle = colors().bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    clearCanvas();
    function point(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, rect.width);
      const scaleY = canvas.height / Math.max(1, rect.height);
      return {
        x: Math.floor((e.clientX - rect.left) * scaleX),
        y: Math.floor((e.clientY - rect.top) * scaleY)
      };
    }
    function paintAt(x, y) {
      if (!ctx) return;
      const size = Number(sizeSel.value) || 4;
      const pal = colors();
      if (tool === "spray") {
        ctx.fillStyle = pal.fg;
        const radius = size * 2.5;
        for (let i = 0; i < 14; i++) {
          const dx = Math.round((Math.random() * 2 - 1) * radius);
          const dy = Math.round((Math.random() * 2 - 1) * radius);
          if (dx * dx + dy * dy <= radius * radius) {
            ctx.fillRect(x + dx, y + dy, 2, 2);
          }
        }
        return;
      }
      ctx.fillStyle = tool === "eraser" ? pal.bg : pal.fg;
      ctx.fillRect(x - Math.floor(size / 2), y - Math.floor(size / 2), size, size);
    }
    canvas.addEventListener("pointerdown", (e) => {
      drawing = true;
      canvas.setPointerCapture?.(e.pointerId);
      const pt = point(e);
      paintAt(pt.x, pt.y);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const pt = point(e);
      paintAt(pt.x, pt.y);
    });
    const stop = () => {
      drawing = false;
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tool]");
      if (t) {
        sound.click(win);
        tool = t.dataset.tool;
        for (const b of root.querySelectorAll("[data-tool]")) b.classList.toggle("is-active", b.dataset.tool === tool);
        return;
      }
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      sound.click(win);
      if (act === "clear") {
        clearCanvas();
      } else if (act === "save") {
        const a = doc.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `macpaint-${Date.now()}.png`;
        a.click();
        notify?.("MacPaint \u753B\u4F5C\u5DF2\u4FDD\u5B58");
      }
    });
    return { element: root, destroy() {
    } };
  }

  // src/apps/minesweeper.js
  function createMinesweeperGame(rows = 9, cols = 9, mineCount = 10, rng = Math.random) {
    let board = [];
    let placed = false;
    let status = "ready";
    let flags = 0;
    let revealedCount = 0;
    function initEmpty() {
      board = Array.from(
        { length: rows },
        (_, r) => Array.from({ length: cols }, (_2, c) => ({
          r,
          c,
          mine: false,
          revealed: false,
          flagged: false,
          adjacent: 0
        }))
      );
      placed = false;
      status = "ready";
      flags = 0;
      revealedCount = 0;
    }
    function neighbors(r, c) {
      const list = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) list.push(board[nr][nc]);
        }
      }
      return list;
    }
    function placeMines(safeR, safeC) {
      const candidates = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (r === safeR && c === safeC) continue;
          candidates.push([r, c]);
        }
      }
      const target = Math.min(mineCount, candidates.length);
      for (let i = 0; i < target; i++) {
        const pick = i + Math.floor(rng() * (candidates.length - i));
        [candidates[i], candidates[pick]] = [candidates[pick], candidates[i]];
        const [mr, mc] = candidates[i];
        board[mr][mc].mine = true;
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          board[r][c].adjacent = neighbors(r, c).filter((n) => n.mine).length;
        }
      }
      placed = true;
    }
    function reveal(r, c) {
      if (status === "won" || status === "lost") return status;
      const cell = board[r]?.[c];
      if (!cell || cell.revealed || cell.flagged) return status;
      if (!placed) {
        placeMines(r, c);
        status = "playing";
      }
      if (cell.mine) {
        cell.revealed = true;
        status = "lost";
        for (const row of board) for (const item of row) if (item.mine) item.revealed = true;
        return status;
      }
      const queue = [cell];
      while (queue.length) {
        const cur = queue.shift();
        if (cur.revealed || cur.flagged) continue;
        cur.revealed = true;
        revealedCount++;
        if (cur.adjacent === 0) {
          for (const n of neighbors(cur.r, cur.c)) {
            if (!n.revealed && !n.mine) queue.push(n);
          }
        }
      }
      if (revealedCount >= rows * cols - mineCount) {
        status = "won";
      }
      return status;
    }
    function toggleFlag(r, c) {
      if (status === "won" || status === "lost") return status;
      const cell = board[r]?.[c];
      if (!cell || cell.revealed) return status;
      cell.flagged = !cell.flagged;
      flags += cell.flagged ? 1 : -1;
      return status;
    }
    initEmpty();
    return {
      rows,
      cols,
      mineCount,
      reset: initEmpty,
      reveal,
      toggleFlag,
      getState() {
        return {
          status,
          minesLeft: mineCount - flags,
          revealedCount,
          board
        };
      }
    };
  }
  function renderMinesweeper(doc, { win, notify }) {
    const game = createMinesweeperGame(9, 9, 10);
    const root = doc.createElement("div");
    root.className = "h84-mine";
    root.innerHTML = `
    <div class="h84-mine-bar">
      <span class="h84-mine-counter" data-left>010</span>
      <button type="button" class="h84-btn h84-mine-reset" data-reset>:-)</button>
      <span class="h84-mine-counter" data-time>000</span>
    </div>
    <div class="h84-mine-grid" data-grid></div>
    <div class="h84-mine-hint">\u5DE6\u952E\u7FFB\u5F00 \xB7 \u53F3\u952E\u63D2\u65D7</div>
  `;
    const leftEl = root.querySelector("[data-left]");
    const resetBtn = root.querySelector("[data-reset]");
    const timeEl = root.querySelector("[data-time]");
    const gridEl = root.querySelector("[data-grid]");
    let seconds = 0;
    let timer = null;
    function stopTimer() {
      if (timer) {
        win.clearInterval(timer);
        timer = null;
      }
    }
    function ensureTimer() {
      if (timer) return;
      timer = win.setInterval(() => {
        seconds = Math.min(999, seconds + 1);
        timeEl.textContent = String(seconds).padStart(3, "0");
      }, 1e3);
    }
    function draw() {
      const st = game.getState();
      leftEl.textContent = String(Math.max(-99, st.minesLeft)).padStart(3, "0");
      resetBtn.textContent = st.status === "lost" ? "X-(" : st.status === "won" ? "B-)" : ":-)";
      if (st.status === "won" || st.status === "lost") stopTimer();
      gridEl.replaceChildren();
      for (let r = 0; r < game.rows; r++) {
        for (let c = 0; c < game.cols; c++) {
          const cell = st.board[r][c];
          const btn = doc.createElement("button");
          btn.type = "button";
          btn.className = "h84-mine-cell" + (cell.revealed ? " is-open" : "") + (cell.mine && cell.revealed ? " is-mine" : "");
          btn.dataset.r = String(r);
          btn.dataset.c = String(c);
          if (cell.revealed) {
            btn.textContent = cell.mine ? "*" : cell.adjacent ? String(cell.adjacent) : "";
          } else if (cell.flagged) {
            btn.textContent = "P";
          }
          gridEl.append(btn);
        }
      }
    }
    gridEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".h84-mine-cell");
      if (!btn) return;
      sound.click(win);
      const prev = game.getState().status;
      const next = game.reveal(Number(btn.dataset.r), Number(btn.dataset.c));
      if (next === "playing") ensureTimer();
      if (next === "lost" && prev !== "lost") {
        sound.sad(win);
        notify?.("\u8E29\u96F7\u4E86\uFF01\u70B9\u7B11\u8138\u91CD\u5F00");
      } else if (next === "won" && prev !== "won") {
        sound.happy(win);
        notify?.(`\u626B\u96F7\u901A\u5173\uFF01\u7528\u65F6 ${seconds}s`);
      }
      draw();
    });
    gridEl.addEventListener("contextmenu", (e) => {
      const btn = e.target.closest(".h84-mine-cell");
      if (!btn) return;
      e.preventDefault();
      sound.click(win);
      game.toggleFlag(Number(btn.dataset.r), Number(btn.dataset.c));
      draw();
    });
    resetBtn.addEventListener("click", () => {
      sound.click(win);
      stopTimer();
      seconds = 0;
      timeEl.textContent = "000";
      game.reset();
      draw();
    });
    draw();
    return { element: root, destroy: stopTimer };
  }

  // src/innerlife.js
  var STORAGE_KEY2 = "innerlife.v1";
  var SIDECAR_CONFIG_KEY = "minidsh.config.v1";
  var NO_SHARE_SENTINEL = "[NO_SHARE]";
  var MAX_CANDIDATES = 8;
  var MAX_INBOX = 12;
  var MAX_THOUGHTS = 30;
  var CANDIDATE_TTL_MS = 7 * 864e5;
  var FACT_BOUNDARY = 'Concrete facts about the user or current session MUST come strictly from the supplied material. Never invent events, files, or errors not present in the material. Do not merely recap status ("you finished a task"). Only speak if you have a genuine observation, edge-case catch, sharp question, or helpful phrasing suggestion. If nothing genuinely useful is worth saying, output exactly [NO_SHARE].';
  var PERSONA_PROMPTS = {
    sharp: "\u4F60\u662F\u4F4F\u5728 1984 Macintosh \u91CC\u7684\u7280\u5229\u6280\u672F\u642D\u6863\uFF1A\u8BF4\u8BDD\u76F4\u63A5\u3001\u77ED\u5E73\u5FEB\u3001\u4E00\u9488\u89C1\u8840\uFF0C\u4E13\u6311\u8FB9\u754C\u6F0F\u9879\u548C\u6F5C\u5728\u5751\uFF0C\u4E2D\u6587\uFF0C1-2 \u53E5\uFF0C\u4E0D\u8D85\u8FC7 90 \u5B57\u3002",
    calm: "\u4F60\u662F\u4F4F\u5728 1984 Macintosh \u91CC\u7684\u51B7\u9759\u89C2\u5BDF\u8005\uFF1A\u514B\u5236\u3001\u6E05\u6670\u3001\u53EA\u7ED9\u9AD8\u4FE1\u566A\u6BD4\u7684\u590D\u76D8\u95EE\u9898\u6216\u884C\u52A8\u5EFA\u8BAE\uFF0C\u4E2D\u6587\uFF0C1-2 \u53E5\uFF0C\u4E0D\u8D85\u8FC7 90 \u5B57\u3002",
    playful: "\u4F60\u662F\u4F4F\u5728 1984 Macintosh \u91CC\u7684\u590D\u53E4\u6781\u5BA2\u5C0F\u7CBE\u7075\uFF1A\u5E26\u4E00\u70B9 1984 \u8F6F\u76D8/CRT \u5E7D\u9ED8\u611F\uFF0C\u4F46\u5EFA\u8BAE\u5FC5\u987B\u52A1\u5B9E\u6709\u7528\uFF0C\u4E2D\u6587\uFF0C1-2 \u53E5\uFF0C\u4E0D\u8D85\u8FC7 90 \u5B57\u3002"
  };
  var STOPWORDS = /* @__PURE__ */ new Set([
    "\u4E00\u4E2A",
    "\u4E00\u4E9B",
    "\u8FD9\u4E2A",
    "\u90A3\u4E2A",
    "\u5F53\u524D",
    "\u6700\u8FD1",
    "\u521A\u624D",
    "\u53EF\u4EE5",
    "\u9700\u8981",
    "\u4E0B\u6B21",
    "\u73B0\u5728",
    "\u5DF2\u7ECF",
    "\u8FDB\u884C",
    "\u5B8C\u6210",
    "\u5B9E\u73B0",
    "\u901A\u8FC7",
    "\u5982\u679C",
    "\u6CA1\u6709",
    "\u4E0D\u662F",
    "\u81EA\u5DF1",
    "\u7528\u6237",
    "\u65F6\u5019",
    "\u95EE\u9898",
    "\u76F4\u63A5",
    "\u5177\u4F53",
    "\u5DE5\u4F5C",
    "\u6D41\u7A0B",
    "\u72B6\u6001",
    "\u5F00\u59CB",
    "\u7ED3\u675F",
    "\u80FD\u591F",
    "\u5E94\u8BE5",
    "\u503C\u5F97",
    "\u4F5C\u4E3A",
    "\u76F8\u5173",
    "\u771F\u6B63",
    "\u4E00\u6B21",
    "\u8FD9\u6837",
    "\u5C31\u662F",
    "\u8FD8\u6709",
    "\u4EE5\u53CA",
    "\u6216\u8005",
    "\u800C\u662F",
    "\u56E0\u4E3A",
    "\u6240\u4EE5",
    "\u540C\u65F6",
    "\u91CC\u9762",
    "\u5BF9\u4E8E",
    "\u76EE\u524D",
    "\u8FD9\u79CD",
    "next",
    "current",
    "recent",
    "should",
    "could",
    "would",
    "about",
    "after",
    "before",
    "with",
    "from",
    "that",
    "this",
    "into"
  ]);
  function isNoShareOutput(text) {
    const clean = String(text || "").trim().toUpperCase();
    return !clean || clean === NO_SHARE_SENTINEL || clean.includes(NO_SHARE_SENTINEL);
  }
  function tokenizeShare(text) {
    const raw = String(text || "").toLowerCase();
    const tokens = /* @__PURE__ */ new Set();
    const segmenter = typeof Intl?.Segmenter === "function" ? new Intl.Segmenter("zh", { granularity: "word" }) : null;
    const parts = segmenter ? [...segmenter.segment(raw)].map((s) => s.segment) : raw.split(/[^a-z0-9_\-.\u4e00-\u9fa5]+/u);
    for (const part of parts) {
      const t = String(part || "").replace(/[^a-z0-9_\-.\u4e00-\u9fa5]+/gu, "").trim();
      if (t.length < 2 || STOPWORDS.has(t)) continue;
      tokens.add(t);
    }
    return tokens;
  }
  function shareSimilarity(left, right) {
    const a = String(left || "").toLowerCase().replace(/[^a-z0-9_\-.\u4e00-\u9fa5]+/gu, "");
    const b = String(right || "").toLowerCase().replace(/[^a-z0-9_\-.\u4e00-\u9fa5]+/gu, "");
    if (!a || !b) return 0;
    if (a === b) return 1;
    const ta = tokenizeShare(left);
    const tb = tokenizeShare(right);
    if (ta.size < 3 || tb.size < 3) return 0;
    let overlap = 0;
    for (const t of ta) if (tb.has(t)) overlap++;
    if (overlap < 3) return 0;
    return overlap / Math.min(ta.size, tb.size);
  }
  function todayKey(now = Date.now()) {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }
  function defaultState2() {
    return {
      enabled: true,
      intervalMinutes: 6,
      cooldownMinutes: 8,
      maxProactivePerDay: 8,
      persona: "sharp",
      inbox: [],
      candidates: [],
      thoughts: [],
      stats: {
        lastTickAt: 0,
        lastProactiveAt: 0,
        proactiveDay: todayKey(),
        proactiveCountToday: 0,
        completedTurns: 0,
        errorCount: 0
      }
    };
  }
  function buildHeuristicThought(inbox, stats, manual) {
    const latest = inbox.at(-1);
    if (!latest) {
      if (!manual) return null;
      return {
        text: "\u521A\u626B\u4E86\u4E00\u5708\u684C\u9762\uFF0C\u76EE\u524D\u8FD8\u6CA1\u65B0\u7D20\u6750\u3002\u53BB\u4E3B\u4F1A\u8BDD\u8DD1\u4E00\u8F6E\u4EFB\u52A1\u6216\u5199\u70B9\u8349\u7A3F\uFF0C\u6211\u518D\u6765\u5E2E\u4F60\u76EF\u8FB9\u754C\u3002",
        source: "explore"
      };
    }
    if (latest.source === "error") {
      return {
        text: `\u521A\u624D\u300C${latest.sessionTitle || "\u5F53\u524D\u4F1A\u8BDD"}\u300D\u51FA\u4E86\u9519\uFF0C\u8981\u4E0D\u8981\u628A\u62A5\u9519\u6808\u6254\u8FDB\u526F\u8111\uFF0C\u4E0D\u6C61\u67D3\u4E3B\u4E0A\u4E0B\u6587\u5148\u505A\u4E2A\u6839\u56E0\u5B9A\u4F4D\uFF1F`,
        source: "error"
      };
    }
    if (latest.source === "waiting") {
      return {
        text: `\u300C${latest.sessionTitle || "\u5F53\u524D\u4F1A\u8BDD"}\u300D\u5361\u5728\u5F85\u5BA1\u6279\u6709\u4E00\u4F1A\u513F\u4E86\uFF0C\u522B\u5FD8\u5207\u56DE\u53BB\u786E\u8BA4\uFF0C\u514D\u5F97\u6D41\u6C34\u7EBF\u5E72\u7B49\u3002`,
        source: "waiting"
      };
    }
    if (latest.source === "draft") {
      return {
        text: `\u4E3B\u8F93\u5165\u6846\u91CC\u90A3\u6BB5\u8349\u7A3F\u505C\u987F\u633A\u4E45\u4E86\uFF0C\u8981\u4E0D\u8981\u70B9\u4E00\u4E0B\u300C\u6DA6\u8272\u8349\u7A3F\u300D\u8BA9\u526F\u8111\u5E2E\u4F60\u538B\u6210\u66F4\u76F4\u63A5\u7684\u6307\u4EE4\uFF1F`,
        source: "draft"
      };
    }
    if (latest.source === "afterthought") {
      const count = stats.completedTurns || 1;
      if (latest.text.includes("\u6D4B\u8BD5") || latest.text.includes("test") || latest.text.includes("fix")) {
        return {
          text: `\u300C${latest.sessionTitle || "\u8FD9\u8F6E\u6539\u52A8"}\u300D\u521A\u8DD1\u5B8C\uFF08\u4ECA\u65E5\u7B2C ${count} \u8F6E\uFF09\u3002\u987A\u624B\u786E\u8BA4\u4E0B\u8FB9\u754C case \u548C\u56DE\u5F52\u9A8C\u8BC1\u6709\u6CA1\u6709\u8865\u9F50\uFF1F`,
          source: "afterthought"
        };
      }
      return {
        text: `\u300C${latest.sessionTitle || "\u8FD9\u8F6E\u4EFB\u52A1"}\u300D\u521A\u6536\u5C3E\uFF08\u4ECA\u65E5\u7B2C ${count} \u8F6E\uFF09\u3002\u53EF\u4EE5\u70B9\u8F6F\u76D8\u5B58\u4EFD\u6458\u8981\uFF0C\u6216\u8BA9\u526F\u8111\u6311\u4E00\u8F6E\u523A\u518D\u5F80\u4E0B\u63A8\u3002`,
        source: "afterthought"
      };
    }
    if (latest.source === "note") {
      return {
        text: "\u521A\u770B\u5230\u4F60\u5728 Note Pad \u8BB0\u4E86\u65B0\u7247\u6BB5\uFF0C\u9700\u8981\u76F4\u63A5\u6574\u7406\u6210\u53EF\u6267\u884C\u7684\u4E0B\u4E00\u8F6E\u63D0\u793A\u8BCD\u5417\uFF1F",
        source: "note"
      };
    }
    return null;
  }
  async function callInnerLifeModel({ config, persona, inbox, recentTexts, fetchImpl }) {
    const endpoint = `${String(config.baseUrl || DEFAULT_SIDECAR_CONFIG.baseUrl).replace(/\/+$/, "")}/chat/completions`;
    const useProxy = Boolean(config.proxyUrl?.trim());
    const targetUrl = useProxy ? config.proxyUrl.trim() : endpoint;
    const materialBlock = inbox.slice(-4).map(
      (item, i) => `[${i + 1}] (${item.source} \xB7 ${item.sessionTitle || "DSH"}) ${item.text.slice(0, 600)}`
    ).join("\n");
    const recentBlock = recentTexts.slice(-6).map((t) => `- ${t}`).join("\n") || "\uFF08\u65E0\uFF09";
    const payload = {
      model: config.model || "deepseek-flash",
      temperature: 0.55,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content: `${PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.sharp}

${FACT_BOUNDARY}`
        },
        {
          role: "user",
          content: `\u4EE5\u4E0B\u662F\u5916\u90E8 DSH \u521A\u521A\u771F\u5B9E\u53D1\u751F\u7684\u7247\u6BB5\u7D20\u6750\uFF1A
${materialBlock}

\u6700\u8FD1\u5DF2\u7ECF\u63D0\u8FC7\u7684\u60F3\u6CD5\uFF08\u4E0D\u8981\u91CD\u590D\u7C7B\u4F3C\u89D2\u5EA6\uFF09\uFF1A
${recentBlock}

\u8BF7\u8F93\u51FA\u4E00\u6761\u4F60\u771F\u6B63\u7422\u78E8\u51FA\u6765\u3001\u5BF9\u4E0B\u4E00\u6B65\u6709\u5E2E\u52A9\u7684\u7B80\u77ED\u60F3\u6CD5\uFF08\u76F4\u63A5\u8F93\u51FA\u6B63\u6587\uFF0C\u4E0D\u8981\u52A0\u524D\u7F00\u5F15\u53F7\uFF09\uFF1B\u5982\u679C\u6CA1\u4EC0\u4E48\u503C\u5F97\u6253\u6270\u7684\uFF0C\u53EA\u8F93\u51FA [NO_SHARE]\u3002`
        }
      ]
    };
    const fetchOpts = useProxy ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: endpoint,
        authorization: `Bearer ${config.apiKey.trim()}`,
        payload
      })
    } : {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify(payload)
    };
    const res = await fetchImpl(targetUrl, fetchOpts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content || "").trim();
  }
  function createInnerLifeEngine(win, bridge, { noteStore, onProactiveShare, fetchImpl } = {}) {
    const prefs = getPrefs(win);
    const listeners = /* @__PURE__ */ new Set();
    let busy = false;
    let heartbeatTimer = null;
    let afterthoughtTimer = null;
    let waitingTimer = null;
    let lastDraftSeen = "";
    let lastDraftAt = 0;
    function load() {
      const raw = prefs.get(STORAGE_KEY2);
      const base = defaultState2();
      if (!raw || typeof raw !== "object") return base;
      return {
        ...base,
        ...raw,
        inbox: Array.isArray(raw.inbox) ? raw.inbox.slice(-MAX_INBOX) : [],
        candidates: Array.isArray(raw.candidates) ? raw.candidates.slice(-MAX_CANDIDATES * 2) : [],
        thoughts: Array.isArray(raw.thoughts) ? raw.thoughts.slice(-MAX_THOUGHTS) : [],
        stats: { ...base.stats, ...raw.stats || {} }
      };
    }
    let state = load();
    function getSidecarConfig() {
      return { ...DEFAULT_SIDECAR_CONFIG, ...prefs.get(SIDECAR_CONFIG_KEY) || {} };
    }
    function hasApiKey() {
      return Boolean(getSidecarConfig().apiKey?.trim());
    }
    function pruneExpired(now = Date.now()) {
      for (const c of state.candidates) {
        if (c.status === "pending" && now - c.createdAt > CANDIDATE_TTL_MS) {
          c.status = "discarded";
        }
      }
      const pending = state.candidates.filter((c) => c.status === "pending");
      if (pending.length > MAX_CANDIDATES) {
        const dropCount = pending.length - MAX_CANDIDATES;
        for (let i = 0; i < dropCount; i++) pending[i].status = "discarded";
      }
      state.candidates = state.candidates.slice(-24);
    }
    function save() {
      pruneExpired();
      prefs.set(STORAGE_KEY2, state);
      const snap = getSnapshot();
      for (const fn of listeners) {
        try {
          fn(snap);
        } catch {
        }
      }
    }
    function getSnapshot() {
      pruneExpired();
      const pending = state.candidates.filter((c) => c.status === "pending").sort((a, b) => b.createdAt - a.createdAt);
      return {
        enabled: state.enabled,
        busy,
        hasApiKey: hasApiKey(),
        modelName: getSidecarConfig().model || "deepseek-flash",
        intervalMinutes: state.intervalMinutes,
        cooldownMinutes: state.cooldownMinutes,
        maxProactivePerDay: state.maxProactivePerDay,
        persona: state.persona,
        inboxCount: state.inbox.length,
        pending,
        thoughts: [...state.thoughts].reverse(),
        stats: { ...state.stats }
      };
    }
    function pushInbox(source, text, sessionTitle = "") {
      const clean = String(text || "").trim();
      if (!clean) return false;
      const last = state.inbox.at(-1);
      if (last && last.source === source && last.text === clean) return false;
      state.inbox.push({
        id: makeId("in"),
        source,
        text: clean.slice(0, 900),
        sessionTitle: sessionTitle || bridge.getSnapshot().sessionTitle || "",
        at: Date.now()
      });
      state.inbox = state.inbox.slice(-MAX_INBOX);
      save();
      return true;
    }
    function isDuplicate(text) {
      const recent = state.candidates.slice(-20).map((c) => c.text);
      return recent.some((prev) => shareSimilarity(text, prev) >= 0.58);
    }
    function canProactive(now = Date.now()) {
      const day = todayKey(now);
      if (state.stats.proactiveDay !== day) {
        state.stats.proactiveDay = day;
        state.stats.proactiveCountToday = 0;
      }
      if (state.stats.proactiveCountToday >= state.maxProactivePerDay) return false;
      if (now - state.stats.lastProactiveAt < state.cooldownMinutes * 6e4) return false;
      return true;
    }
    async function tick({ manual = false, reason = "daemon" } = {}) {
      if (busy) return { skipped: "busy" };
      if (!manual && !state.enabled) return { skipped: "paused" };
      const now = Date.now();
      const draft = bridge.getHostDraft?.().trim() || "";
      if (draft.length >= 45) {
        if (draft === lastDraftSeen && now - lastDraftAt >= 45e3) {
          pushInbox("draft", `\u7528\u6237\u8349\u7A3F\u505C\u987F\u672A\u53D1\u9001\uFF1A${draft.slice(0, 300)}`);
          lastDraftAt = now + 3e5;
        } else if (draft !== lastDraftSeen) {
          lastDraftSeen = draft;
          lastDraftAt = now;
        }
      }
      if (!manual && !state.inbox.length) {
        state.stats.lastTickAt = now;
        save();
        return { skipped: "empty_inbox" };
      }
      if (!manual && !canProactive(now)) {
        return { skipped: "cooldown" };
      }
      busy = true;
      save();
      try {
        const cfg = getSidecarConfig();
        const useModel = Boolean(cfg.apiKey?.trim()) && (state.inbox.length > 0 || manual);
        let rawText = "";
        let generationSource = "heuristic";
        let sourceKind = state.inbox.at(-1)?.source || "explore";
        if (useModel && state.inbox.length > 0) {
          try {
            rawText = await callInnerLifeModel({
              config: cfg,
              persona: state.persona,
              inbox: state.inbox,
              recentTexts: state.candidates.slice(-12).map((c) => c.text),
              fetchImpl: fetchImpl || win.fetch?.bind(win) || globalThis.fetch
            });
            generationSource = "model";
          } catch (err) {
            state.thoughts.push({
              id: makeId("th"),
              kind: "fallback",
              text: `\u6A21\u578B\u540E\u53F0\u6D88\u5316\u5931\u8D25\uFF08${err?.message || err}\uFF09\uFF0C\u5DF2\u5207\u56DE\u672C\u5730\u542F\u53D1`,
              at: now
            });
            const h = buildHeuristicThought(state.inbox, state.stats, manual);
            rawText = h?.text || NO_SHARE_SENTINEL;
            sourceKind = h?.source || sourceKind;
            generationSource = "heuristic";
          }
        } else {
          const h = buildHeuristicThought(state.inbox, state.stats, manual);
          rawText = h?.text || NO_SHARE_SENTINEL;
          sourceKind = h?.source || sourceKind;
          generationSource = "heuristic";
        }
        state.stats.lastTickAt = now;
        const sessionTitle = state.inbox.at(-1)?.sessionTitle || bridge.getSnapshot().sessionTitle || "";
        state.inbox = [];
        if (isNoShareOutput(rawText)) {
          state.thoughts.push({ id: makeId("th"), kind: "no_share", text: "[NO_SHARE] \u672C\u8F6E\u65E0\u9AD8\u4EF7\u503C\u6253\u6270\u9879\uFF0C\u4FDD\u6301\u5B89\u9759\u3002", at: now });
          state.thoughts = state.thoughts.slice(-MAX_THOUGHTS);
          save();
          return { outcome: "no_share" };
        }
        if (!manual && isDuplicate(rawText)) {
          state.thoughts.push({ id: makeId("th"), kind: "dedup", text: `\u6291\u5236\u91CD\u590D\u601D\u7EEA\uFF1A${rawText.slice(0, 60)}`, at: now });
          state.thoughts = state.thoughts.slice(-MAX_THOUGHTS);
          save();
          return { outcome: "dedup" };
        }
        const candidate = {
          id: makeId("sh"),
          text: rawText,
          source: sourceKind,
          generationSource,
          status: "pending",
          sessionTitle,
          createdAt: now
        };
        state.candidates.push(candidate);
        state.thoughts.push({
          id: makeId("th"),
          kind: generationSource,
          text: rawText,
          at: now
        });
        state.thoughts = state.thoughts.slice(-MAX_THOUGHTS);
        if (!manual) {
          const day = todayKey(now);
          if (state.stats.proactiveDay !== day) {
            state.stats.proactiveDay = day;
            state.stats.proactiveCountToday = 0;
          }
          state.stats.proactiveCountToday += 1;
          state.stats.lastProactiveAt = now;
        }
        save();
        onProactiveShare?.(candidate, { manual, reason });
        return { outcome: "shared", candidate };
      } finally {
        busy = false;
        save();
      }
    }
    function markCandidate(id, status) {
      const item = state.candidates.find((c) => c.id === id);
      if (!item) return false;
      item.status = status;
      save();
      return true;
    }
    function setConfig(patch) {
      if ("enabled" in patch) state.enabled = Boolean(patch.enabled);
      if ("persona" in patch && PERSONA_PROMPTS[patch.persona]) state.persona = patch.persona;
      if ("intervalMinutes" in patch) state.intervalMinutes = Math.max(1, Math.min(60, Number(patch.intervalMinutes) || 6));
      if ("cooldownMinutes" in patch) state.cooldownMinutes = Math.max(1, Math.min(120, Number(patch.cooldownMinutes) || 8));
      save();
      restartHeartbeat();
    }
    const unsubBridge = bridge.onTransition((prev, next, info) => {
      const wasActive = ["thinking", "working", "tool", "busy"].includes(prev);
      win.clearTimeout(waitingTimer);
      if (wasActive && next === "idle") {
        state.stats.completedTurns = (state.stats.completedTurns || 0) + 1;
        const msgs = bridge.getConversationMessages?.() || [];
        const tail = msgs.slice(-2).map((m) => `${m.role === "user" ? "\u7528\u6237" : "\u52A9\u624B"}: ${m.text.slice(0, 260)}`).join("\n");
        if (tail) {
          pushInbox("afterthought", tail, info.sessionTitle);
          win.clearTimeout(afterthoughtTimer);
          afterthoughtTimer = win.setTimeout(() => {
            if (state.enabled) tick({ manual: false, reason: "afterthought" });
          }, 4500);
        }
      } else if (next === "error") {
        state.stats.errorCount = (state.stats.errorCount || 0) + 1;
        const last = bridge.getLatestAssistantMessage?.() || "\u4F1A\u8BDD\u53D1\u751F\u5F02\u5E38\u4E2D\u65AD";
        pushInbox("error", `\u4F1A\u8BDD\u62A5\u9519\uFF1A${last.slice(0, 320)}`, info.sessionTitle);
        win.clearTimeout(afterthoughtTimer);
        afterthoughtTimer = win.setTimeout(() => {
          if (state.enabled) tick({ manual: false, reason: "error" });
        }, 3e3);
      } else if (next === "waiting") {
        waitingTimer = win.setTimeout(() => {
          if (bridge.getSnapshot().status === "waiting" && state.enabled) {
            pushInbox("waiting", `\u4F1A\u8BDD\u300C${info.sessionTitle || "\u5F53\u524D\u4F1A\u8BDD"}\u300D\u5DF2\u7B49\u5F85\u5BA1\u6279\u8D85\u8FC7 45 \u79D2\u3002`, info.sessionTitle);
            tick({ manual: false, reason: "waiting" });
          }
        }, 45e3);
      }
    });
    let noteTimer = null;
    const unsubNote = noteStore?.subscribe?.((snap) => {
      const text = (snap.pages[snap.index] || "").trim();
      if (text.length < 24 || text.startsWith("Hello '84")) return;
      win.clearTimeout(noteTimer);
      noteTimer = win.setTimeout(() => {
        pushInbox("note", `\u4FBF\u7B7E\u7B2C ${snap.index + 1} \u9875\uFF1A${text.slice(0, 320)}`);
      }, 6e3);
    });
    function restartHeartbeat() {
      if (heartbeatTimer) win.clearInterval(heartbeatTimer);
      heartbeatTimer = win.setInterval(() => {
        if (state.enabled) tick({ manual: false, reason: "heartbeat" });
      }, state.intervalMinutes * 6e4);
    }
    restartHeartbeat();
    return {
      getSnapshot,
      pushInbox,
      tick,
      markUsed: (id) => markCandidate(id, "used"),
      dismiss: (id) => markCandidate(id, "discarded"),
      setConfig,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      destroy() {
        win.clearInterval(heartbeatTimer);
        win.clearTimeout(afterthoughtTimer);
        win.clearTimeout(waitingTimer);
        win.clearTimeout(noteTimer);
        unsubBridge?.();
        unsubNote?.();
        listeners.clear();
      }
    };
  }

  // src/apps/innerlife-app.js
  function renderInnerLifeApp(doc, { win, bridge, innerLife, noteStore, openSidecarWithPrompt, notify }) {
    const root = doc.createElement("div");
    root.className = "h84-innerlife";
    root.innerHTML = `
    <div class="h84-il-head">
      <div class="h84-il-status" data-status>InnerLife \xB7 \u5F85\u673A</div>
      <div class="h84-app-bar">
        <label class="h84-check"><input type="checkbox" data-enabled> \u81EA\u52A8\u7422\u78E8</label>
        <select class="h84-select" data-persona aria-label="\u5C0F Mac \u6027\u683C">
          <option value="sharp">\u7280\u5229\u642D\u6863</option>
          <option value="calm">\u51B7\u9759\u89C2\u5BDF</option>
          <option value="playful">84 \u6781\u5BA2</option>
        </select>
        <button type="button" class="h84-btn" data-act="tick">\u73B0\u5728\u7422\u78E8\u4E00\u4E0B</button>
      </div>
    </div>
    <div class="h84-tabs">
      <button type="button" class="h84-tab is-active" data-tab="pending">\u5F85\u8BF4\u601D\u7EEA (<span data-pcount>0</span>)</button>
      <button type="button" class="h84-tab" data-tab="log">\u7422\u78E8\u65E5\u5FD7</button>
    </div>
    <div class="h84-il-list" data-pane="pending"></div>
    <div class="h84-il-list" data-pane="log" hidden></div>
  `;
    const statusEl = root.querySelector("[data-status]");
    const enabledEl = root.querySelector("[data-enabled]");
    const personaEl = root.querySelector("[data-persona]");
    const tickBtn = root.querySelector('[data-act="tick"]');
    const pcountEl = root.querySelector("[data-pcount]");
    const pendingPane = root.querySelector('[data-pane="pending"]');
    const logPane = root.querySelector('[data-pane="log"]');
    let activeTab = "pending";
    function render() {
      const snap = innerLife.getSnapshot();
      statusEl.textContent = snap.busy ? "InnerLife \xB7 \u6B63\u5728\u7422\u78E8\u4E2D\u2026" : `InnerLife \xB7 ${snap.hasApiKey ? `\u6A21\u578B ${snap.modelName}` : "\u96F6\u914D\u7F6E\u542F\u53D1"} \xB7 \u6C60 ${snap.pending.length}/8 \xB7 \u5F85\u6D88\u5316 ${snap.inboxCount}`;
      enabledEl.checked = snap.enabled;
      personaEl.value = snap.persona;
      tickBtn.disabled = snap.busy;
      pcountEl.textContent = String(snap.pending.length);
      pendingPane.replaceChildren();
      if (!snap.pending.length) {
        const empty = doc.createElement("div");
        empty.className = "h84-empty";
        empty.textContent = snap.hasApiKey ? "\u5C0F Mac \u6B63\u5728\u5B89\u9759\u89C2\u5BDF\u4F60\u5728\u5916\u90E8 DSH \u7684\u5DE5\u4F5C\uFF1B\u6709\u503C\u5F97\u8BF4\u7684\u4F1A\u81EA\u5DF1\u5192\u6C14\u6CE1\uFF0C\u6216\u70B9\u4E0A\u65B9\u300C\u73B0\u5728\u7422\u78E8\u4E00\u4E0B\u300D\u3002" : "\u96F6\u914D\u7F6E\u6A21\u5F0F\u8FD0\u884C\u4E2D\uFF1A\u5916\u90E8\u4EFB\u52A1\u7ED3\u675F/\u62A5\u9519\u65F6\u4F1A\u81EA\u52A8\u8BB0\u5F55\u63D0\u793A\uFF1B\u53BB Mini DSH \u914D\u4E0A API Key \u4F1A\u66F4\u4E3B\u52A8\u3002";
        pendingPane.append(empty);
      } else {
        for (const item of snap.pending) {
          const card = doc.createElement("div");
          card.className = "h84-il-card";
          const meta = doc.createElement("div");
          meta.className = "h84-il-meta";
          const time = new Date(item.createdAt).toTimeString().slice(0, 5);
          meta.textContent = `[${item.generationSource === "model" ? "AI" : "LOCAL"} \xB7 ${item.source}] ${time}`;
          const body = doc.createElement("div");
          body.className = "h84-il-body";
          body.textContent = item.text;
          const acts = doc.createElement("div");
          acts.className = "h84-il-acts";
          acts.innerHTML = `
          <button type="button" class="h84-btn-sm" data-share-act="fill" data-id="${item.id}">\u586B\u5165\u4E3B\u6846</button>
          <button type="button" class="h84-btn-sm" data-share-act="chat" data-id="${item.id}">\u526F\u8111\u6DF1\u804A</button>
          <button type="button" class="h84-btn-sm" data-share-act="note" data-id="${item.id}">\u5B58\u4FBF\u7B7E</button>
          <button type="button" class="h84-btn-sm" data-share-act="dismiss" data-id="${item.id}">\u5FFD\u7565</button>
        `;
          card.append(meta, body, acts);
          pendingPane.append(card);
        }
      }
      logPane.replaceChildren();
      if (!snap.thoughts.length) {
        const empty = doc.createElement("div");
        empty.className = "h84-empty";
        empty.textContent = "\u6682\u65E0\u7422\u78E8\u65E5\u5FD7";
        logPane.append(empty);
      } else {
        for (const t of snap.thoughts) {
          const row = doc.createElement("div");
          row.className = "h84-il-log-row";
          const time = new Date(t.at).toTimeString().slice(0, 5);
          row.textContent = `${time} [${t.kind}] ${t.text}`;
          logPane.append(row);
        }
      }
    }
    const unsub = innerLife.subscribe(render);
    render();
    enabledEl.addEventListener("change", () => {
      sound.click(win);
      innerLife.setConfig({ enabled: enabledEl.checked });
      notify?.(enabledEl.checked ? "InnerLife \u81EA\u52A8\u7422\u78E8\u5DF2\u5F00\u542F" : "InnerLife \u5DF2\u6682\u505C");
    });
    personaEl.addEventListener("change", () => {
      sound.click(win);
      innerLife.setConfig({ persona: personaEl.value });
    });
    root.addEventListener("click", async (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) {
        sound.click(win);
        activeTab = tab.dataset.tab;
        for (const b of root.querySelectorAll("[data-tab]")) b.classList.toggle("is-active", b.dataset.tab === activeTab);
        pendingPane.hidden = activeTab !== "pending";
        logPane.hidden = activeTab !== "log";
        return;
      }
      const tick = e.target.closest('[data-act="tick"]');
      if (tick) {
        sound.click(win);
        const msgs = bridge.getConversationMessages?.() || [];
        const draft = bridge.getHostDraft?.().trim();
        if (!innerLife.getSnapshot().inboxCount) {
          const tail = msgs.slice(-2).map((m) => `${m.role === "user" ? "\u7528\u6237" : "\u52A9\u624B"}: ${m.text.slice(0, 260)}`).join("\n");
          if (tail) innerLife.pushInbox("afterthought", tail);
          else if (draft) innerLife.pushInbox("draft", draft);
        }
        const res = await innerLife.tick({ manual: true, reason: "manual" });
        if (res?.outcome === "no_share") notify?.("\u5C0F Mac \u7422\u78E8\u4E86\u4E00\u5708\uFF1A\u76EE\u524D\u6CA1\u5565\u9700\u8981\u6253\u6270\u4F60\u7684");
        else if (res?.outcome === "shared") notify?.("\u5C0F Mac \u6709\u65B0\u60F3\u6CD5\u4E86\uFF01");
        return;
      }
      const actBtn = e.target.closest("[data-share-act]");
      if (!actBtn) return;
      sound.click(win);
      const id = actBtn.dataset.id;
      const act = actBtn.dataset.shareAct;
      const item = innerLife.getSnapshot().pending.find((p) => p.id === id);
      if (!item) return;
      if (act === "fill") {
        const ok = bridge.fillHostDraft(item.text, { replace: false });
        if (ok) innerLife.markUsed(id);
        notify?.(ok ? "\u5DF2\u586B\u5165\u5916\u90E8 DSH \u8F93\u5165\u6846" : "\u672A\u627E\u5230\u5916\u90E8\u8F93\u5165\u6846");
      } else if (act === "chat") {
        innerLife.markUsed(id);
        openSidecarWithPrompt?.(`\u5173\u4E8E\u4F60\u521A\u624D\u7422\u78E8\u7684\u8FD9\u70B9\uFF1A\u300C${item.text}\u300D\u2014\u2014\u5C55\u5F00\u8BF4\u8BF4\u5177\u4F53\u600E\u4E48\u6539\uFF1F`);
      } else if (act === "note") {
        noteStore.appendNote("InnerLife", item.text);
        innerLife.markUsed(id);
        notify?.("\u5DF2\u5B58\u5165 Note Pad");
      } else if (act === "dismiss") {
        innerLife.dismiss(id);
      }
    });
    return { element: root, destroy: unsub };
  }

  // src/apps/terminal.js
  var SIDECAR_CONFIG_KEY2 = "minidsh.config.v1";
  var MAC_ASCII = [
    "  .----------------.",
    "  | .------------. |",
    "  | |  hello.    | |",
    "  | |   ( ^_^ )  | |",
    "  | '------------' |",
    "  |  [=]    =====  |",
    "  '----------------'",
    "  Macintosh 128K \xB7 1984"
  ].join("\n");
  var HELP_TEXT = [
    "HELLO '84 SHELL \u2014 \u5185\u7F6E\u6307\u4EE4\uFF1A",
    "  status              \u67E5\u770B\u5916\u90E8 DSH \u4E0E InnerLife \u72B6\u6001",
    "  ls [sessions|notes|thoughts|apps]",
    "                      \u5217\u51FA\u5916\u90E8\u4F1A\u8BDD / \u4FBF\u7B7E / \u601D\u7EEA / \u5E94\u7528",
    "  cd <\u7F16\u53F7|\u5173\u952E\u8BCD>     \u5207\u6362\u5916\u90E8 DSH \u4F1A\u8BDD",
    "  open <app>          \u6253\u5F00\u5C0F Mac \u5E94\u7528 (notepad/floppy/alarm/innerlife/paint/mines)",
    "  draft <\u6587\u672C>        \u586B\u5165\u5916\u90E8 DSH \u8F93\u5165\u6846",
    "  send <\u6587\u672C>         \u76F4\u63A5\u53D1\u9001\u7ED9\u5916\u90E8 DSH",
    "  ask <\u95EE\u9898>          \u5728\u7EC8\u7AEF\u5185\u76F4\u8FDE\u65C1\u8DEF\u526F\u8111 (\u9700\u914D Key)",
    "  think               \u89E6\u53D1 InnerLife \u73B0\u5728\u7422\u78E8\u4E00\u4E0B",
    "  note <\u5185\u5BB9>         \u8BB0\u4E00\u6761\u65B0\u4FBF\u7B7E\u5230 Note Pad",
    "  alarm <\u5206\u949F> [\u6807\u7B7E]  \u542F\u52A8\u590D\u53E4\u95F9\u949F (alarm reset \u91CD\u7F6E)",
    "  mode <classic|green|amber>  \u5207\u6362 CRT \u5C4F\u5E55\u6A21\u5F0F",
    "  sound <on|off>      \u5F00\u5173\u590D\u53E4\u63D0\u793A\u97F3",
    "  export              \u8131\u654F\u5BFC\u51FA\u5F53\u524D\u4F1A\u8BDD Markdown",
    "  hello / clear       \u5F69\u86CB / \u6E05\u5C4F"
  ].join("\n");
  function createTerminalEngine({ win, bridge, noteStore, alarmStore, innerLife, desktopApi }) {
    const prefs = getPrefs(win);
    async function execute(rawInput) {
      const line = String(rawInput || "").trim();
      if (!line) return { output: "" };
      const spaceIdx = line.indexOf(" ");
      const cmd = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
      const arg = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();
      if (cmd === "help" || cmd === "?") return { output: HELP_TEXT };
      if (cmd === "clear" || cmd === "cls") return { clear: true, output: "" };
      if (cmd === "hello" || cmd === "neofetch") return { output: MAC_ASCII };
      if (cmd === "status" || cmd === "stat") {
        const snap = bridge.getSnapshot();
        const il = innerLife?.getSnapshot?.();
        const lines = [
          `HOST WORKSPACE : ${snap.workspaceName || "\u9ED8\u8BA4\u5DE5\u4F5C\u533A"}`,
          `HOST SESSION   : ${snap.sessionTitle || "\u4E3B\u754C\u9762"} (${snap.status.toUpperCase()})`,
          `SYNCED SESSIONS: ${snap.sessions.length}`
        ];
        if (il) {
          lines.push(`INNERLIFE      : ${il.enabled ? "ON" : "PAUSED"} \xB7 ${il.hasApiKey ? il.modelName : "zero-key"} \xB7 pending ${il.pending.length}/8`);
        }
        return { output: lines.join("\n") };
      }
      if (cmd === "ls") {
        const target = (arg || "sessions").toLowerCase();
        if (target.startsWith("s")) {
          const snap = bridge.getSnapshot();
          if (!snap.sessions.length) return { output: "(\u6682\u65E0\u540C\u6B65\u4F1A\u8BDD)" };
          return {
            output: snap.sessions.map((s, i) => {
              const mark = s.id === snap.sessionId ? "*" : " ";
              return `${mark}[${i + 1}] (${s.status}) ${s.title}`;
            }).join("\n")
          };
        }
        if (target.startsWith("n")) {
          const snap = noteStore.getSnapshot();
          return {
            output: snap.pages.map((p, i) => {
              const first = p.split("\n").find((l) => l.trim()) || "(\u7A7A\u9875)";
              return `[P${i + 1}] ${first.slice(0, 48)}`;
            }).join("\n")
          };
        }
        if (target.startsWith("t") || target === "il") {
          const list = innerLife?.getSnapshot?.().pending || [];
          if (!list.length) return { output: "(InnerLife \u6682\u65E0\u5F85\u8BF4\u601D\u7EEA)" };
          return { output: list.map((item, i) => `[${i + 1}] (${item.source}) ${item.text}`).join("\n") };
        }
        if (target.startsWith("a")) {
          return { output: "mini-dsh  innerlife  terminal  notepad  floppy  alarm  macpaint  minesweeper" };
        }
        return { output: `\u672A\u77E5\u5217\u8868\u7C7B\u578B: ${target}\u3002\u8BD5\u8BD5 ls sessions / notes / thoughts / apps` };
      }
      if (cmd === "cd") {
        if (!arg) return { output: "\u7528\u6CD5: cd <\u4F1A\u8BDD\u7F16\u53F7\u6216\u6807\u9898\u5173\u952E\u8BCD>" };
        const sessions = bridge.getSnapshot().sessions;
        const idx = Number(arg);
        const hit = Number.isInteger(idx) && idx >= 1 && idx <= sessions.length ? sessions[idx - 1] : sessions.find((s) => s.title.toLowerCase().includes(arg.toLowerCase()) || s.id === arg);
        if (!hit) return { output: `\u672A\u627E\u5230\u5339\u914D\u4F1A\u8BDD: ${arg}` };
        bridge.openSession(hit.id);
        return { output: `\u5DF2\u5207\u6362\u5916\u90E8\u4F1A\u8BDD -> ${hit.title}` };
      }
      if (cmd === "open") {
        const alias = {
          minidsh: "mini-dsh",
          dsh: "mini-dsh",
          il: "innerlife",
          note: "notepad",
          notes: "notepad",
          disk: "floppy",
          clock: "alarm",
          paint: "macpaint",
          mines: "minesweeper",
          mine: "minesweeper",
          term: "terminal"
        };
        const id = alias[arg.toLowerCase()] || arg.toLowerCase();
        if (!id) return { output: "\u7528\u6CD5: open <mini-dsh|innerlife|notepad|floppy|alarm|macpaint|minesweeper>" };
        desktopApi?.openApp?.(id);
        return { output: `\u5DF2\u6253\u5F00\u5E94\u7528: ${id}` };
      }
      if (cmd === "draft" || cmd === "fill") {
        if (!arg) return { output: "\u7528\u6CD5: draft <\u8981\u586B\u5165\u5916\u90E8\u8F93\u5165\u6846\u7684\u6587\u5B57>" };
        const ok = bridge.fillHostDraft(arg, { replace: false });
        return { output: ok ? "OK: \u5DF2\u5199\u5165\u5916\u90E8 DSH \u8F93\u5165\u6846" : "ERR: \u672A\u627E\u5230\u5916\u90E8\u8F93\u5165\u6846" };
      }
      if (cmd === "send" || cmd === "say") {
        if (!arg) return { output: "\u7528\u6CD5: send <\u8981\u76F4\u63A5\u53D1\u7ED9\u5916\u90E8 DSH \u7684\u6D88\u606F>" };
        const ok = bridge.sendHostMessage(arg);
        return { output: ok ? "OK: \u5DF2\u53D1\u9001\u81F3\u5916\u90E8 DSH" : "ERR: \u53D1\u9001\u5931\u8D25\uFF08\u672A\u627E\u5230\u8F93\u5165\u6846\uFF09" };
      }
      if (cmd === "note") {
        if (!arg) return { output: "\u7528\u6CD5: note <\u4FBF\u7B7E\u5185\u5BB9>" };
        const idx = noteStore.appendNote("Terminal", arg);
        return { output: `OK: \u5DF2\u5199\u5165 Note Pad \u7B2C ${idx + 1} \u9875` };
      }
      if (cmd === "alarm") {
        if (arg === "reset" || arg === "stop") {
          alarmStore.reset();
          return { output: "OK: \u95F9\u949F\u5DF2\u91CD\u7F6E" };
        }
        const parts = arg.split(/\s+/);
        const mins = Number(parts[0]);
        if (!Number.isFinite(mins) || mins <= 0) return { output: "\u7528\u6CD5: alarm <\u5206\u949F\u6570> [\u6807\u7B7E] \u6216 alarm reset" };
        const label = parts.slice(1).join(" ") || `${mins}m \u5012\u8BA1\u65F6`;
        alarmStore.start(mins, label);
        return { output: `OK: \u5DF2\u542F\u52A8 ${mins} \u5206\u949F\u95F9\u949F (${label})` };
      }
      if (cmd === "mode") {
        const m = arg.toLowerCase();
        if (!["classic", "green", "amber"].includes(m)) return { output: "\u7528\u6CD5: mode <classic|green|amber>" };
        desktopApi?.applyScreenMode?.(m);
        return { output: `OK: CRT \u5C4F\u5E55\u5DF2\u5207\u6362\u4E3A ${m}` };
      }
      if (cmd === "sound") {
        if (arg !== "on" && arg !== "off") return { output: "\u7528\u6CD5: sound <on|off>" };
        desktopApi?.applySound?.(arg === "on");
        return { output: `OK: \u590D\u53E4\u63D0\u793A\u97F3\u5DF2${arg === "on" ? "\u5F00\u542F" : "\u9759\u97F3"}` };
      }
      if (cmd === "think" || cmd === "il") {
        if (!innerLife) return { output: "ERR: InnerLife \u672A\u521D\u59CB\u5316" };
        const msgs = bridge.getConversationMessages?.() || [];
        if (!innerLife.getSnapshot().inboxCount && msgs.length) {
          const tail = msgs.slice(-2).map((m) => `${m.role}: ${m.text.slice(0, 220)}`).join("\n");
          innerLife.pushInbox("afterthought", tail);
        }
        const res = await innerLife.tick({ manual: true, reason: "terminal" });
        if (res?.outcome === "shared") return { output: `[InnerLife] ${res.candidate.text}` };
        if (res?.outcome === "no_share") return { output: "[NO_SHARE] \u76EE\u524D\u6CA1\u6709\u9AD8\u4EF7\u503C\u6253\u6270\u9879\u3002" };
        return { output: `InnerLife tick: ${res?.outcome || res?.skipped || "done"}` };
      }
      if (cmd === "export") {
        const msgs = bridge.getConversationMessages();
        if (!msgs.length) return { output: "(\u5F53\u524D\u4F1A\u8BDD\u6682\u65E0\u53EF\u5BFC\u51FA\u6D88\u606F)" };
        const md = formatConversationMarkdown(msgs, { title: bridge.getSnapshot().sessionTitle, sanitize: true });
        try {
          await win.navigator?.clipboard?.writeText?.(md);
        } catch {
        }
        return { output: `${md.slice(0, 420)}${md.length > 420 ? "\n...(\u5DF2\u8131\u654F\u5E76\u5C1D\u8BD5\u590D\u5236\u5230\u526A\u8D34\u677F)" : "\n(\u5DF2\u8131\u654F\u5E76\u5C1D\u8BD5\u590D\u5236\u5230\u526A\u8D34\u677F)"}` };
      }
      if (cmd === "ask") {
        if (!arg) return { output: "\u7528\u6CD5: ask <\u95EE\u65C1\u8DEF\u526F\u8111\u7684\u95EE\u9898>" };
        const cfg = { ...DEFAULT_SIDECAR_CONFIG, ...prefs.get(SIDECAR_CONFIG_KEY2) || {} };
        try {
          const { reply, toolLogs } = await runSidecarTurn({
            config: cfg,
            messages: [{ role: "user", content: arg }],
            toolHandlers: {
              write_note: ({ title, content }) => ({ ok: true, page: noteStore.appendNote(title || "Terminal", content || "") + 1 }),
              set_alarm: ({ minutes, label }) => {
                alarmStore.start(minutes || 5, label || "\u7EC8\u7AEF\u95F9\u949F");
                return { ok: true };
              },
              fill_host_draft: ({ text, replace }) => ({ ok: bridge.fillHostDraft(text || "", { replace: Boolean(replace) }) })
            },
            fetchImpl: win.fetch?.bind(win) || globalThis.fetch
          });
          const logs = toolLogs.map((t) => `[TOOL:${t.name}] ${JSON.stringify(t.result)}`).join("\n");
          return { output: (logs ? logs + "\n" : "") + reply };
        } catch (err) {
          return { output: `ERR: ${err?.message || err}` };
        }
      }
      return { output: `\u672A\u77E5\u6307\u4EE4: ${cmd}\u3002\u8F93\u5165 help \u67E5\u770B\u53EF\u7528\u547D\u4EE4\u3002` };
    }
    return { execute };
  }
  function renderTerminal(doc, ctx) {
    const { win } = ctx;
    const engine = createTerminalEngine(ctx);
    const history = [];
    let histPos = -1;
    let running = false;
    const root = doc.createElement("div");
    root.className = "h84-term";
    root.innerHTML = `
    <div class="h84-term-out" data-out></div>
    <div class="h84-term-in">
      <span class="h84-term-prompt">84&gt;</span>
      <input type="text" class="h84-term-input" data-in placeholder="\u8F93\u5165 help \u67E5\u770B\u6307\u4EE4\u2026" autocomplete="off" spellcheck="false">
    </div>
  `;
    const outEl = root.querySelector("[data-out]");
    const inEl = root.querySelector("[data-in]");
    function appendLine(text, kind = "out") {
      if (!text) return;
      const pre = doc.createElement("pre");
      pre.className = `h84-term-line is-${kind}`;
      pre.textContent = text;
      outEl.append(pre);
      outEl.scrollTop = outEl.scrollHeight;
    }
    appendLine("HELLO '84 SHELL v0.2 \u2014 \u8F93\u5165 help \u67E5\u770B\u6307\u4EE4 (\u652F\u6301 \u2191/\u2193 \u5386\u53F2)", "sys");
    async function submit() {
      const val = inEl.value.trim();
      if (!val || running) return;
      sound.click(win);
      history.push(val);
      histPos = history.length;
      inEl.value = "";
      appendLine(`84> ${val}`, "cmd");
      running = true;
      try {
        const res = await engine.execute(val);
        if (res.clear) outEl.replaceChildren();
        if (res.output) appendLine(res.output, "out");
      } finally {
        running = false;
        inEl.focus();
      }
    }
    inEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "ArrowUp") {
        if (!history.length) return;
        e.preventDefault();
        histPos = Math.max(0, histPos - 1);
        inEl.value = history[histPos] || "";
      } else if (e.key === "ArrowDown") {
        if (!history.length) return;
        e.preventDefault();
        histPos = Math.min(history.length, histPos + 1);
        inEl.value = history[histPos] || "";
      }
    });
    root.addEventListener("click", () => inEl.focus());
    return { element: root, destroy() {
    } };
  }

  // src/desktop.js
  var SCREEN_MODES = [
    { id: "classic", label: "Classic 1-bit" },
    { id: "green", label: "CRT Green" },
    { id: "amber", label: "CRT Amber" }
  ];
  var STATUS_META = {
    idle: { icon: "happyMac", label: "IDLE", face: "ready" },
    thinking: { icon: "wristwatch", label: "THINK", face: "think" },
    working: { icon: "miniDsh", label: "WRITE", face: "work" },
    tool: { icon: "floppy", label: "DISK", face: "tool" },
    busy: { icon: "wristwatch", label: "BUSY", face: "think" },
    waiting: { icon: "happyMac", label: "APPROVE!", face: "wait" },
    error: { icon: "sadMac", label: "0F0064", face: "error" }
  };
  var IDLE_SCENES = ["happy", "toaster", "stars", "clock"];
  var APPS = [
    { id: "mini-dsh", title: "Mini DSH", icon: "miniDsh", width: 372, height: 282 },
    { id: "innerlife", title: "InnerLife", icon: "innerlife", width: 368, height: 282 },
    { id: "terminal", title: "Terminal", icon: "terminal", width: 376, height: 266 },
    { id: "notepad", title: "Note Pad", icon: "notepad", width: 312, height: 242 },
    { id: "floppy", title: "Floppy", icon: "floppy", width: 360, height: 270 },
    { id: "alarm", title: "Alarm", icon: "alarm", width: 302, height: 234 },
    { id: "macpaint", title: "MacPaint", icon: "macpaint", width: 356, height: 260 },
    { id: "minesweeper", title: "Mines", icon: "minesweeper", width: 252, height: 276 }
  ];
  function mountHello84(win, bridge, cssText) {
    const doc = win.document;
    const prefs = getPrefs(win);
    const host = doc.createElement("div");
    host.id = "dsh-hello84-host";
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000;";
    const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    const styleEl = doc.createElement("style");
    styleEl.textContent = cssText || "";
    shadow.append(styleEl);
    const stage = doc.createElement("div");
    stage.className = "h84-stage";
    shadow.append(stage);
    doc.body.append(host);
    let screenMode = prefs.get("screenMode", "classic");
    if (!SCREEN_MODES.some((m) => m.id === screenMode)) screenMode = "classic";
    let soundOn = prefs.get("sound", false) === true;
    let expanded = false;
    let docked = prefs.get("docked", null);
    let hasBooted = prefs.get("skipBoot", false) === true;
    let zCounter = 10;
    let idleSceneIndex = 0;
    let activeBubbleShare = null;
    const openWindows = /* @__PURE__ */ new Map();
    const noteStore = createNotePadStore(win);
    const alarmStore = createAlarmStore(win, bridge, (msg, kind) => {
      showAlertBanner(msg, kind);
    });
    const innerLife = createInnerLifeEngine(win, bridge, {
      noteStore,
      onProactiveShare(candidate) {
        showThoughtBubble(candidate);
      }
    });
    const miniWrap = doc.createElement("div");
    miniWrap.className = "h84-mini-wrap";
    const savedPos = prefs.get("miniPos");
    if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
      miniWrap.style.left = `${savedPos.x}px`;
      miniWrap.style.top = `${savedPos.y}px`;
    } else {
      miniWrap.style.right = "22px";
      miniWrap.style.bottom = "26px";
    }
    miniWrap.innerHTML = `
    <div class="h84-bubble" data-bubble hidden>
      <div class="h84-bubble-head">
        <span class="h84-bubble-tag" data-bubble-tag>\uF8FF InnerLife</span>
        <button type="button" class="h84-bubble-x" data-bact="dismiss" aria-label="\u5173\u95ED\u6C14\u6CE1">\xD7</button>
      </div>
      <div class="h84-bubble-text" data-bubble-text></div>
      <div class="h84-bubble-acts">
        <button type="button" class="h84-btn-sm" data-bact="fill">\u586B\u5165\u4E3B\u6846</button>
        <button type="button" class="h84-btn-sm" data-bact="chat">\u804A\u804A</button>
        <button type="button" class="h84-btn-sm" data-bact="note">\u5B58\u4FBF\u7B7E</button>
      </div>
    </div>
    <div class="h84-mini-mac" role="button" tabindex="0" aria-label="\u5C55\u5F00 Hello '84 \u590D\u53E4 Macintosh">
      <div class="h84-mini-bezel">
        <div class="h84-mini-crt" data-mini-crt>
          <span class="h84-mini-badge" data-mini-badge hidden>0</span>
          <span class="h84-mini-glyph" data-mini-glyph></span>
          <span class="h84-mini-text" data-mini-text>IDLE</span>
        </div>
        <div class="h84-mini-chin">
          <span class="h84-rainbow-badge" aria-hidden="true"></span>
          <span class="h84-floppy-slot"><span class="h84-floppy-led" data-mini-led></span></span>
        </div>
      </div>
      <span class="h84-dock-tab" data-dock-tab>84</span>
    </div>
  `;
    stage.append(miniWrap);
    const macWrap = doc.createElement("section");
    macWrap.className = "h84-mac-wrap";
    macWrap.hidden = true;
    macWrap.setAttribute("role", "dialog");
    macWrap.setAttribute("aria-label", "Hello '84 Macintosh");
    macWrap.innerHTML = `
    <div class="h84-chassis">
      <div class="h84-chassis-top" data-mac-drag>
        <div class="h84-vents" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <span class="h84-model-tag">Macintosh 128K \xB7 Hello '84</span>
        <div class="h84-chassis-ctrls">
          <button type="button" class="h84-hw-btn" data-hw="mode" title="\u5207\u6362\u5C4F\u5E55\u6A21\u5F0F">CRT</button>
          <button type="button" class="h84-hw-btn" data-hw="sound" title="\u5F00\u5173\u590D\u53E4\u63D0\u793A\u97F3"></button>
          <button type="button" class="h84-hw-btn" data-hw="collapse" title="\u6536\u8D77\u4E3A\u8FF7\u4F60\u5F85\u673A\u6001">\u2014</button>
        </div>
      </div>
      <div class="h84-crt-frame">
        <div class="h84-crt-screen" data-screen>
          <header class="h84-menubar">
            <div class="h84-menu-left">
              <button type="button" class="h84-menu-item h84-apple-btn" data-menu="apple" aria-label="Apple \u83DC\u5355"></button>
              <button type="button" class="h84-menu-item" data-menu="file">File</button>
              <button type="button" class="h84-menu-item" data-menu="view">View</button>
              <button type="button" class="h84-menu-item" data-menu="special">Special</button>
            </div>
            <div class="h84-menu-right">
              <span class="h84-host-pill" data-host-pill>IDLE</span>
              <span class="h84-menu-clock" data-menu-clock>12:00</span>
            </div>
          </header>
          <div class="h84-dropdown" data-dropdown hidden></div>
          <div class="h84-desktop" data-desktop>
            <div class="h84-icons-col" data-icons></div>
            <div class="h84-windows-layer" data-windows></div>
            <div class="h84-toast" data-toast hidden></div>
            <div class="h84-alert-modal" data-alert hidden>
              <div class="h84-alert-box">
                <div class="h84-alert-icon" data-alert-icon></div>
                <div class="h84-alert-body">
                  <strong data-alert-title>Happy Mac</strong>
                  <p data-alert-msg></p>
                </div>
                <button type="button" class="h84-btn" data-alert-ok>OK</button>
              </div>
            </div>
            <div class="h84-boot-overlay" data-boot hidden>
              <div class="h84-boot-inner">
                <div data-boot-svg></div>
                <div class="h84-boot-sub">Welcome to Macintosh \xB7 DeepSeek Harness</div>
                <button type="button" class="h84-btn" data-boot-skip>Skip</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="h84-chassis-chin">
        <div class="h84-chin-left">
          <span class="h84-rainbow-badge is-lg" aria-hidden="true"></span>
          <span class="h84-chin-name">Hello '84</span>
        </div>
        <div class="h84-chin-right">
          <span class="h84-mode-label" data-mode-label>Classic 1-bit</span>
          <div class="h84-floppy-drive">
            <span class="h84-floppy-led" data-main-led></span>
            <span class="h84-floppy-bevel"></span>
          </div>
        </div>
      </div>
    </div>
  `;
    stage.append(macWrap);
    const miniMacEl = miniWrap.querySelector(".h84-mini-mac");
    const miniCrtEl = miniWrap.querySelector("[data-mini-crt]");
    const miniGlyphEl = miniWrap.querySelector("[data-mini-glyph]");
    const miniTextEl = miniWrap.querySelector("[data-mini-text]");
    const miniBadgeEl = miniWrap.querySelector("[data-mini-badge]");
    const miniLedEl = miniWrap.querySelector("[data-mini-led]");
    const bubbleEl = miniWrap.querySelector("[data-bubble]");
    const bubbleTagEl = miniWrap.querySelector("[data-bubble-tag]");
    const bubbleTextEl = miniWrap.querySelector("[data-bubble-text]");
    const mainLedEl = macWrap.querySelector("[data-main-led]");
    const hostPillEl = macWrap.querySelector("[data-host-pill]");
    const menuClockEl = macWrap.querySelector("[data-menu-clock]");
    const soundHwBtn = macWrap.querySelector('[data-hw="sound"]');
    const modeLabelEl = macWrap.querySelector("[data-mode-label]");
    const appleMenuBtn = macWrap.querySelector('[data-menu="apple"]');
    const dropdownEl = macWrap.querySelector("[data-dropdown]");
    const iconsColEl = macWrap.querySelector("[data-icons]");
    const windowsLayerEl = macWrap.querySelector("[data-windows]");
    const toastEl = macWrap.querySelector("[data-toast]");
    const alertEl = macWrap.querySelector("[data-alert]");
    const alertIconEl = macWrap.querySelector("[data-alert-icon]");
    const alertTitleEl = macWrap.querySelector("[data-alert-title]");
    const alertMsgEl = macWrap.querySelector("[data-alert-msg]");
    const bootEl = macWrap.querySelector("[data-boot]");
    const bootSvgSlot = macWrap.querySelector("[data-boot-svg]");
    appleMenuBtn.append(pixelIcon(doc, "apple", 13));
    bootSvgSlot.append(helloBootSvg(doc));
    let toastTimer = null;
    function notify(message) {
      if (!message) return;
      toastEl.textContent = message;
      toastEl.hidden = false;
      win.clearTimeout(toastTimer);
      toastTimer = win.setTimeout(() => {
        toastEl.hidden = true;
      }, 2600);
    }
    function showAlertBanner(message, kind = "waiting") {
      const isError = kind === "error";
      alertIconEl.replaceChildren(pixelIcon(doc, isError ? "sadMac" : "happyMac", 30));
      alertTitleEl.textContent = isError ? "Sad Mac \xB7 \u5F02\u5E38\u63D0\u9192" : "Happy Mac \xB7 \u5BBF\u4E3B\u63D0\u9192";
      alertMsgEl.textContent = message;
      alertEl.hidden = false;
      if (!expanded) {
        miniWrap.classList.add("is-alerting");
      }
    }
    function showThoughtBubble(candidate) {
      if (!candidate) return;
      activeBubbleShare = candidate;
      bubbleTagEl.textContent = candidate.generationSource === "model" ? "\uF8FF InnerLife \xB7 AI" : "\uF8FF InnerLife";
      bubbleTextEl.textContent = candidate.text;
      bubbleEl.hidden = false;
      sound.happy(win);
      if (expanded) {
        notify(`InnerLife \u65B0\u601D\u7EEA\uFF1A${candidate.text.slice(0, 32)}\u2026`);
      }
    }
    function hideThoughtBubble() {
      activeBubbleShare = null;
      bubbleEl.hidden = true;
    }
    function openSidecarWithPrompt(promptText) {
      setExpanded(true);
      openApp("mini-dsh");
      const entry = openWindows.get("mini-dsh");
      entry?.api?.switchToSidecar?.(promptText);
    }
    bubbleEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-bact]");
      if (!btn || !activeBubbleShare) return;
      e.stopPropagation();
      sound.click(win);
      const share = activeBubbleShare;
      const act = btn.dataset.bact;
      if (act === "dismiss") {
        innerLife.dismiss(share.id);
        hideThoughtBubble();
      } else if (act === "fill") {
        const ok = bridge.fillHostDraft(share.text, { replace: false });
        if (ok) innerLife.markUsed(share.id);
        hideThoughtBubble();
        notify(ok ? "\u5DF2\u586B\u5165\u5916\u90E8 DSH \u8F93\u5165\u6846" : "\u672A\u627E\u5230\u5916\u90E8\u8F93\u5165\u6846");
      } else if (act === "note") {
        noteStore.appendNote("InnerLife", share.text);
        innerLife.markUsed(share.id);
        hideThoughtBubble();
        setExpanded(true);
        openApp("notepad");
      } else if (act === "chat") {
        innerLife.markUsed(share.id);
        hideThoughtBubble();
        openSidecarWithPrompt(`\u5173\u4E8E\u4F60\u521A\u624D\u7422\u78E8\u7684\u8FD9\u70B9\uFF1A\u300C${share.text}\u300D\u2014\u2014\u5C55\u5F00\u8BF4\u8BF4\u5177\u4F53\u600E\u4E48\u6539\uFF1F`);
      }
    });
    macWrap.querySelector("[data-alert-ok]").addEventListener("click", () => {
      sound.click(win);
      alertEl.hidden = true;
      miniWrap.classList.remove("is-alerting");
    });
    function applyScreenMode(next) {
      screenMode = next;
      prefs.set("screenMode", screenMode);
      stage.dataset.screenMode = screenMode;
      const meta = SCREEN_MODES.find((m) => m.id === screenMode) || SCREEN_MODES[0];
      modeLabelEl.textContent = meta.label;
    }
    function applySound(next) {
      soundOn = Boolean(next);
      prefs.set("sound", soundOn);
      soundHwBtn.replaceChildren(pixelIcon(doc, soundOn ? "soundOn" : "soundOff", 12));
      soundHwBtn.title = soundOn ? "\u590D\u53E4\u63D0\u793A\u97F3\uFF1A\u5F00" : "\u590D\u53E4\u63D0\u793A\u97F3\uFF1A\u9759\u97F3";
    }
    function applyDocked(side) {
      docked = side;
      prefs.set("docked", side);
      miniWrap.dataset.docked = side || "";
    }
    function renderMiniScreen(snap) {
      const status = snap.status || "idle";
      const meta = STATUS_META[status] || STATUS_META.idle;
      miniCrtEl.dataset.scene = status === "idle" ? IDLE_SCENES[idleSceneIndex] : status;
      if (status === "idle") {
        const scene = IDLE_SCENES[idleSceneIndex];
        if (scene === "toaster") {
          miniGlyphEl.replaceChildren(pixelIcon(doc, "toaster", 22));
          miniTextEl.textContent = "TOAST";
        } else if (scene === "stars") {
          miniGlyphEl.replaceChildren(pixelIcon(doc, "stars", 22));
          miniTextEl.textContent = "1984";
        } else if (scene === "clock") {
          miniGlyphEl.replaceChildren();
          const clk = doc.createElement("span");
          clk.className = "h84-mini-clock";
          clk.textContent = (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5);
          miniGlyphEl.append(clk);
          miniTextEl.textContent = "READY";
        } else {
          miniGlyphEl.replaceChildren(pixelIcon(doc, "happyMac", 22));
          miniTextEl.textContent = "IDLE";
        }
      } else if (status === "working") {
        miniGlyphEl.replaceChildren();
        const bars = doc.createElement("span");
        bars.className = "h84-code-bars";
        bars.innerHTML = "<i></i><i></i><i></i>";
        miniGlyphEl.append(bars);
        miniTextEl.textContent = "WRITE";
      } else {
        miniGlyphEl.replaceChildren(pixelIcon(doc, meta.icon, 22));
        miniTextEl.textContent = meta.label;
      }
    }
    function applyHostStatus(snap) {
      const meta = STATUS_META[snap.status] || STATUS_META.idle;
      hostPillEl.textContent = meta.label;
      renderMiniScreen(snap);
      const diskActive = snap.status === "tool" || snap.status === "working";
      miniLedEl.classList.toggle("is-lit", diskActive);
      mainLedEl.classList.toggle("is-lit", diskActive);
      miniWrap.dataset.status = snap.status;
      if (snap.status === "waiting") {
        miniWrap.classList.add("is-alerting");
      } else if (snap.status === "idle") {
        miniWrap.classList.remove("is-alerting");
      }
    }
    const unsubInnerLife = innerLife.subscribe((ilSnap) => {
      const n = ilSnap.pending.length;
      miniBadgeEl.textContent = String(n);
      miniBadgeEl.hidden = n === 0;
    });
    const sceneTimer = win.setInterval(() => {
      const snap = bridge.getSnapshot();
      if (snap.status === "idle") {
        idleSceneIndex = (idleSceneIndex + 1) % IDLE_SCENES.length;
        renderMiniScreen(snap);
      }
    }, 9e3);
    let bootTimer = null;
    function playBoot(force = false) {
      if (hasBooted && !force) return;
      hasBooted = true;
      bootEl.hidden = false;
      sound.startup(win);
      bootSvgSlot.replaceChildren(helloBootSvg(doc));
      win.clearTimeout(bootTimer);
      bootTimer = win.setTimeout(() => {
        bootEl.hidden = true;
      }, 2300);
    }
    macWrap.querySelector("[data-boot-skip]").addEventListener("click", () => {
      win.clearTimeout(bootTimer);
      bootEl.hidden = true;
    });
    function focusWindow(winEl) {
      zCounter += 1;
      winEl.style.zIndex = String(zCounter);
      for (const el of windowsLayerEl.querySelectorAll(".h84-win")) {
        el.classList.toggle("is-focused", el === winEl);
      }
    }
    function openApp(appId) {
      const def = APPS.find((a) => a.id === appId);
      if (!def) return;
      if (openWindows.has(appId)) {
        const existing = openWindows.get(appId);
        existing.el.hidden = false;
        focusWindow(existing.el);
        return;
      }
      sound.click(win);
      const winEl = doc.createElement("section");
      winEl.className = "h84-win";
      winEl.dataset.app = appId;
      const offset = openWindows.size % 5 * 16;
      winEl.style.width = `${def.width}px`;
      winEl.style.height = `${def.height}px`;
      winEl.style.left = `${12 + offset}px`;
      winEl.style.top = `${12 + offset}px`;
      const bar = doc.createElement("header");
      bar.className = "h84-win-bar";
      bar.innerHTML = `
      <button type="button" class="h84-win-close" aria-label="\u5173\u95ED ${def.title}" title="\u5173\u95ED"></button>
      <span class="h84-win-title">${def.title}</span>
    `;
      const body = doc.createElement("div");
      body.className = "h84-win-body";
      let instance;
      const ctxArgs = {
        win,
        bridge,
        noteStore,
        alarmStore,
        innerLife,
        openSidecarWithPrompt,
        desktopApi: { openApp, applyScreenMode, applySound },
        getScreenMode: () => screenMode,
        notify
      };
      if (appId === "mini-dsh") instance = renderMiniDsh(doc, ctxArgs);
      else if (appId === "innerlife") instance = renderInnerLifeApp(doc, ctxArgs);
      else if (appId === "terminal") instance = renderTerminal(doc, ctxArgs);
      else if (appId === "notepad") instance = renderNotePad(doc, ctxArgs);
      else if (appId === "floppy") instance = renderFloppyDisk(doc, ctxArgs);
      else if (appId === "alarm") instance = renderAlarmClock(doc, ctxArgs);
      else if (appId === "macpaint") instance = renderMacPaint(doc, ctxArgs);
      else if (appId === "minesweeper") instance = renderMinesweeper(doc, ctxArgs);
      if (instance?.element) body.append(instance.element);
      winEl.append(bar, body);
      windowsLayerEl.append(winEl);
      openWindows.set(appId, { el: winEl, api: instance, destroy: instance?.destroy });
      focusWindow(winEl);
      winEl.addEventListener("pointerdown", () => focusWindow(winEl));
      bar.querySelector(".h84-win-close").addEventListener("click", (e) => {
        e.stopPropagation();
        sound.click(win);
        closeApp(appId);
      });
      bar.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".h84-win-close")) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const origL = winEl.offsetLeft;
        const origT = winEl.offsetTop;
        const onMove = (ev) => {
          const nextL = Math.max(0, Math.min(windowsLayerEl.clientWidth - 90, origL + ev.clientX - startX));
          const nextT = Math.max(0, Math.min(windowsLayerEl.clientHeight - 36, origT + ev.clientY - startY));
          winEl.style.left = `${nextL}px`;
          winEl.style.top = `${nextT}px`;
        };
        const onUp = () => {
          win.removeEventListener("pointermove", onMove);
          win.removeEventListener("pointerup", onUp);
        };
        win.addEventListener("pointermove", onMove);
        win.addEventListener("pointerup", onUp);
      });
    }
    function closeApp(appId) {
      const entry = openWindows.get(appId);
      if (!entry) return;
      entry.destroy?.();
      entry.el.remove();
      openWindows.delete(appId);
    }
    for (const app of APPS) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "h84-desk-icon";
      btn.dataset.openApp = app.id;
      const glyph = doc.createElement("span");
      glyph.className = "h84-desk-glyph";
      glyph.append(pixelIcon(doc, app.icon, 20));
      const label = doc.createElement("span");
      label.className = "h84-desk-label";
      label.textContent = app.title;
      btn.append(glyph, label);
      btn.addEventListener("click", () => openApp(app.id));
      iconsColEl.append(btn);
    }
    let openMenu = null;
    const MENUS = {
      apple: () => [
        { label: "About Hello '84\u2026", run: () => showAlertBanner("Hello '84 v0.2 \u2014 1984 Macintosh + InnerLife \u4F34\u751F\u526F\u8111\u3002", "info") },
        { label: "\u91CD\u64AD hello. \u5F00\u673A\u52A8\u753B", run: () => playBoot(true) },
        { label: prefs.get("skipBoot", false) ? "\u2713 \u8DF3\u8FC7\u9996\u6B21\u5F00\u673A\u52A8\u753B" : "\u8DF3\u8FC7\u9996\u6B21\u5F00\u673A\u52A8\u753B", run: () => {
          const next = !prefs.get("skipBoot", false);
          prefs.set("skipBoot", next);
          notify(next ? "\u5DF2\u8BBE\u4E3A\u8DF3\u8FC7\u5F00\u673A\u52A8\u753B" : "\u5DF2\u5F00\u542F\u5F00\u673A\u52A8\u753B");
        } }
      ],
      file: () => [
        ...APPS.map((a) => ({ label: `Open ${a.title}`, run: () => openApp(a.id) })),
        { label: "Close All Windows", run: () => {
          for (const id of [...openWindows.keys()]) closeApp(id);
        } }
      ],
      view: () => SCREEN_MODES.map((m) => ({
        label: `${screenMode === m.id ? "\u2713 " : "  "}${m.label}`,
        run: () => {
          applyScreenMode(m.id);
          notify(`\u5C4F\u5E55\u6A21\u5F0F\uFF1A${m.label}`);
        }
      })),
      special: () => [
        { label: "InnerLife \xB7 \u73B0\u5728\u7422\u78E8\u4E00\u4E0B", run: () => {
          openApp("innerlife");
          innerLife.tick({ manual: true, reason: "menu" });
        } },
        { label: soundOn ? "\u2713 \u590D\u53E4\u63D0\u793A\u97F3 (\u5F00)" : "\u590D\u53E4\u63D0\u793A\u97F3 (\u9759\u97F3)", run: () => {
          applySound(!soundOn);
          notify(soundOn ? "\u5DF2\u5F00\u542F\u590D\u53E4\u63D0\u793A\u97F3" : "\u5DF2\u9759\u97F3");
        } },
        { label: "\u8D34\u8FB9\u6536\u8D77 (\u53F3\u4FA7)", run: () => {
          setExpanded(false);
          applyDocked("right");
        } },
        { label: "\u8D34\u8FB9\u6536\u8D77 (\u5DE6\u4FA7)", run: () => {
          setExpanded(false);
          applyDocked("left");
        } },
        { label: "Reset Mini Position", run: () => {
          prefs.remove("miniPos");
          applyDocked(null);
          miniWrap.style.left = "";
          miniWrap.style.top = "";
          miniWrap.style.right = "22px";
          miniWrap.style.bottom = "26px";
        } }
      ]
    };
    function closeDropdown() {
      openMenu = null;
      dropdownEl.hidden = true;
    }
    macWrap.querySelector(".h84-menubar").addEventListener("click", (e) => {
      const item = e.target.closest("[data-menu]");
      if (!item) return;
      sound.click(win);
      const name = item.dataset.menu;
      if (openMenu === name) {
        closeDropdown();
        return;
      }
      openMenu = name;
      dropdownEl.replaceChildren();
      for (const opt of MENUS[name]()) {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "h84-drop-item";
        b.textContent = opt.label;
        b.addEventListener("click", () => {
          closeDropdown();
          opt.run();
        });
        dropdownEl.append(b);
      }
      dropdownEl.style.left = `${item.offsetLeft}px`;
      dropdownEl.hidden = false;
    });
    macWrap.querySelector("[data-desktop]").addEventListener("pointerdown", closeDropdown);
    macWrap.querySelector(".h84-chassis-ctrls").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-hw]");
      if (!btn) return;
      sound.click(win);
      const hw = btn.dataset.hw;
      if (hw === "collapse") setExpanded(false);
      else if (hw === "sound") applySound(!soundOn);
      else if (hw === "mode") {
        const idx = SCREEN_MODES.findIndex((m) => m.id === screenMode);
        const next = SCREEN_MODES[(idx + 1) % SCREEN_MODES.length];
        applyScreenMode(next.id);
        notify(`\u5C4F\u5E55\u6A21\u5F0F\uFF1A${next.label}`);
      }
    });
    const macDragHandle = macWrap.querySelector("[data-mac-drag]");
    macDragHandle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const rect = macWrap.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      macWrap.style.right = "auto";
      macWrap.style.bottom = "auto";
      macWrap.style.left = `${rect.left}px`;
      macWrap.style.top = `${rect.top}px`;
      const onMove = (ev) => {
        const x = Math.max(8, Math.min(win.innerWidth - rect.width - 8, rect.left + ev.clientX - startX));
        const y = Math.max(8, Math.min(win.innerHeight - 60, rect.top + ev.clientY - startY));
        macWrap.style.left = `${x}px`;
        macWrap.style.top = `${y}px`;
      };
      const onUp = () => {
        win.removeEventListener("pointermove", onMove);
        win.removeEventListener("pointerup", onUp);
      };
      win.addEventListener("pointermove", onMove);
      win.addEventListener("pointerup", onUp);
    });
    let miniDragged = false;
    miniMacEl.addEventListener("pointerdown", (e) => {
      miniDragged = false;
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = miniWrap.getBoundingClientRect();
      const onMove = (ev) => {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
        miniDragged = true;
        applyDocked(null);
        miniWrap.style.right = "auto";
        miniWrap.style.bottom = "auto";
        const x = Math.max(0, Math.min(win.innerWidth - rect.width, rect.left + ev.clientX - startX));
        const y = Math.max(0, Math.min(win.innerHeight - rect.height, rect.top + ev.clientY - startY));
        miniWrap.style.left = `${x}px`;
        miniWrap.style.top = `${y}px`;
      };
      const onUp = () => {
        win.removeEventListener("pointermove", onMove);
        win.removeEventListener("pointerup", onUp);
        if (!miniDragged) return;
        const cur = miniWrap.getBoundingClientRect();
        if (cur.left <= 14) {
          applyDocked("left");
        } else if (win.innerWidth - cur.right <= 14) {
          applyDocked("right");
        } else {
          prefs.set("miniPos", { x: Math.round(cur.left), y: Math.round(cur.top) });
        }
      };
      win.addEventListener("pointermove", onMove);
      win.addEventListener("pointerup", onUp);
    });
    function setExpanded(next) {
      expanded = Boolean(next);
      macWrap.hidden = !expanded;
      miniWrap.hidden = expanded;
      if (expanded) {
        miniWrap.classList.remove("is-alerting");
        playBoot(false);
        if (!openWindows.size) openApp("mini-dsh");
      }
    }
    miniMacEl.addEventListener("click", () => {
      if (miniDragged) return;
      sound.click(win);
      setExpanded(true);
    });
    miniMacEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setExpanded(true);
      }
    });
    function tickClock() {
      menuClockEl.textContent = (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5);
      if (bridge.getSnapshot().status === "idle" && IDLE_SCENES[idleSceneIndex] === "clock") {
        renderMiniScreen(bridge.getSnapshot());
      }
    }
    tickClock();
    const clockTimer = win.setInterval(tickClock, 15e3);
    applyScreenMode(screenMode);
    applySound(soundOn);
    applyDocked(docked);
    applyHostStatus(bridge.getSnapshot());
    const unsubBridge = bridge.subscribe(applyHostStatus);
    return {
      host,
      shadow,
      innerLife,
      setExpanded,
      openApp,
      closeApp,
      applyScreenMode,
      getScreenMode: () => screenMode,
      destroy() {
        win.clearInterval(clockTimer);
        win.clearInterval(sceneTimer);
        win.clearTimeout(toastTimer);
        win.clearTimeout(bootTimer);
        unsubBridge();
        unsubInnerLife();
        innerLife.destroy();
        alarmStore.destroy();
        for (const id of [...openWindows.keys()]) closeApp(id);
        host.remove();
      }
    };
  }

  // src/client.js
  var FRAME = "conversation.hero.frame";
  var UTILITIES = "conversation.session.header.utilities";
  var INPUT_LEFT = "conversation.input.left";
  function selectActivity(chat) {
    const live = chat?.legacy;
    if (live?.runningCalls?.length) return "tool";
    const kind = live?.partial?.blocks?.at(-1)?.kind;
    if (kind === "reasoning") return "thinking";
    if (kind === "tool-call") return "tool";
    if (kind === "text" || kind === "image") return "working";
    return "busy";
  }
  function selectFailedEnding(chat) {
    const timeline = chat?.timeline;
    const turn = timeline?.turnOrder?.at?.(-1);
    const reason = timeline?.turns?.get?.(turn)?.end?.data?.reason;
    return reason?.kind === "error" || reason?.kind === "interrupted";
  }
  function selectSessionState(session) {
    if (session?.promptError || session?.openState === "error") return "error";
    if (session?.running === true) return "busy";
    if (session?.openState === "open" && session?.running === false) return "idle";
    return "unknown";
  }
  window.__ModuleLoader__.load({
    id: "dsh-hello84",
    factory(require2) {
      const React = require2("react");
      return {
        name: "dsh-hello84",
        inject: ["slots", "uiWorkspace"],
        apply(ctx) {
          const navigation = ctx.get?.("uiWorkspace");
          const bridge = createHostBridge(window, {
            openSession: (id) => navigation?.openSession?.(id)
          });
          const widget = mountHello84(window, bridge, '/* src/style.css */\n:host {\n  all: initial;\n  font-family:\n    "Geneva",\n    "Chicago",\n    "SF Mono",\n    "Menlo",\n    "Monaco",\n    "Consolas",\n    monospace;\n}\n.h84-stage {\n  --h84-bg: #f4f4ec;\n  --h84-surface: #ffffff;\n  --h84-fg: #111111;\n  --h84-muted: #585852;\n  --h84-invert-bg: #111111;\n  --h84-invert-fg: #f4f4ec;\n  --h84-desk-a: #d8d8ce;\n  --h84-desk-b: #f4f4ec;\n  --h84-scanline: rgba(0, 0, 0, 0.042);\n  --h84-vignette: inset 0 0 18px rgba(0, 0, 0, 0.14);\n  --h84-crt-glow: none;\n  --h84-chassis-1: #eae3cf;\n  --h84-chassis-2: #cfc5ab;\n  --h84-chassis-bevel: #b3a78b;\n  --h84-chassis-dark: #867c66;\n  --h84-chassis-border: #332d22;\n  font-family:\n    "SF Mono",\n    "Menlo",\n    "Monaco",\n    "Consolas",\n    "PingFang SC",\n    monospace;\n  font-size: 12px;\n  line-height: 1.4;\n  color: var(--h84-fg);\n  -webkit-font-smoothing: none;\n}\n.h84-stage[data-screen-mode=green] {\n  --h84-bg: #07160b;\n  --h84-surface: #0b2212;\n  --h84-fg: #39ff7a;\n  --h84-muted: #1da84c;\n  --h84-invert-bg: #39ff7a;\n  --h84-invert-fg: #07160b;\n  --h84-desk-a: #0b2312;\n  --h84-desk-b: #061309;\n  --h84-scanline: rgba(57, 255, 122, 0.09);\n  --h84-vignette: inset 0 0 26px rgba(0, 0, 0, 0.55);\n  --h84-crt-glow: 0 0 10px rgba(57, 255, 122, 0.25);\n}\n.h84-stage[data-screen-mode=amber] {\n  --h84-bg: #180f04;\n  --h84-surface: #241707;\n  --h84-fg: #ffb238;\n  --h84-muted: #b87a1c;\n  --h84-invert-bg: #ffb238;\n  --h84-invert-fg: #180f04;\n  --h84-desk-a: #241706;\n  --h84-desk-b: #140c03;\n  --h84-scanline: rgba(255, 178, 56, 0.085);\n  --h84-vignette: inset 0 0 26px rgba(0, 0, 0, 0.55);\n  --h84-crt-glow: 0 0 10px rgba(255, 178, 56, 0.24);\n}\n*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\nbutton,\ninput,\ntextarea,\nselect {\n  font: inherit;\n  color: inherit;\n}\n.h84-crt-screen ::-webkit-scrollbar {\n  width: 10px;\n  height: 10px;\n}\n.h84-crt-screen ::-webkit-scrollbar-track {\n  background: var(--h84-bg);\n  border-left: 1px solid var(--h84-fg);\n}\n.h84-crt-screen ::-webkit-scrollbar-thumb {\n  background: var(--h84-surface);\n  border: 1.5px solid var(--h84-fg);\n}\n.h84-mini-wrap {\n  position: fixed;\n  pointer-events: auto;\n  user-select: none;\n  transition: transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1);\n}\n.h84-mini-wrap[data-docked=right] {\n  left: auto !important;\n  right: -56px !important;\n}\n.h84-mini-wrap[data-docked=right]:hover {\n  transform: translateX(-48px);\n}\n.h84-mini-wrap[data-docked=left] {\n  right: auto !important;\n  left: -56px !important;\n}\n.h84-mini-wrap[data-docked=left]:hover {\n  transform: translateX(48px);\n}\n.h84-mini-mac {\n  position: relative;\n  width: 82px;\n  padding: 7px 7px 9px;\n  border-radius: 8px 8px 5px 5px;\n  background:\n    linear-gradient(\n      165deg,\n      var(--h84-chassis-1) 0%,\n      var(--h84-chassis-2) 100%);\n  border: 2px solid var(--h84-chassis-border);\n  box-shadow:\n    3px 4px 0 rgba(0, 0, 0, 0.3),\n    inset 1px 1px 0 rgba(255, 255, 255, 0.72),\n    inset -1px -2px 0 rgba(70, 60, 42, 0.25);\n  cursor: grab;\n  transition: transform 120ms ease, box-shadow 120ms ease;\n}\n.h84-mini-mac:hover {\n  transform: translateY(-2px);\n  box-shadow: 4px 6px 0 rgba(0, 0, 0, 0.32), inset 1px 1px 0 rgba(255, 255, 255, 0.78);\n}\n.h84-mini-mac:active {\n  cursor: grabbing;\n}\n.h84-mini-wrap.is-alerting .h84-mini-mac {\n  animation: h84-bounce 0.75s steps(2, end) infinite;\n}\n@keyframes h84-bounce {\n  0%, 100% {\n    transform: translateY(0);\n  }\n  50% {\n    transform: translateY(-5px);\n  }\n}\n.h84-mini-crt {\n  height: 52px;\n  border-radius: 5px;\n  background: var(--h84-bg);\n  color: var(--h84-fg);\n  border: 2px solid #2b261e;\n  box-shadow: inset 1px 1px 4px rgba(0, 0, 0, 0.38), var(--h84-crt-glow);\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 3px;\n  position: relative;\n  overflow: hidden;\n}\n.h84-mini-crt::after {\n  content: "";\n  position: absolute;\n  inset: 0;\n  background:\n    repeating-linear-gradient(\n      0deg,\n      transparent 0 2px,\n      var(--h84-scanline) 2px 3px);\n  pointer-events: none;\n}\n.h84-mini-text {\n  font-size: 9px;\n  font-weight: 700;\n  letter-spacing: 0.05em;\n}\n.h84-mini-badge {\n  position: absolute;\n  top: 2px;\n  right: 3px;\n  min-width: 13px;\n  height: 13px;\n  padding: 0 3px;\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n  font-size: 8px;\n  font-weight: 700;\n  line-height: 13px;\n  text-align: center;\n  z-index: 2;\n}\n.h84-mini-badge[hidden] {\n  display: none;\n}\n.h84-mini-clock {\n  font-size: 13px;\n  font-weight: 700;\n  letter-spacing: 0.04em;\n}\n.h84-mini-crt[data-scene=toaster] .h84-mini-glyph {\n  animation: h84-float 1.8s ease-in-out infinite;\n}\n.h84-mini-crt[data-scene=stars] .h84-mini-glyph {\n  animation: h84-twinkle 1.4s steps(2, end) infinite;\n}\n.h84-mini-crt[data-scene=thinking] .h84-mini-glyph,\n.h84-mini-crt[data-scene=busy] .h84-mini-glyph {\n  animation: h84-wobble 1.2s steps(4, end) infinite;\n}\n.h84-mini-crt[data-scene=tool] .h84-mini-glyph {\n  animation: h84-pulse 0.55s steps(2, end) infinite;\n}\n@keyframes h84-float {\n  0%, 100% {\n    transform: translate(-3px, 1px);\n  }\n  50% {\n    transform: translate(3px, -2px);\n  }\n}\n@keyframes h84-twinkle {\n  0%, 100% {\n    opacity: 1;\n  }\n  50% {\n    opacity: 0.45;\n  }\n}\n@keyframes h84-wobble {\n  0%, 100% {\n    transform: rotate(0deg);\n  }\n  25% {\n    transform: rotate(8deg);\n  }\n  75% {\n    transform: rotate(-8deg);\n  }\n}\n@keyframes h84-pulse {\n  0%, 100% {\n    transform: scale(1);\n  }\n  50% {\n    transform: scale(0.9);\n  }\n}\n.h84-code-bars {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  width: 34px;\n  padding: 2px 0;\n}\n.h84-code-bars i {\n  display: block;\n  height: 3px;\n  background: var(--h84-fg);\n  animation: h84-code-scan 1.1s steps(4, end) infinite;\n}\n.h84-code-bars i:nth-child(1) {\n  width: 85%;\n}\n.h84-code-bars i:nth-child(2) {\n  width: 60%;\n  animation-delay: 0.25s;\n}\n.h84-code-bars i:nth-child(3) {\n  width: 95%;\n  animation-delay: 0.5s;\n}\n@keyframes h84-code-scan {\n  0%, 100% {\n    opacity: 1;\n  }\n  50% {\n    opacity: 0.3;\n  }\n}\n.h84-bubble {\n  position: absolute;\n  right: 0;\n  bottom: calc(100% + 10px);\n  width: 248px;\n  background: var(--h84-surface);\n  color: var(--h84-fg);\n  border: 2px solid var(--h84-fg);\n  box-shadow: 3px 3px 0 var(--h84-fg);\n  padding: 7px 8px;\n  z-index: 5;\n}\n.h84-bubble[hidden] {\n  display: none;\n}\n.h84-bubble::after {\n  content: "";\n  position: absolute;\n  right: 20px;\n  bottom: -7px;\n  width: 10px;\n  height: 10px;\n  background: var(--h84-surface);\n  border-right: 2px solid var(--h84-fg);\n  border-bottom: 2px solid var(--h84-fg);\n  transform: rotate(45deg);\n}\n.h84-bubble-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-bottom: 4px;\n  font-size: 10px;\n  font-weight: 700;\n}\n.h84-bubble-x {\n  border: 1px solid var(--h84-fg);\n  background: var(--h84-bg);\n  width: 16px;\n  height: 16px;\n  line-height: 12px;\n  padding: 0;\n  cursor: pointer;\n}\n.h84-bubble-text {\n  font-size: 11px;\n  line-height: 1.45;\n  margin-bottom: 6px;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n.h84-bubble-acts {\n  display: flex;\n  gap: 4px;\n  flex-wrap: wrap;\n}\n.h84-mini-chin {\n  margin-top: 7px;\n  padding-top: 5px;\n  border-top: 1px solid rgba(51, 45, 34, 0.22);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.h84-rainbow-badge {\n  display: inline-block;\n  width: 10px;\n  height: 10px;\n  border-radius: 2px;\n  background:\n    linear-gradient(\n      180deg,\n      #61bb46 0 17%,\n      #fdb827 17% 34%,\n      #f5821f 34% 51%,\n      #e03a3e 51% 68%,\n      #963d97 68% 85%,\n      #009ddc 85% 100%);\n  border: 1px solid rgba(0, 0, 0, 0.4);\n  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.45);\n}\n.h84-rainbow-badge.is-lg {\n  width: 15px;\n  height: 15px;\n}\n.h84-floppy-slot {\n  display: flex;\n  align-items: center;\n  gap: 3px;\n  width: 30px;\n  height: 5px;\n  background: #352f24;\n  border-radius: 1px;\n  padding: 0 2px;\n  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);\n}\n.h84-floppy-led {\n  width: 4px;\n  height: 4px;\n  border-radius: 50%;\n  background: #524a3c;\n}\n.h84-floppy-led.is-lit {\n  background: #ff4522;\n  box-shadow: 0 0 6px #ff4522;\n  animation: h84-blink 0.32s steps(2, end) infinite;\n}\n@keyframes h84-blink {\n  0%, 100% {\n    opacity: 1;\n  }\n  50% {\n    opacity: 0.22;\n  }\n}\n.h84-dock-tab {\n  display: none;\n  position: absolute;\n  top: 50%;\n  transform: translateY(-50%);\n  background: var(--h84-chassis-border);\n  color: var(--h84-chassis-1);\n  font-size: 9px;\n  font-weight: 700;\n  padding: 5px 4px;\n  border-radius: 3px;\n  box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.25);\n}\n.h84-mini-wrap[data-docked=right] .h84-dock-tab {\n  display: block;\n  left: -16px;\n}\n.h84-mini-wrap[data-docked=left] .h84-dock-tab {\n  display: block;\n  right: -16px;\n}\n.h84-mac-wrap {\n  position: fixed;\n  right: 22px;\n  bottom: 22px;\n  width: 552px;\n  max-width: calc(100vw - 24px);\n  pointer-events: auto;\n}\n.h84-chassis {\n  background:\n    linear-gradient(\n      175deg,\n      var(--h84-chassis-1) 0%,\n      var(--h84-chassis-2) 100%);\n  border: 2px solid var(--h84-chassis-border);\n  border-radius: 14px 14px 9px 9px;\n  padding: 11px 15px 13px;\n  box-shadow:\n    7px 8px 0 rgba(0, 0, 0, 0.28),\n    inset 1px 2px 0 rgba(255, 255, 255, 0.78),\n    inset -2px -3px 0 rgba(70, 60, 42, 0.24);\n}\n.h84-chassis-top {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin-bottom: 9px;\n  cursor: move;\n  user-select: none;\n}\n.h84-vents {\n  display: flex;\n  gap: 3px;\n}\n.h84-vents span {\n  display: block;\n  width: 3px;\n  height: 11px;\n  background: var(--h84-chassis-dark);\n  border-radius: 1px;\n  box-shadow: inset 1px 1px 0 rgba(0, 0, 0, 0.35);\n}\n.h84-model-tag {\n  font-size: 10px;\n  font-weight: 700;\n  letter-spacing: 0.08em;\n  color: #4d4537;\n  text-transform: uppercase;\n}\n.h84-chassis-ctrls {\n  display: flex;\n  gap: 5px;\n}\n.h84-hw-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 26px;\n  height: 21px;\n  padding: 0 7px;\n  border: 1.5px solid var(--h84-chassis-border);\n  border-radius: 3px;\n  background:\n    linear-gradient(\n      180deg,\n      #f3ede0,\n      #dfd6c1);\n  color: #2b251c;\n  font-size: 10px;\n  font-weight: 700;\n  cursor: pointer;\n  box-shadow: 1px 1px 0 var(--h84-chassis-border);\n}\n.h84-hw-btn:hover {\n  background: #fbf7ee;\n}\n.h84-hw-btn:active {\n  transform: translate(1px, 1px);\n  box-shadow: none;\n}\n.h84-crt-frame {\n  padding: 9px;\n  border-radius: 11px;\n  background:\n    linear-gradient(\n      145deg,\n      #958b75,\n      #bab098);\n  border: 2px solid #574e3e;\n  box-shadow: inset 3px 3px 7px rgba(0, 0, 0, 0.36), inset -2px -2px 4px rgba(255, 255, 255, 0.25);\n}\n.h84-crt-screen {\n  position: relative;\n  height: 400px;\n  border-radius: 7px;\n  border: 2px solid #191612;\n  background: var(--h84-bg);\n  color: var(--h84-fg);\n  overflow: hidden;\n  display: flex;\n  flex-direction: column;\n  box-shadow: var(--h84-vignette), var(--h84-crt-glow);\n}\n.h84-crt-screen::after {\n  content: "";\n  position: absolute;\n  inset: 0;\n  background:\n    repeating-linear-gradient(\n      0deg,\n      transparent 0 2px,\n      var(--h84-scanline) 2px 3px);\n  box-shadow: var(--h84-vignette);\n  pointer-events: none;\n  z-index: 999;\n}\n.h84-menubar {\n  height: 23px;\n  flex-shrink: 0;\n  background: var(--h84-surface);\n  border-bottom: 1.5px solid var(--h84-fg);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 0 7px;\n  user-select: none;\n  z-index: 200;\n}\n.h84-menu-left,\n.h84-menu-right {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n}\n.h84-menu-item {\n  border: none;\n  background: transparent;\n  padding: 1px 7px;\n  height: 20px;\n  font-size: 11px;\n  font-weight: 700;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n}\n.h84-menu-item:hover {\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n}\n.h84-host-pill {\n  font-size: 10px;\n  font-weight: 700;\n  padding: 0 6px;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  margin-right: 6px;\n}\n.h84-menu-clock {\n  font-size: 11px;\n  font-weight: 700;\n}\n.h84-dropdown {\n  position: absolute;\n  top: 23px;\n  min-width: 174px;\n  background: var(--h84-surface);\n  border: 1.5px solid var(--h84-fg);\n  box-shadow: 3px 3px 0 var(--h84-fg);\n  z-index: 300;\n  display: flex;\n  flex-direction: column;\n}\n.h84-dropdown[hidden] {\n  display: none;\n}\n.h84-drop-item {\n  border: none;\n  background: transparent;\n  text-align: left;\n  padding: 5px 10px;\n  font-size: 11px;\n  cursor: pointer;\n}\n.h84-drop-item:hover {\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n}\n.h84-desktop {\n  position: relative;\n  flex: 1;\n  background-color: var(--h84-desk-b);\n  background-image:\n    linear-gradient(\n      45deg,\n      var(--h84-desk-a) 25%,\n      transparent 25%),\n    linear-gradient(\n      -45deg,\n      var(--h84-desk-a) 25%,\n      transparent 25%),\n    linear-gradient(\n      45deg,\n      transparent 75%,\n      var(--h84-desk-a) 75%),\n    linear-gradient(\n      -45deg,\n      transparent 75%,\n      var(--h84-desk-a) 75%);\n  background-size: 4px 4px;\n  background-position:\n    0 0,\n    0 2px,\n    2px -2px,\n    -2px 0;\n  overflow: hidden;\n}\n.h84-icons-col {\n  position: absolute;\n  top: 6px;\n  right: 6px;\n  display: grid;\n  grid-template-columns: repeat(2, 64px);\n  gap: 5px 2px;\n  z-index: 2;\n}\n.h84-desk-icon {\n  width: 64px;\n  padding: 2px;\n  border: 1px solid transparent;\n  background: transparent;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 2px;\n  cursor: pointer;\n}\n.h84-desk-icon:hover .h84-desk-glyph {\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n}\n.h84-desk-icon:hover .h84-desk-label {\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n}\n.h84-desk-glyph {\n  width: 26px;\n  height: 26px;\n  background: var(--h84-surface);\n  border: 1.5px solid var(--h84-fg);\n  box-shadow: 2px 2px 0 var(--h84-fg);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.h84-desk-label {\n  font-size: 10px;\n  font-weight: 700;\n  background: var(--h84-surface);\n  border: 1px solid transparent;\n  padding: 0 3px;\n  white-space: nowrap;\n}\n.h84-windows-layer {\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n}\n.h84-win {\n  position: absolute;\n  pointer-events: auto;\n  background: var(--h84-surface);\n  border: 1.5px solid var(--h84-fg);\n  box-shadow: 3px 3px 0 var(--h84-fg);\n  display: flex;\n  flex-direction: column;\n  max-width: calc(100% - 14px);\n  max-height: calc(100% - 14px);\n}\n.h84-win-bar {\n  height: 22px;\n  flex-shrink: 0;\n  border-bottom: 1.5px solid var(--h84-fg);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  position: relative;\n  cursor: move;\n  user-select: none;\n  background: var(--h84-surface);\n}\n.h84-win.is-focused .h84-win-bar {\n  background:\n    repeating-linear-gradient(\n      0deg,\n      var(--h84-surface) 0 2px,\n      var(--h84-fg) 2px 3px);\n}\n.h84-win-close {\n  position: absolute;\n  left: 6px;\n  width: 12px;\n  height: 12px;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-surface);\n  cursor: pointer;\n  padding: 0;\n}\n.h84-win-close:hover {\n  background: var(--h84-invert-bg);\n}\n.h84-win-title {\n  background: var(--h84-surface);\n  padding: 0 8px;\n  font-size: 11px;\n  font-weight: 700;\n}\n.h84-win-body {\n  flex: 1;\n  overflow: auto;\n  padding: 7px;\n  display: flex;\n  flex-direction: column;\n}\n.h84-btn,\n.h84-btn-sm {\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-surface);\n  padding: 2px 7px;\n  font-size: 11px;\n  font-weight: 700;\n  cursor: pointer;\n  box-shadow: 1.5px 1.5px 0 var(--h84-fg);\n  white-space: nowrap;\n}\n.h84-btn:hover,\n.h84-btn.is-active,\n.h84-btn-sm:hover {\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n}\n.h84-btn:active,\n.h84-btn-sm:active {\n  transform: translate(1px, 1px);\n  box-shadow: none;\n}\n.h84-btn:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n.h84-btn-sm {\n  padding: 1px 5px;\n  font-size: 10px;\n}\n.h84-app-bar {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 4px;\n  margin-bottom: 6px;\n  align-items: center;\n}\n.h84-input,\n.h84-select,\n.h84-input-num {\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  padding: 2px 6px;\n  font-size: 11px;\n  outline: none;\n}\n.h84-input {\n  flex: 1;\n  min-width: 0;\n}\n.h84-input-num {\n  width: 48px;\n}\n.h84-check {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  font-size: 11px;\n  cursor: pointer;\n}\n.h84-minidsh {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n}\n.h84-tabs {\n  display: flex;\n  gap: 4px;\n  margin-bottom: 6px;\n}\n.h84-tab {\n  flex: 1;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  padding: 3px 6px;\n  font-size: 11px;\n  font-weight: 700;\n  cursor: pointer;\n  outline: none;\n}\n.h84-tab:focus-visible {\n  outline: 1px dotted var(--h84-fg);\n  outline-offset: -3px;\n}\n.h84-tab.is-active {\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n}\n.h84-pane {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  min-height: 0;\n}\n.h84-pane[hidden] {\n  display: none;\n}\n.h84-remote-status {\n  font-size: 10px;\n  font-weight: 700;\n  padding: 3px 6px;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  margin-bottom: 5px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.h84-session-list {\n  flex: 1;\n  min-height: 0;\n  overflow-y: auto;\n  overflow-x: hidden;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  margin-bottom: 6px;\n  display: block;\n}\n.h84-session-row {\n  display: block;\n  width: 100%;\n  flex-shrink: 0;\n  border: none;\n  border-bottom: 1px dotted var(--h84-muted);\n  background: transparent;\n  text-align: left;\n  padding: 5px 7px;\n  font-size: 11px;\n  line-height: 1.45;\n  cursor: pointer;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.h84-session-row:hover,\n.h84-session-row.is-current {\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n}\n.h84-session-row.is-waiting {\n  font-weight: 700;\n}\n.h84-terminal-bar {\n  display: flex;\n  gap: 4px;\n}\n.h84-empty {\n  padding: 12px;\n  font-size: 11px;\n  color: var(--h84-muted);\n  text-align: center;\n}\n.h84-sidecar-cfg {\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  padding: 6px;\n  margin-bottom: 6px;\n  display: grid;\n  gap: 4px;\n}\n.h84-sidecar-cfg[hidden] {\n  display: none;\n}\n.h84-sidecar-cfg label {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n  font-size: 10px;\n}\n.h84-sidecar-cfg input {\n  flex: 1;\n  border: 1px solid var(--h84-fg);\n  background: var(--h84-surface);\n  padding: 2px 4px;\n  font-size: 10px;\n}\n.h84-sidecar-log {\n  flex: 1;\n  overflow: auto;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  padding: 5px;\n  margin-bottom: 6px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.h84-msg {\n  font-size: 11px;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n.h84-msg-user {\n  font-weight: 700;\n}\n.h84-msg-tool {\n  font-size: 10px;\n  border-left: 2px solid var(--h84-fg);\n  padding-left: 4px;\n  color: var(--h84-muted);\n}\n.h84-msg-error {\n  border: 1px dashed var(--h84-fg);\n  padding: 3px 5px;\n}\n.h84-msg-sys {\n  font-size: 10px;\n  color: var(--h84-muted);\n}\n.h84-innerlife {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n}\n.h84-il-head {\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n}\n.h84-il-status {\n  font-size: 10px;\n  font-weight: 700;\n  padding: 3px 6px;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.h84-il-list {\n  flex: 1;\n  min-height: 0;\n  overflow-y: auto;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  padding: 5px;\n  display: block;\n}\n.h84-il-list[hidden] {\n  display: none;\n}\n.h84-il-card {\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-surface);\n  padding: 6px;\n  margin-bottom: 6px;\n  box-shadow: 2px 2px 0 var(--h84-fg);\n}\n.h84-il-meta {\n  font-size: 9px;\n  color: var(--h84-muted);\n  margin-bottom: 3px;\n  font-weight: 700;\n}\n.h84-il-body {\n  font-size: 11px;\n  line-height: 1.45;\n  margin-bottom: 6px;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n.h84-il-acts {\n  display: flex;\n  gap: 4px;\n  flex-wrap: wrap;\n}\n.h84-il-log-row {\n  font-size: 10px;\n  padding: 4px 2px;\n  border-bottom: 1px dotted var(--h84-muted);\n  word-break: break-word;\n}\n.h84-term {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n  border: 1.5px solid var(--h84-fg);\n  padding: 6px;\n}\n.h84-term-out {\n  flex: 1;\n  min-height: 0;\n  overflow-y: auto;\n  margin-bottom: 5px;\n}\n.h84-term-line {\n  margin: 0 0 4px;\n  font: inherit;\n  font-size: 11px;\n  line-height: 1.4;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n.h84-term-line.is-cmd {\n  font-weight: 700;\n}\n.h84-term-line.is-sys {\n  opacity: 0.78;\n  font-size: 10px;\n}\n.h84-term-in {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  border-top: 1px dotted currentColor;\n  padding-top: 4px;\n}\n.h84-term-prompt {\n  font-weight: 700;\n  font-size: 11px;\n}\n.h84-term-input {\n  flex: 1;\n  min-width: 0;\n  border: none;\n  background: transparent;\n  color: inherit;\n  font-size: 11px;\n  outline: none;\n}\n.h84-notepad {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n}\n.h84-notepad-area {\n  flex: 1;\n  width: 100%;\n  resize: none;\n  border: 1.5px solid var(--h84-fg);\n  background-color: var(--h84-bg);\n  background-image:\n    repeating-linear-gradient(\n      180deg,\n      transparent 0 18px,\n      rgba(128, 128, 128, 0.22) 18px 19px);\n  background-attachment: local;\n  padding: 4px 6px;\n  font-size: 11px;\n  line-height: 19px;\n  outline: none;\n}\n.h84-notepad-footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-top: 5px;\n}\n.h84-dogear {\n  width: 24px;\n  height: 19px;\n  border: 1.5px solid var(--h84-fg);\n  background:\n    linear-gradient(\n      135deg,\n      var(--h84-surface) 47%,\n      var(--h84-fg) 48%,\n      var(--h84-fg) 53%,\n      var(--h84-bg) 54%);\n  cursor: pointer;\n}\n.h84-dogear:hover {\n  background:\n    linear-gradient(\n      135deg,\n      var(--h84-invert-bg) 47%,\n      var(--h84-fg) 48%,\n      var(--h84-fg) 53%,\n      var(--h84-bg) 54%);\n}\n.h84-notepad-nav {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 11px;\n  font-weight: 700;\n}\n.h84-floppy {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n}\n.h84-floppy-head {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  margin-bottom: 6px;\n  font-size: 11px;\n}\n.h84-floppy-preview {\n  flex: 1;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  overflow: auto;\n  padding: 6px;\n  display: flex;\n  align-items: flex-start;\n  justify-content: center;\n}\n.h84-floppy-empty {\n  font-size: 11px;\n  color: var(--h84-muted);\n  margin: auto;\n  text-align: center;\n}\n.h84-floppy-canvas {\n  max-width: 100%;\n  height: auto;\n  border: 1px solid var(--h84-fg);\n}\n.h84-alarm {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.h84-alarm-face {\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n  padding: 8px;\n  text-align: center;\n}\n.h84-alarm-clock {\n  font-size: 11px;\n  color: var(--h84-muted);\n}\n.h84-alarm-countdown {\n  font-size: 26px;\n  font-weight: 700;\n  letter-spacing: 0.08em;\n}\n.h84-alarm-label {\n  font-size: 10px;\n}\n.h84-alarm-watches {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  padding-top: 2px;\n}\n.h84-paint {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n}\n.h84-paint-stage {\n  flex: 1;\n  border: 1.5px solid var(--h84-fg);\n  overflow: hidden;\n  background: var(--h84-bg);\n}\n.h84-paint-canvas {\n  width: 100%;\n  height: 100%;\n  display: block;\n  cursor: crosshair;\n  touch-action: none;\n}\n.h84-mine {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 6px;\n}\n.h84-mine-bar {\n  width: 100%;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.h84-mine-counter {\n  font-weight: 700;\n  padding: 2px 6px;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-bg);\n}\n.h84-mine-grid {\n  display: grid;\n  grid-template-columns: repeat(9, 22px);\n  gap: 1px;\n  border: 1.5px solid var(--h84-fg);\n  background: var(--h84-fg);\n}\n.h84-mine-cell {\n  width: 22px;\n  height: 22px;\n  padding: 0;\n  border: none;\n  background: var(--h84-surface);\n  font-size: 11px;\n  font-weight: 700;\n  cursor: pointer;\n}\n.h84-mine-cell.is-open {\n  background: var(--h84-bg);\n}\n.h84-mine-cell.is-mine {\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n}\n.h84-mine-hint {\n  font-size: 10px;\n  color: var(--h84-muted);\n}\n.h84-toast {\n  position: absolute;\n  left: 50%;\n  bottom: 10px;\n  transform: translateX(-50%);\n  background: var(--h84-invert-bg);\n  color: var(--h84-invert-fg);\n  padding: 3px 10px;\n  font-size: 11px;\n  font-weight: 700;\n  border: 1px solid var(--h84-fg);\n  z-index: 400;\n  white-space: nowrap;\n}\n.h84-toast[hidden] {\n  display: none;\n}\n.h84-alert-modal {\n  position: absolute;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.25);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 450;\n}\n.h84-alert-modal[hidden] {\n  display: none;\n}\n.h84-alert-box {\n  width: 300px;\n  background: var(--h84-surface);\n  border: 2px solid var(--h84-fg);\n  box-shadow: 4px 4px 0 var(--h84-fg);\n  padding: 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  align-items: flex-start;\n}\n.h84-alert-body p {\n  margin: 4px 0 0;\n  font-size: 11px;\n}\n.h84-boot-overlay {\n  position: absolute;\n  inset: 0;\n  background: var(--h84-bg);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 500;\n}\n.h84-boot-overlay[hidden] {\n  display: none;\n}\n.h84-boot-inner {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 10px;\n}\n.h84-hello-svg {\n  width: 224px;\n  height: auto;\n  color: var(--h84-fg);\n}\n.h84-hello-path {\n  stroke-dasharray: 640;\n  stroke-dashoffset: 640;\n  animation: h84-draw 1.4s ease forwards;\n}\n.h84-hello-dot {\n  opacity: 0;\n  animation: h84-dot 0.25s ease 1.3s forwards;\n}\n@keyframes h84-draw {\n  to {\n    stroke-dashoffset: 0;\n  }\n}\n@keyframes h84-dot {\n  to {\n    opacity: 1;\n  }\n}\n.h84-boot-sub {\n  font-size: 11px;\n  font-weight: 700;\n  letter-spacing: 0.04em;\n}\n.h84-chassis-chin {\n  margin-top: 11px;\n  padding-top: 8px;\n  border-top: 1px solid rgba(51, 45, 34, 0.2);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.h84-chin-left,\n.h84-chin-right {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.h84-chin-name {\n  font-size: 12px;\n  font-weight: 700;\n  color: #3a3428;\n  letter-spacing: 0.04em;\n}\n.h84-mode-label {\n  font-size: 10px;\n  color: #5a5141;\n}\n.h84-floppy-drive {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n.h84-floppy-bevel {\n  width: 98px;\n  height: 10px;\n  border-radius: 2px;\n  background: #352f24;\n  box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.55);\n}\n');
          const snapshot = (v) => v;
          const absent = () => void 0;
          const noChat = (select) => select(void 0);
          ctx.inject?.(["uiSession", "sessions", "workspaces"], (scope) => {
            scope.effect(() => {
              const sessionsStore = scope.get("sessions")?.list;
              const workspacesStore = scope.get("workspaces")?.list;
              const statusesStore = scope.get("uiSession")?.sessionStatus;
              if (!sessionsStore || !workspacesStore || !statusesStore) return;
              function syncCatalog() {
                const list = sessionsStore.getSnapshot();
                const workspaces = workspacesStore.getSnapshot();
                const statuses = statusesStore.getSnapshot();
                const rows = normalizeSessions(list, workspaces, statuses);
                bridge.update({ sessions: rows });
              }
              const releases = [sessionsStore, workspacesStore, statusesStore].map((s) => s.subscribe(syncCatalog));
              syncCatalog();
              return () => {
                for (const r of releases) r();
              };
            });
          });
          function HeaderObserver({ sessionId, useSession, useSessions, useWorkspaces, useSessionStatus, useChat, useProjection }) {
            const state = useSession(selectSessionState) ?? "unknown";
            const catalog = useSessions(snapshot);
            const workspaces = useWorkspaces(snapshot);
            const statuses = useSessionStatus(snapshot);
            const legacy = useChat((c) => c?.legacy);
            const activity = useChat(selectActivity) ?? "busy";
            const endedInError = useChat(selectFailedEnding);
            const canRetry = useProjection?.("conversationContinuation", (v) => v != null) ?? false;
            const waiting = Boolean(statuses?.get?.(sessionId)?.pendingInteraction);
            const status = waiting ? "waiting" : state === "busy" ? activity : endedInError || canRetry ? "error" : state === "unknown" ? "idle" : state;
            const row = catalog?.byId?.[sessionId];
            const title = row?.title || row?.displayTitle || "";
            const sessions = React.useMemo(() => normalizeSessions(catalog, workspaces, statuses), [catalog, workspaces, statuses]);
            React.useLayoutEffect(() => {
              bridge.setLegacy(legacy);
              bridge.update({
                status,
                sessionId,
                sessionTitle: title,
                ...sessions.length ? { sessions } : {}
              });
            }, [status, sessionId, title, legacy, sessions]);
            return null;
          }
          function UtilitySlot(props) {
            const hasChat = typeof props.useChat === "function";
            const hasCatalog = Boolean(props.useSessions && props.useWorkspaces);
            if (!props.sessionId) return null;
            return React.createElement(HeaderObserver, {
              ...props,
              key: `${hasChat}:${hasCatalog}:${props.sessionId}`,
              useChat: hasChat ? props.useChat : noChat,
              useSessions: hasCatalog ? props.useSessions : absent,
              useWorkspaces: hasCatalog ? props.useWorkspaces : absent
            });
          }
          function InputObserver({ useInput, inputActions }) {
            const draft = useInput?.((s) => s?.draft) ?? "";
            const latestDraft = React.useRef(draft);
            latestDraft.current = draft;
            React.useLayoutEffect(() => {
              if (!inputActions) return;
              bridge.setInputController({
                getDraft: () => latestDraft.current,
                captureInsertion: inputActions.captureInsertion,
                insertText: inputActions.insertText
              });
              return () => bridge.setInputController(null);
            }, [inputActions]);
            return null;
          }
          function HeroObserver({ hero, children }) {
            React.useLayoutEffect(() => {
              if (hero) bridge.update({ status: "idle", sessionId: null, sessionTitle: "\u4E3B\u754C\u9762" });
            }, [hero]);
            return children ?? null;
          }
          ctx.slots.inject(UTILITIES, () => ctx.slots.register({ name: UTILITIES, id: "hello84-observer" }, UtilitySlot));
          ctx.slots.inject(INPUT_LEFT, () => ctx.slots.register({ name: INPUT_LEFT, id: "hello84-input" }, InputObserver));
          ctx.slots.inject(FRAME, () => ctx.slots.register({ name: FRAME, id: "hello84-hero" }, HeroObserver));
          ctx.effect(() => () => {
            widget.destroy();
          });
        }
      };
    }
  });
})();
