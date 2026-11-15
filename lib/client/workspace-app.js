/**
 * FAUCHAR Workspace — local preview application.
 *
 * Cases and scans are stored only in this browser (IndexedDB). STL files are
 * parsed and validated locally in a Web Worker. Manual design tools (lib/client/cad)
 * edit real geometry in the browser. AI analysis is not implemented in this build;
 * the "Play demo" walkthrough is labelled as illustrative.
 *
 * Named projects are also mirrored to the MySQL-backed API when the user is signed in.
 */
import { createProject, listProjects } from "@/lib/api";
import { CadEditor } from "./cad/editor.js";
import { TOOLS as CAD_TOOLS } from "./cad/panel.js";
import { mountDentalSession } from "./cad/session.js";
import { mountCaseIntake } from "./case-intake.js";

export function initWorkspaceApp() {
  if (typeof document === "undefined") return;
  if (document.documentElement.dataset.faucharWorkspace === "1") return;
  document.documentElement.dataset.faucharWorkspace = "1";
  "use strict";

  /* ================================================================ utils */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (name, cls = "") => `<svg class="ico ${cls}" aria-hidden="true"><use href="#w-${name}"/></svg>`;
  const nf = new Intl.NumberFormat("en-US");
  const fmtNum = (n) => nf.format(n);
  const fmtBytes = (b) => {
    if (!b && b !== 0) return "—";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) {
      b /= 1024;
      i++;
    }
    return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
  };
  const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtDate = (t) => (t ? dateFmt.format(new Date(t)) : "—");
  const relTime = (t) => {
    if (!t) return "—";
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return "Just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d} d ago`;
    return fmtDate(t).split(",")[0];
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /* ========================================================= dental data */

  const TOOTH_NAMES = { 1: "central incisor", 2: "lateral incisor", 3: "canine", 4: "first premolar", 5: "second premolar", 6: "first molar", 7: "second molar", 8: "third molar" };
  const QUAD = { 1: ["Upper", "right"], 2: ["Upper", "left"], 3: ["Lower", "left"], 4: ["Lower", "right"] };
  const toothName = (n) => {
    const q = QUAD[Math.floor(n / 10)];
    return q ? `${q[0]} ${q[1]} ${TOOTH_NAMES[n % 10]}` : "—";
  };
  const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  const archOf = (n) => (n < 30 ? "upper" : "lower");
  const RESTORATION = { crown: "Single crown", bridge: "Bridge" };
  const STATUS = {
    draft: { label: "Scan uploaded", cls: "status-draft" },
    review: { label: "Scan review", cls: "status-review" },
    ready: { label: "Ready for design", cls: "status-ready" },
    archived: { label: "Archived", cls: "status-archived" },
  };
  const JAW = { lower: { label: "Lower jaw", color: "#c9c2b3" }, upper: { label: "Upper jaw", color: "#aeb9bf" }, restoration: { label: "Restoration", color: "#f4f1ea" },
    preop: { label: "Pre-op reference", color: "#93a6cc" }, gingiva: { label: "Gingiva reference", color: "#c896a8" }, bite: { label: "Bite reference", color: "#acbb97" } };
  const MAX_FILE = 250 * 1024 * 1024;

  /** Demo-only pipeline stages — illustrative mock, not real AI results. */
  const MOCK_STAGES = [
    { id: "scan", label: "Scan", running: "Validating scans…", done: "Scans ready" },
    { id: "analysis", label: "Analysis", running: "Segmenting teeth and gingiva…", done: "14 regions · gingiva separated" },
    { id: "prep", label: "Preparation detection", running: "Locating preparation geometry…", done: "Prepared tooth detected" },
    { id: "margin", label: "Margin review", running: "Proposing margin line…", done: "96-point margin · 92% confidence" },
    { id: "design", label: "Restoration design", running: "Generating crown proposal…", done: "Anatomic proposal ready" },
    { id: "review", label: "Final review", running: "Checking contacts and occlusion…", done: "Contacts & occlusion mapped" },
    { id: "export", label: "Export", running: "Packaging restoration file…", done: "Export package ready" },
  ];

  const mockStageOf = (c) => Math.max(0, Math.min(MOCK_STAGES.length - 1, Number(c?.mock?.stage ?? 0)));
  const mockReached = (c, stageId) => mockStageOf(c) >= MOCK_STAGES.findIndex((s) => s.id === stageId);

  function buildMockResult(c) {
    const tooth = c.teeth?.[0] || 22;
    return {
      stage: 0,
      demo: true,
      analysis: { regions: 14, gingiva: "Separated", confidence: "94%" },
      prep: { tooth, type: "Chamfer", height: "1.2 mm" },
      margin: { points: 96, confidence: "92%", position: "Equigingival" },
      design: {
        material: "Zirconia",
        cementGap: "40 µm",
        minThickness: "0.50 mm",
        mesial: "0.04 mm",
        distal: "0.03 mm",
        clearance: "0.80 mm",
      },
    };
  }

  const MOCK_COPY = [
    {
      title: "Scan intake",
      line: "Upper and lower jaw STLs from case 00506-003 are in the workspace.",
      accent: "Scan ready",
    },
    {
      title: "AI scan analysis",
      line: "Reading arch anatomy — teeth vs gingiva, mesh topology, alignment…",
      accent: "Segmentation",
    },
    {
      title: "Preparation detection",
      line: "Focusing on tooth 22 — locating the prep, finish line, and insertion axis…",
      accent: "Prep · 22",
    },
    {
      title: "Margin proposal",
      line: "Tracing a continuous margin around the preparation for crown 22…",
      accent: "Margin line",
    },
    {
      title: "Crown design",
      line: "Revealing the CAD crown proposal seated on the preparation…",
      accent: "Design reveal",
    },
    {
      title: "Clinical review",
      line: "Checking proximal contacts and occlusal clearance against the antagonist…",
      accent: "QC maps",
    },
    {
      title: "Export package",
      line: "Packaging crown 22 for lab hand-off — demo walkthrough complete.",
      accent: "Ready to export",
    },
  ];

  const teethLabel = (c) => {
    if (!c.teeth || !c.teeth.length) return "—";
    return c.teeth.length === 1 ? String(c.teeth[0]) : `${c.teeth[0]}–${c.teeth[c.teeth.length - 1]}`;
  };

  /* ===================================================== sample case */

  const SAMPLE = {
    id: "DEMO-22",
    sample: true,
    name: "Demo case · Crown 22",
    project: "FAUCHAR demo",
    patientRef: "00506-003",
    restoration: "crown",
    teeth: [22],
    notes: "Real scan walkthrough for FAUCHAR demo. Upper + lower jaws and CAD crown 22.",
    status: "ready",
    upAxis: "z",
    mock: null,
    seg: null,
    segInputUrl: "/assets/sample/demo-seg-input.png",
    files: [
      { id: "demo-lower", jaw: "lower", name: "demo-lower.stl", url: "/assets/sample/demo-lower.stl", size: 6728634 },
      { id: "demo-upper", jaw: "upper", name: "demo-upper.stl", url: "/assets/sample/demo-upper.stl", size: 17456234 },
      { id: "demo-crown", jaw: "restoration", name: "demo-crown-22.stl", url: "/assets/sample/demo-crown-22.stl", size: 1080784 },
    ],
  };

  /* ============================================================ storage */

  const store = (() => {
    const mem = { cases: new Map(), files: new Map(), activity: new Map(), meta: new Map() };
    let db = null;
    let persistentOK = true;
    let auto = 1;

    const open = () =>
      new Promise((resolve) => {
        if (!("indexedDB" in window)) {
          persistentOK = false;
          resolve();
          return;
        }
        const req = indexedDB.open("fauchar-workspace", 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore("cases", { keyPath: "id" });
          d.createObjectStore("files", { keyPath: "id" });
          d.createObjectStore("activity", { keyPath: "id", autoIncrement: true });
          d.createObjectStore("meta", { keyPath: "key" });
        };
        req.onsuccess = () => {
          db = req.result;
          resolve();
        };
        req.onerror = () => {
          persistentOK = false;
          resolve();
        };
      });

    const tx = (name, mode, fn) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(name, mode);
        const s = t.objectStore(name);
        const r = fn(s);
        t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("Storage transaction aborted"));
      });

    return {
      open,
      get persistent() {
        return persistentOK;
      },
      async all(name) {
        if (!db) return [...mem[name].values()];
        return tx(name, "readonly", (s) => s.getAll());
      },
      async get(name, key) {
        if (!db) return mem[name].get(key);
        return tx(name, "readonly", (s) => s.get(key));
      },
      async put(name, value) {
        if (!db) {
          if (name === "activity" && value.id == null) value.id = auto++;
          mem[name].set(value.id ?? value.key, value);
          return;
        }
        return tx(name, "readwrite", (s) => s.put(value));
      },
      async putCaseBundle(c, files) {
        if (!db) {
          files.forEach(file => mem.files.set(file.id, file));
          mem.cases.set(c.id, c);
          return;
        }
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(["cases", "files"], "readwrite");
          try {
            files.forEach(file => transaction.objectStore("files").put(file));
            transaction.objectStore("cases").put(c);
          } catch (error) { transaction.abort(); reject(error); return; }
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error("Could not save the job and its scans."));
        });
      },
      async del(name, key) {
        if (!db) return void mem[name].delete(key);
        return tx(name, "readwrite", (s) => s.delete(key));
      },
      async clearAll() {
        if (!db) return Object.values(mem).forEach((m) => m.clear());
        for (const n of ["cases", "files", "activity", "meta"]) await tx(n, "readwrite", (s) => s.clear());
      },
    };
  })();

  const state = { cases: [], activity: [], meta: {}, loaded: false };

  async function loadData() {
    const [cases, activity, meta] = await Promise.all([store.all("cases"), store.all("activity"), store.all("meta")]);
    state.cases = cases;
    state.activity = activity.sort((a, b) => b.time - a.time);
    state.meta = Object.fromEntries(meta.map((m) => [m.key, m.value]));
    if (state.meta.showSample === undefined) state.meta.showSample = true;
    state.loaded = true;
    refreshChrome();
  }

  async function setMeta(key, value) {
    state.meta[key] = value;
    await store.put("meta", { key, value });
  }

  async function logActivity(type, text, caseId) {
    const entry = { type, text, caseId, time: Date.now(), read: false };
    try {
      const key = await store.put("activity", entry);
      if (key != null) entry.id = key;
    } catch (e) {
      /* activity is best-effort */
    }
    state.activity.unshift(entry);
    refreshChrome();
  }

  async function nextCaseId() {
    const year = new Date().getFullYear();
    const seq = (state.meta.seq || 0) + 1;
    await setMeta("seq", seq);
    return `FC-${year}-${String(seq).padStart(4, "0")}`;
  }

  const realCases = () => state.cases.filter((c) => c.status !== "archived");
  const sampleVisible = () => state.meta.showSample !== false;
  const findCase = (id) => (id === SAMPLE.id ? SAMPLE : state.cases.find((c) => c.id === id));

  /* ============================================================ worker */

  let worker = null;
  const jobs = new Map();
  function parseSTL(buffer, name, onProgress) {
    if (!worker) {
      try {
        worker = new Worker("/stl-worker.js");
        worker.onmessage = (e) => {
          const job = jobs.get(e.data.id);
          if (!job) return;
          if (e.data.type === "progress") job.onProgress && job.onProgress(e.data.value);
          else {
            jobs.delete(e.data.id);
            if (e.data.type === "done") job.resolve({ mesh: e.data.mesh, stats: e.data.stats });
            else job.reject(new Error(e.data.message));
          }
        };
        worker.onerror = (e) => {
          jobs.forEach((j) => j.reject(new Error(e.message || "The STL processing worker failed.")));
          jobs.clear();
          worker = null;
        };
      } catch (e) {
        return Promise.reject(new Error("Your browser blocked the local STL processing worker."));
      }
    }
    const id = uid();
    return new Promise((resolve, reject) => {
      jobs.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, buffer, name }, [buffer]);
    });
  }

  function readFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("The file could not be read."));
      fr.readAsArrayBuffer(file);
    });
  }

  /* ============================================================= chrome */

  const view = $("#view");
  if (!view) {
    console.error("FAUCHAR workspace: #view missing");
    return;
  }

  function toast(text, kind = "ok") {
    const host = $("#toasts");
    if (!host) return;
    const el = document.createElement("div");
    el.className = `toast ${kind === "error" ? "is-error" : kind === "warn" ? "is-warn" : ""}`;
    el.innerHTML = `${icon(kind === "error" ? "alert" : kind === "warn" ? "info" : "check")}<span>${esc(text)}</span>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function confirmDialog({ title, body, ok = "Confirm", danger = true, typed = null }) {
    const d = $("#confirm-dialog");
    $("#confirm-title").textContent = title;
    $("#confirm-body").textContent = body;
    const okBtn = $("#confirm-ok");
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
    const wrap = $("#confirm-type-wrap");
    const input = $("#confirm-type");
    wrap.hidden = !typed;
    input.value = "";
    if (typed) {
      $("#confirm-type-label").textContent = `Type ${typed} to confirm`;
      okBtn.disabled = true;
      input.oninput = () => (okBtn.disabled = input.value.trim() !== typed);
    } else okBtn.disabled = false;
    return new Promise((resolve) => {
      d.onclose = () => resolve(d.returnValue === "ok");
      d.returnValue = "";
      d.showModal();
      (typed ? input : okBtn).focus();
    });
  }

  async function refreshChrome() {
    const unread = state.activity.filter((a) => !a.read).length;
    const count = $("#notif-count");
    if (count) {
      count.hidden = !unread;
      count.textContent = unread > 9 ? "9+" : String(unread);
    }
    const list = $("#notif-list");
    if (list) {
      const items = state.activity.slice(0, 12);
      list.innerHTML = items.length
        ? items.map((a) => `<li class="${a.read ? "" : "is-unread"}"><span class="dot"></span><div><p>${esc(a.text)}</p><time datetime="${new Date(a.time).toISOString()}">${relTime(a.time)}</time></div></li>`).join("")
        : `<li class="notif-empty">No notifications yet. Case activity in this workspace will appear here.</li>`;
    }
    const archived = state.cases.filter((c) => c.status === "archived").length;
    const archivedEl = $("#count-archived");
    if (archivedEl) archivedEl.textContent = archived || "";
    const storageText = $("#storage-text");
    const storageBar = $("#storage-bar");
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        if (storageText) storageText.textContent = `${fmtBytes(usage)} of ${fmtBytes(quota)}`;
        if (storageBar) storageBar.style.width = `${quota ? Math.min(100, (usage / quota) * 100).toFixed(1) : 0}%`;
      } catch (e) {
        if (storageText) storageText.textContent = "Unavailable";
      }
    } else if (storageText) storageText.textContent = "Unavailable";
  }

  // Menus
  function bindMenu(buttonId, menuId) {
    const btn = $(`#${buttonId}`);
    const menu = $(`#${menuId}`);
    if (!btn || !menu) return () => {};
    const close = () => {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) {
        const first = menu.querySelector(".menu-item:not([aria-disabled='true']), button");
        if (first) first.focus();
      }
    });
    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".menu-item");
      if (item && item.getAttribute("aria-disabled") === "true") {
        e.preventDefault();
        return;
      }
      if (item) close();
    });
    menu.addEventListener("keydown", (e) => {
      const items = $$(".menu-item:not([aria-disabled='true']), .link-btn", menu);
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(i + 1) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length]?.focus();
      }
    });
    return close;
  }
  const menuClosers = [bindMenu("ws-button", "ws-menu"), bindMenu("notif-button", "notif-panel"), bindMenu("user-button", "user-menu")];
  const closeMenus = () => menuClosers.forEach((c) => c());
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-wrap")) closeMenus();
  });

  $("#notif-read")?.addEventListener("click", async () => {
    for (const a of state.activity) {
      if (!a.read) {
        a.read = true;
        try {
          await store.put("activity", a);
        } catch (e) {
          /* best-effort */
        }
      }
    }
    refreshChrome();
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action='shortcuts']");
    if (t) $("#shortcuts-dialog").showModal();
  });

  // Sidebar (tablet overlay)
  const sidebarToggle = $("#sidebar-toggle");
  sidebarToggle?.addEventListener("click", () => {
    const open = sidebarToggle.getAttribute("aria-expanded") !== "true";
    sidebarToggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("side-open", open);
  });

  /* ============================================================= router */

  const BASE = "/workspace";
  let ready = false;
  let current = null;
  let leaveGuard = null;
  let lastPath = workspacePath();

  function workspacePath() {
    const raw = location.pathname.replace(/\/+$/, "") || BASE;
    let path = raw.startsWith(BASE) ? raw.slice(BASE.length) || "/" : "/";
    if (!path.startsWith("/")) path = `/${path}`;
    return path === "/" ? "/dashboard" : path;
  }

  function navigate(to, { replace = false } = {}) {
    let url = String(to || BASE);
    if (url.startsWith("#/")) url = `${BASE}${url.slice(1)}`;
    if (url.startsWith("/") && !url.startsWith(BASE)) url = `${BASE}${url}`;
    if (!url.startsWith(BASE)) url = `${BASE}/${url}`;
    if (url === `${BASE}/dashboard` || url.startsWith(`${BASE}/dashboard?`)) {
      url = url.replace(`${BASE}/dashboard`, BASE);
    }
    const next = url;
    if (replace) history.replaceState(null, "", next);
    else if (`${location.pathname}${location.search}` !== next) history.pushState(null, "", next);
    route();
  }

  const routes = [
    [/^\/dashboard$/, () => renderDashboard()],
    [/^\/projects$/, () => renderProjects()],
    [/^\/cases\/new$/, () => renderNewCase()],
    [/^\/cases$/, () => {
      const project = new URLSearchParams(location.search).get("project");
      return renderCases(project);
    }],
    [/^\/case\/([\w-]+)$/, (m) => renderCase(m[1])],
    [/^\/recent$/, () => renderRecent()],
    [/^\/designs$/, () => renderDesigns()],
    [/^\/shared$/, () => renderShared()],
    [/^\/archived$/, () => renderArchived()],
    [/^\/library$/, () => renderLibrary()],
    [/^\/activity$/, () => renderActivity()],
    [/^\/settings$/, () => renderSettings()],
  ];

  const NAV_KEY = {
    dashboard: /^\/dashboard$/,
    projects: /^\/projects/,
    cases: /^\/cases$|^\/case\//,
    new: /^\/cases\/new$/,
    recent: /^\/recent/,
    designs: /^\/designs/,
    shared: /^\/shared/,
    archived: /^\/archived/,
    library: /^\/library/,
    activity: /^\/activity/,
  };

  async function route() {
    if (!ready) return;
    const path = workspacePath();
    if (leaveGuard && path !== lastPath) {
      const ok = await leaveGuard();
      if (!ok) {
        const back = lastPath === "/dashboard" ? BASE : `${BASE}${lastPath}`;
        history.replaceState(null, "", back);
        return;
      }
    }
    leaveGuard = null;
    lastPath = path;
    if (current && current.dispose) current.dispose();
    current = null;
    document.documentElement.toggleAttribute("data-dental-session", /^\/case\//.test(path));
    closeMenus();
    document.body.classList.remove("side-open");
    sidebarToggle?.setAttribute("aria-expanded", "false");

    $$("[data-nav]").forEach((a) => {
      const key = a.dataset.nav;
      let on = NAV_KEY[key] && NAV_KEY[key].test(path);
      if (key === "cases" && /^\/cases\/new$/.test(path)) on = false;
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });

    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) {
        current = (await fn(m)) || null;
        view.scrollTop = 0;
        return;
      }
    }
    view.innerHTML = `<div class="page">${emptyState("alert", "Page not found", "This workspace page does not exist.", `<a class="btn" href="/workspace">Go to dashboard</a>`)}</div>`;
  }

  window.addEventListener("popstate", () => {
    if (location.pathname.startsWith(BASE)) route();
  });

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("http")) return;
    if (href.startsWith("/workspace") || href.startsWith("#/")) {
      e.preventDefault();
      navigate(href);
    }
  });

  /* ======================================================== components */

  function emptyState(ic, title, text, action = "") {
    return `<div class="empty">${icon(ic, "ico-lg")}<h3>${esc(title)}</h3><p>${text}</p>${action}</div>`;
  }

  function statusBadge(c) {
    if (c.sample) return `<span class="badge badge-sample">Demo</span>`;
    const s = STATUS[c.status] || STATUS.draft;
    return `<span class="badge ${s.cls}">${s.label}</span>`;
  }

  function jawChips(c) {
    return (c.files || [])
      .filter((f) => f.jaw !== "restoration")
      .map((f) => `<span class="jaw-chip" title="${esc(f.name)}">${f.jaw === "upper" ? "Upper" : f.jaw === "lower" ? "Lower" : "Other"}</span>`)
      .join("") || `<span class="muted">—</span>`;
  }

  function skeletonRows(n = 4) {
    return Array.from({ length: n }, () => `<tr>${Array.from({ length: 7 }, (_, i) => `<td><span class="skel" style="width:${[70, 50, 30, 40, 45, 50, 20][i]}%"></span></td>`).join("")}</tr>`).join("");
  }

  /**
   * Professional case table with search, status filter and sortable columns.
   * Returns { html, bind(root) }.
   */
  function caseTable(cases, { search = true, filters = true, archived = false, limit = null, emptyHtml = "", includeSample = false } = {}) {
    const st = { q: "", status: "all", sort: "modified", dir: "desc" };
    const tableId = `t-${uid().slice(0, 6)}`;

    const rows = () => {
      let list = cases.slice();
      if (includeSample && sampleVisible()) list.push(SAMPLE);
      if (st.q) {
        const q = st.q.toLowerCase();
        list = list.filter((c) => [c.name, c.id, c.project, c.patientRef, teethLabel(c)].some((v) => String(v || "").toLowerCase().includes(q)));
      }
      if (st.status !== "all") list = list.filter((c) => c.status === st.status && !c.sample);
      const key = {
        case: (c) => c.name.toLowerCase(),
        type: (c) => c.restoration,
        tooth: (c) => (c.teeth || [0])[0],
        modified: (c) => (c.sample ? -1 : c.modified || 0),
        status: (c) => c.status,
      }[st.sort];
      list.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return (x > y ? 1 : x < y ? -1 : 0) * (st.dir === "asc" ? 1 : -1);
      });
      if (limit) list = list.slice(0, limit);
      return list;
    };

    const th = (k, label, cls = "") => {
      const sort = st.sort === k ? ` aria-sort="${st.dir === "asc" ? "ascending" : "descending"}"` : "";
      return `<th class="${cls}"${sort}><button type="button" data-sort="${k}">${label}${icon("chevron")}</button></th>`;
    };

    const rowHtml = (c) => `<tr>
      <td data-col="case"><div class="case-cell"><a href="/workspace/case/${esc(c.id)}">${esc(c.name)}</a><span class="case-id">${esc(c.sample ? "Demo geometry · not patient data" : c.id)}</span></div></td>
      <td data-col="type" data-label="Type">${RESTORATION[c.restoration] || "—"}</td>
      <td data-col="tooth" data-label="Tooth"><span class="tooth-chip" title="${esc((c.teeth || []).map(toothName).join(", "))}">${teethLabel(c)}</span></td>
      <td data-col="files" data-label="Scans"><div class="files-cell">${jawChips(c)}</div></td>
      <td data-col="modified" data-label="Modified" class="muted" title="${c.sample ? "" : esc(fmtDate(c.modified))}">${c.sample ? "—" : relTime(c.modified)}</td>
      <td data-col="status">${statusBadge(c)}</td>
      <td data-col="actions"><div class="row-actions">
        <a class="icon-btn" href="/workspace/case/${esc(c.id)}" data-tip="Open in workspace" data-tip-pos="left" aria-label="Open ${esc(c.name)}">${icon("chevron-right")}</a>
        ${c.sample ? "" : archived
          ? `<button class="icon-btn" type="button" data-act="restore" data-id="${esc(c.id)}" data-tip="Restore" data-tip-pos="left" aria-label="Restore ${esc(c.name)}">${icon("restore")}</button>
             <button class="icon-btn" type="button" data-act="delete" data-id="${esc(c.id)}" data-tip="Delete permanently" data-tip-pos="left" aria-label="Delete ${esc(c.name)}">${icon("trash")}</button>`
          : `<button class="icon-btn" type="button" data-act="archive" data-id="${esc(c.id)}" data-tip="Archive" data-tip-pos="left" aria-label="Archive ${esc(c.name)}">${icon("archive")}</button>`}
      </div></td>
    </tr>`;

    const body = () => {
      const list = rows();
      if (!list.length) return `<tr><td colspan="7">${st.q || st.status !== "all" ? emptyState("search", "No matching cases", "Try a different search term or status filter.") : emptyHtml}</td></tr>`;
      return list.map(rowHtml).join("");
    };

    const head = () => `<tr>${th("case", "Case")}${th("type", "Restoration")}${th("tooth", "Tooth")}<th>Scans</th>${th("modified", "Last modified")}${th("status", "Status")}<th><span class="sr-only">Actions</span></th></tr>`;

    const html = `
      ${search || filters ? `<div class="toolbar">
        ${search ? `<label class="search">${icon("search", "ico-sm")}<span class="sr-only">Search cases</span><input type="search" placeholder="Search by case, ID, project or tooth" data-search><kbd>/</kbd></label>` : ""}
        ${filters && !archived ? `<div class="filter-group" role="group" aria-label="Filter by status">
          <button type="button" data-filter="all" aria-pressed="true">All</button>
          <button type="button" data-filter="draft" aria-pressed="false">Scan uploaded</button>
          <button type="button" data-filter="review" aria-pressed="false">Scan review</button>
          <button type="button" data-filter="ready" aria-pressed="false">Ready for design</button>
        </div>` : ""}
        <span class="toolbar-end" data-count></span>
      </div>` : ""}
      <div class="table-wrap"><table class="table" id="${tableId}"><thead>${head()}</thead><tbody>${state.loaded ? body() : skeletonRows()}</tbody></table></div>`;

    const bind = (root) => {
      const table = $(`#${tableId}`, root);
      const update = () => {
        table.tHead.innerHTML = head();
        table.tBodies[0].innerHTML = body();
        const count = $("[data-count]", root);
        if (count) count.textContent = `${rows().filter((c) => !c.sample).length} case${rows().filter((c) => !c.sample).length === 1 ? "" : "s"}`;
      };
      update();
      const input = $("[data-search]", root);
      if (input) input.addEventListener("input", debounce(() => ((st.q = input.value.trim()), update()), 120));
      $$("[data-filter]", root).forEach((b) =>
        b.addEventListener("click", () => {
          st.status = b.dataset.filter;
          $$("[data-filter]", root).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          update();
        })
      );
      table.addEventListener("click", async (e) => {
        const s = e.target.closest("[data-sort]");
        if (s) {
          if (st.sort === s.dataset.sort) st.dir = st.dir === "asc" ? "desc" : "asc";
          else {
            st.sort = s.dataset.sort;
            st.dir = s.dataset.sort === "modified" ? "desc" : "asc";
          }
          update();
          return;
        }
        const a = e.target.closest("[data-act]");
        if (!a) return;
        const c = findCase(a.dataset.id);
        if (!c) return;
        if (a.dataset.act === "archive") await archiveCase(c);
        if (a.dataset.act === "restore") await restoreCase(c);
        if (a.dataset.act === "delete") await deleteCase(c);
        route();
      });
    };
    return { html, bind };
  }

  async function archiveCase(c) {
    const ok = await confirmDialog({ title: `Archive ${c.id}?`, body: `"${c.name}" will move to Archived. Its scans stay in this browser and you can restore it at any time.`, ok: "Archive case", danger: false });
    if (!ok) return false;
    c.prevStatus = c.status;
    c.status = "archived";
    c.modified = Date.now();
    await saveCase(c);
    await logActivity("archived", `${c.id} archived`, c.id);
    toast(`${c.id} archived`);
    return true;
  }

  async function restoreCase(c) {
    c.status = c.prevStatus && c.prevStatus !== "archived" ? c.prevStatus : "draft";
    c.modified = Date.now();
    await saveCase(c);
    await logActivity("restored", `${c.id} restored from archive`, c.id);
    toast(`${c.id} restored`);
  }

  async function deleteCase(c) {
    const ok = await confirmDialog({ title: `Delete ${c.id} permanently?`, body: `"${c.name}" and its ${c.files.length} scan file${c.files.length === 1 ? "" : "s"} will be removed from this browser. This cannot be undone.`, ok: "Delete case", typed: c.id });
    if (!ok) return false;
    try {
      for (const f of c.files) await store.del("files", f.id);
      await store.del("files", `cad:${c.id}`);
      await store.del("cases", c.id);
      state.cases = state.cases.filter((x) => x.id !== c.id);
      await logActivity("deleted", `${c.id} deleted`, c.id);
      toast(`${c.id} deleted`);
      return true;
    } catch (e) {
      toast(`Could not delete ${c.id}: ${e.message}`, "error");
      return false;
    }
  }

  async function saveCase(c) {
    try {
      await store.put("cases", c);
      const i = state.cases.findIndex((x) => x.id === c.id);
      if (i >= 0) state.cases[i] = c;
      else state.cases.push(c);
      void syncNamedProject(c.project, c);
    } catch (e) {
      toast(`Could not save ${c.id}: ${e.message}`, "error");
      throw e;
    }
  }

  async function syncNamedProject(projectName, caseMeta) {
    const name = String(projectName || "").trim();
    if (!name) return;
    try {
      const { projects } = await listProjects();
      const existing = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (existing) return;
      await createProject({
        name,
        description: caseMeta?.name ? `Linked case ${caseMeta.id}` : "",
        status: "active",
        data: {
          source: "workspace",
          caseId: caseMeta?.id || null,
          restoration: caseMeta?.restoration || null,
        },
      });
    } catch {
      /* offline / unauthenticated — local IndexedDB remains source of truth for scans */
    }
  }

  function storageBanner() {
    return store.persistent ? "" : `<div class="banner banner-warn" style="margin-bottom:16px">${icon("alert")}<div><strong>Browser storage is unavailable.</strong> Cases will be kept only until this tab is closed (for example in private browsing).</div></div>`;
  }

  /* ========================================================= dashboard */

  function renderDashboard() {
    const h = new Date().getHours();
    const greet = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const active = realCases();
    const review = active.filter((c) => c.status === "review" || c.status === "draft").length;
    const ready = active.filter((c) => c.status === "ready").length;
    const projects = projectList().slice(0, 5);
    const table = caseTable(active, {
      search: false,
      filters: false,
      limit: 6,
      includeSample: true,
      emptyHtml: emptyState("folder", "No cases yet", "Create your first dental case by uploading upper and lower jaw scans in STL format.", `<a class="btn btn-primary" href="/workspace/cases/new">${icon("plus", "ico-sm")}New dental case</a>`),
    });

    view.innerHTML = `<div class="page">
      ${storageBanner()}
      <header class="welcome">
        <div>
          <p class="crumbs">Local workspace · ${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p>
          <h1 class="page-title">${greet}</h1>
          <p class="page-sub">Manage crown and bridge cases, review STL scans in 3D and track each case through the design workflow.</p>
        </div>
        <div class="page-actions">
          ${sampleVisible() ? `<a class="btn" href="/workspace/case/${SAMPLE.id}">${icon("cube", "ico-sm")}Open demo · Crown 22</a>` : ""}
          <a class="btn btn-primary" href="/workspace/cases/new">${icon("plus", "ico-sm")}New dental case</a>
        </div>
      </header>

      <section class="kpis" aria-label="Case overview">
        <div class="kpi"><p class="kpi-label">Active cases</p><p class="kpi-value">${state.loaded ? active.length : "—"}</p><p class="kpi-note">${ready} ready for design</p></div>
        <div class="kpi"><p class="kpi-label">Awaiting scan review</p><p class="kpi-value">${state.loaded ? review : "—"}</p><p class="kpi-note">Uploaded scans to check in 3D</p></div>
        <div class="kpi"><p class="kpi-label">Draft designs <span class="badge status-ready">Demo</span></p><p class="kpi-value">${state.loaded ? realCases().filter((c) => mockReached(c, "design") && !mockReached(c, "export")).length : "—"}</p><p class="kpi-note">Demo proposals in progress</p></div>
        <div class="kpi"><p class="kpi-label">Completed demos <span class="badge status-ready">Demo</span></p><p class="kpi-value">${state.loaded ? realCases().filter((c) => mockReached(c, "export")).length : "—"}</p><p class="kpi-note">Finished demo pipelines</p></div>
      </section>

      <div class="dash-grid">
        <section class="panel" aria-labelledby="recent-title">
          <div class="panel-head"><h2 class="panel-title" id="recent-title">Recent cases</h2><a class="link-btn" href="/workspace/cases">View all cases</a></div>
          ${table.html}
        </section>
        <div class="stack">
          <section class="panel" aria-labelledby="proc-title">
            <div class="panel-head"><h2 class="panel-title" id="proc-title">Processing status</h2></div>
            <ul class="service-list">
              <li><strong>Local STL processing</strong><span class="badge status-ready">Available</span><p>Parsing, validation and mesh statistics run in your browser.</p></li>
              <li><strong>Automated scan analysis</strong><span class="badge status-ready">Demo</span><p>Open a case and run the demo pipeline to preview segmentation.</p></li>
              <li><strong>Restoration design</strong><span class="badge status-ready">Demo</span><p>Walk through a mock crown proposal in the case workflow.</p></li>
              <li><strong>Cloud sync and sharing</strong><span class="badge badge-planned">Planned</span><p>Account projects save metadata; full case sync is still planned.</p></li>
            </ul>
          </section>
          <section class="panel" aria-labelledby="proj-title">
            <div class="panel-head"><h2 class="panel-title" id="proj-title">Recent projects</h2><a class="link-btn" href="/workspace/projects">All projects</a></div>
            ${projects.length
              ? `<ul class="service-list">${projects.map((p) => `<li><a href="/workspace/cases?project=${encodeURIComponent(p.name)}"><strong>${esc(p.name)}</strong></a><span class="muted">${p.count} case${p.count === 1 ? "" : "s"}</span><p>Last modified ${relTime(p.modified)}</p></li>`).join("")}</ul>`
              : `<div class="panel-body muted">Projects group cases by laboratory, practice or client. Add a project name when you create a case.</div>`}
          </section>
        </div>
      </div>
    </div>`;
    table.bind(view);
  }

  /* ========================================================== projects */

  function projectList() {
    const map = new Map();
    for (const c of realCases()) {
      const name = c.project || "Unassigned";
      const p = map.get(name) || { name, count: 0, crowns: 0, bridges: 0, modified: 0 };
      p.count++;
      if (c.restoration === "bridge") p.bridges++;
      else p.crowns++;
      p.modified = Math.max(p.modified, c.modified || 0);
      map.set(name, p);
    }
    return [...map.values()].sort((a, b) => b.modified - a.modified);
  }

  function renderProjects() {
    const list = projectList();
    view.innerHTML = `<div class="page">
      <header class="page-head"><div><h1 class="page-title">All projects</h1><p class="page-sub">Cases grouped by project — for example a laboratory client or practice reference.</p></div>
      <div class="page-actions"><a class="btn btn-primary" href="/workspace/cases/new">${icon("plus", "ico-sm")}New dental case</a></div></header>
      <section class="panel">
        ${list.length
          ? `<div class="table-wrap"><table class="table"><thead><tr><th>Project</th><th class="num">Cases</th><th class="num">Crowns</th><th class="num">Bridges</th><th>Last modified</th><th><span class="sr-only">Open</span></th></tr></thead><tbody>
            ${list.map((p) => `<tr><td data-col="case"><div class="case-cell"><a href="/workspace/cases?project=${encodeURIComponent(p.name)}">${esc(p.name)}</a></div></td><td class="num">${p.count}</td><td class="num">${p.crowns}</td><td class="num">${p.bridges}</td><td class="muted">${relTime(p.modified)}</td><td><div class="row-actions"><a class="icon-btn" href="/workspace/cases?project=${encodeURIComponent(p.name)}" aria-label="Open ${esc(p.name)}" data-tip="View cases" data-tip-pos="left">${icon("chevron-right")}</a></div></td></tr>`).join("")}
          </tbody></table></div>`
          : emptyState("folder", "No projects yet", "Projects are created automatically from the project name you give a case.", `<a class="btn btn-primary" href="/workspace/cases/new">${icon("plus", "ico-sm")}New dental case</a>`)}
      </section>
    </div>`;
  }

  function renderCases(project) {
    const list = realCases().filter((c) => !project || (c.project || "Unassigned") === project);
    const table = caseTable(list, {
      includeSample: !project,
      emptyHtml: emptyState("folder", project ? "No cases in this project" : "No cases yet", "Upload upper and lower jaw STL scans to create a case.", `<a class="btn btn-primary" href="/workspace/cases/new">${icon("plus", "ico-sm")}New dental case</a>`),
    });
    view.innerHTML = `<div class="page">
      ${storageBanner()}
      <header class="page-head"><div>
        ${project ? `<p class="crumbs"><a href="/workspace/projects">Projects</a>${icon("chevron-right", "ico-sm")}<span>${esc(project)}</span></p>` : ""}
        <h1 class="page-title">${project ? esc(project) : "Cases"}</h1>
        <p class="page-sub">All active crown and bridge cases in this workspace.</p></div>
        <div class="page-actions"><a class="btn btn-primary" href="/workspace/cases/new">${icon("plus", "ico-sm")}New dental case</a></div>
      </header>
      <section class="panel">${table.html}</section>
    </div>`;
    table.bind(view);
  }

  function renderRecent() {
    const list = realCases().sort((a, b) => (b.opened || b.modified) - (a.opened || a.modified)).slice(0, 20);
    const table = caseTable(list, { filters: false, includeSample: true, emptyHtml: emptyState("clock", "No recent cases", "Cases you open or create will appear here.") });
    view.innerHTML = `<div class="page"><header class="page-head"><div><h1 class="page-title">Recent cases</h1><p class="page-sub">The 20 cases you opened or changed most recently.</p></div></header><section class="panel">${table.html}</section></div>`;
    table.bind(view);
  }

  function renderArchived() {
    const list = state.cases.filter((c) => c.status === "archived");
    const table = caseTable(list, { filters: false, archived: true, emptyHtml: emptyState("archive", "No archived cases", "Archived cases keep their scans and can be restored at any time.") });
    view.innerHTML = `<div class="page"><header class="page-head"><div><h1 class="page-title">Archived</h1><p class="page-sub">Cases removed from active work. Restore a case to continue, or delete it permanently.</p></div></header><section class="panel">${table.html}</section></div>`;
    table.bind(view);
  }

  function renderDesigns() {
    const list = realCases().filter((c) => mockReached(c, "design"));
    const table = caseTable(list, {
      filters: false,
      emptyHtml: emptyState(
        "tooth",
        "No demo designs yet",
        "Open a case and click <strong>Run demo pipeline</strong> to walk through a mock restoration proposal.",
        `<a class="btn" href="/workspace/cases">View cases</a>`
      ),
    });
    view.innerHTML = `<div class="page"><header class="page-head"><div><h1 class="page-title">My designs</h1><p class="page-sub">Demo restoration proposals from the walkthrough pipeline. Not clinical AI output.</p></div>
      <div class="page-actions"><a class="btn" href="/workspace/cases">${icon("folder", "ico-sm")}Cases</a></div></header>
      <div class="banner banner-info">${icon("info")}<div><strong>Demo mode.</strong> Designs appear here after you run the demo pipeline on a case.</div></div>
      <section class="panel">${table.html}</section></div>`;
    table.bind(view);
  }

  function renderShared() {
    view.innerHTML = `<div class="page"><header class="page-head"><div><h1 class="page-title">Shared with me</h1><p class="page-sub">Cases other team members share with you.</p></div></header>
      <section class="panel">${emptyState("share", "Sharing needs a FAUCHAR account", "This local workspace keeps everything in your browser, so nothing can be shared yet. Team workspaces and sharing are planned.")}</section></div>`;
  }

  function renderActivity() {
    const list = state.activity;
    view.innerHTML = `<div class="page"><header class="page-head"><div><h1 class="page-title">Activity</h1><p class="page-sub">Everything that happened in this local workspace.</p></div></header>
      <section class="panel">${list.length
        ? `<div class="table-wrap"><table class="table"><thead><tr><th>Event</th><th>Case</th><th>Time</th></tr></thead><tbody>
          ${list.map((a) => `<tr><td>${esc(a.text)}</td><td>${a.caseId && findCase(a.caseId) ? `<a href="/workspace/case/${esc(a.caseId)}" class="case-id">${esc(a.caseId)}</a>` : `<span class="muted">${esc(a.caseId || "—")}</span>`}</td><td class="muted" title="${esc(fmtDate(a.time))}">${relTime(a.time)}</td></tr>`).join("")}
        </tbody></table></div>`
        : emptyState("activity", "No activity yet", "Creating, reviewing, archiving and deleting cases is recorded here.")}</section></div>`;
  }

  function renderLibrary() {
    view.innerHTML = `<div class="page"><header class="page-head"><div><h1 class="page-title">Library</h1><p class="page-sub">Sample scans, supported formats and reference material.</p></div></header>
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2 class="panel-title">Demo scans <small>Real jaw + CAD crown walkthrough</small></h2><a class="btn btn-sm" href="/workspace/case/${SAMPLE.id}">${icon("cube", "ico-sm")}Open demo case</a></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>File</th><th>Content</th><th class="num">Size</th><th><span class="sr-only">Download</span></th></tr></thead><tbody>
            ${SAMPLE.files.map((f) => `<tr><td data-col="case"><div class="case-cell"><span>${esc(f.name)}</span></div></td><td class="muted">${f.jaw === "lower" ? "Lower jaw antagonist scan" : f.jaw === "upper" ? "Upper jaw with prep · tooth 22" : "CAD crown 22"}</td><td class="num">${fmtBytes(f.size)}</td><td><div class="row-actions"><a class="icon-btn" href="${f.url}" download data-tip="Download STL" data-tip-pos="left" aria-label="Download ${esc(f.name)}">${icon("download")}</a></div></td></tr>`).join("")}
          </tbody></table></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2 class="panel-title">Supported formats</h2></div>
          <ul class="service-list">
            <li><strong>STL — binary</strong><span class="badge status-ready">Supported</span><p>Standard output of intraoral and desktop lab scanners.</p></li>
            <li><strong>STL — ASCII</strong><span class="badge status-ready">Supported</span><p>Text STL; larger files, parsed the same way.</p></li>
            <li><strong>PLY with vertex colour</strong><span class="badge badge-planned">Planned</span><p>Colour intraoral scans.</p></li>
            <li><strong>OBJ</strong><span class="badge badge-planned">Planned</span><p></p></li>
          </ul>
        </section>
        <section class="panel">
          <div class="panel-head"><h2 class="panel-title">Tooth numbering</h2></div>
          <div class="panel-body muted">FAUCHAR uses the FDI two-digit notation (ISO 3950). The first digit is the quadrant — 1 upper right, 2 upper left, 3 lower left, 4 lower right — and the second digit the tooth, from 1 (central incisor) to 8 (third molar).</div>
        </section>
      </div></div>`;
  }

  async function renderSettings() {
    let usage = "Unavailable";
    let persisted = null;
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const e = await navigator.storage.estimate();
        usage = `${fmtBytes(e.usage)} used of ${fmtBytes(e.quota)} available`;
        if (navigator.storage.persisted) persisted = await navigator.storage.persisted();
      } catch (err) {
        /* keep defaults */
      }
    }
    view.innerHTML = `<div class="page"><header class="page-head"><div><h1 class="page-title">Workspace settings</h1><p class="page-sub">This workspace is local to this browser on this device.</p></div></header>
      <div class="stack" style="max-width:760px">
        <section class="panel"><div class="panel-head"><h2 class="panel-title">Storage</h2></div>
          <div class="summary"><dl>
            <div><dt>Storage location</dt><dd>${store.persistent ? "IndexedDB (this browser)" : "Memory only — cleared on close"}</dd></div>
            <div><dt>Usage</dt><dd>${usage}</dd></div>
            <div><dt>Cases</dt><dd>${state.cases.length}</dd></div>
            <div><dt>Persistent storage</dt><dd>${persisted === null ? "Not supported" : persisted ? "Granted" : `<button class="btn btn-sm" type="button" id="persist">Request</button>`}</dd></div>
          </dl></div>
        </section>
        <section class="panel"><div class="panel-head"><h2 class="panel-title">Sample case</h2></div>
          <div class="prop-control" style="padding:14px"><span>Show the sample case (demo geometry) in lists and on the dashboard</span>
            <div class="segmented" role="group" aria-label="Show sample case"><button type="button" data-sample="on" aria-pressed="${sampleVisible()}">Show</button><button type="button" data-sample="off" aria-pressed="${!sampleVisible()}">Hide</button></div>
          </div>
        </section>
        <section class="panel" style="border-color:rgba(239,106,106,0.3)"><div class="panel-head"><h2 class="panel-title">Delete local data</h2></div>
          <div class="panel-body" style="display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap"><p class="muted">Remove every case, scan file and activity entry stored by this workspace in this browser.</p><button class="btn btn-danger" type="button" id="wipe">${icon("trash", "ico-sm")}Delete all local data</button></div>
        </section>
      </div></div>`;
    const persistBtn = $("#persist");
    if (persistBtn) persistBtn.addEventListener("click", async () => {
      const ok = await navigator.storage.persist();
      toast(ok ? "Persistent storage granted" : "The browser declined persistent storage", ok ? "ok" : "warn");
      renderSettings();
    });
    $$("[data-sample]").forEach((b) => b.addEventListener("click", async () => {
      await setMeta("showSample", b.dataset.sample === "on");
      renderSettings();
    }));
    $("#wipe").addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Delete all local data?", body: "All cases, scans and activity in this browser will be removed. This cannot be undone.", ok: "Delete everything", typed: "DELETE" });
      if (!ok) return;
      await store.clearAll();
      await loadData();
      toast("All local workspace data deleted");
      navigate("/workspace/dashboard");
    });
  }

  /* ========================================================== new case */

  function renderNewCase() {
    const intake = mountCaseIntake({
      view, uid, readFile, parseSTL, toast, nextCaseId, navigate,
      persistCase: async (c, files) => {
        await store.putCaseBundle(c, files);
        state.cases.push(c);
        void syncNamedProject(c.project, c);
        await logActivity("created", `${c.id} job created`, c.id);
      },
    });
    leaveGuard = async () => {
      const { flow } = intake;
      if (flow.saving) { toast("Please wait for the job to finish saving.", "warn"); return false; }
      if (flow.saved || (!flow.files.length && !flow.job.units.length && !flow.job.name)) return true;
      return confirmDialog({ title: "Discard this new job?", body: "The tooth definitions and scans have not been saved.", ok: "Discard", danger: true });
    };
    return intake;
  }

  /* ========================================================== case view */

  async function renderCase(id) {
    if (!state.loaded) await loadData();
    const c = findCase(id);
    if (!c) {
      view.innerHTML = `<div class="page">${emptyState("alert", "Case not found", "This case does not exist in this browser. It may have been deleted, or created on another device.", `<a class="btn" href="/workspace/cases">View cases</a>`)}</div>`;
      return null;
    }
    if (!c.sample) {
      c.opened = Date.now();
      store.put("cases", c).catch(() => {});
    }

    const scans = c.files.filter((f) => f.jaw !== "restoration");
    const hasUpper = c.files.some((f) => f.jaw === "upper");
    const hasLower = c.files.some((f) => f.jaw === "lower");
    const restorationFile = c.files.find((f) => f.jaw === "restoration");
    const tooth = c.teeth[0];
    if (!c.mock) c.mock = buildMockResult(c);
    const stage = mockStageOf(c);
    const mock = c.mock;
    const mockVal = (ready, value, empty = "—") => (ready ? value : empty);
    const propSec = (label, ready, items, note) => `
      <details class="prop-sec" ${ready ? "open" : ""}><summary>${label}<span class="badge ${ready ? "status-ready" : "badge-planned"}">${ready ? "Demo" : "Planned"}</span>${icon("chevron")}</summary>
        <dl>${items.map(([k, v]) => `<div><dt>${k}</dt><dd class="${v === "—" ? "na" : ""}">${v}</dd></div>`).join("")}</dl>
        <p class="prop-note">${note}</p>
      </details>`;

    const workflowSteps = MOCK_STAGES.map((s, i) => {
      let state = "planned";
      let detail = "Waiting";
      if (i === 0) {
        const scanReady = !!scans.length && (c.sample || c.status === "ready" || stage > 0);
        state = scanReady ? (stage > 0 ? "done" : "current") : scans.length ? "current" : "planned";
        detail = !scans.length ? "No scans" : scanReady ? `${scans.length} file${scans.length === 1 ? "" : "s"} · ready` : `${scans.length} file${scans.length === 1 ? "" : "s"} · review pending`;
      } else if (i < stage) {
        state = "done";
        detail = s.done;
      } else if (i === stage && stage > 0) {
        state = i === MOCK_STAGES.length - 1 ? "done" : "current";
        detail = state === "done" ? s.done : "In progress · demo";
      } else if (i === stage + 1 && stage > 0) {
        state = "current";
        detail = "Next · demo";
      }
      if (c.sample && s.id === "design" && stage < 4) detail = "CAD crown waiting";
      return [s.label, detail, state, s.id, i];
    });
    const statusInfo = c.sample ? null : STATUS[c.status];

    view.innerHTML = `<div class="case-view dental-case">
      <header class="case-head">
        <div style="min-width:0">
          <p class="crumbs"><a href="/workspace/cases">Cases</a>${icon("chevron-right", "ico-sm")}<span>${esc(c.sample ? "Demo · Crown 22" : c.id)}</span></p>
          <h1 class="page-title">${esc(c.name)}</h1>
        </div>
        ${statusBadge(c)}
        <div class="case-head-actions">
          ${c.sample ? "" : c.status === "archived" ? `<button class="btn btn-sm" type="button" id="restore-case">${icon("restore", "ico-sm")}Restore</button>`
            : c.status !== "ready" ? `<button class="btn btn-sm" type="button" id="mark-reviewed" data-tip="Confirm the scans are complete and usable">${icon("check", "ico-sm")}Mark scan reviewed</button>` : ""}
          <button class="btn btn-primary btn-sm" type="button" id="run-seg" data-tip="Find the teeth on the jaw scans and number them (FDI). You can correct every number.">${icon("layers", "ico-sm")}Segmentation</button>
          <button class="btn btn-sm" type="button" id="run-mock" data-tip="Cinematic walkthrough: analysis → crown 22 → export. Illustrative demo, not clinical AI.">${icon("orbit", "ico-sm")}${stage >= MOCK_STAGES.length - 1 ? "Replay demo" : "Play demo"}</button>
          <button class="btn btn-sm" type="button" id="download" data-tip="Download the original STL files">${icon("download", "ico-sm")}Download scans</button>
          ${c.sample ? "" : `<button class="icon-btn" type="button" id="delete-case" data-tip="Delete case" data-tip-pos="left" aria-label="Delete case">${icon("trash")}</button>`}
          <button class="icon-btn props-toggle" type="button" id="props-toggle" aria-controls="props" aria-expanded="false" data-tip="Properties" data-tip-pos="left">${icon("panel")}<span class="sr-only">Toggle properties panel</span></button>
        </div>
      </header>

      <div class="banner banner-info mobile-note">${icon("info")}<div><strong>The 3D workspace is available on tablet and desktop.</strong> On this screen you can review the case details and status.</div></div>
      <div class="cad dental-cad" id="cad">
        <div class="cad-ribbon" id="cad-ribbon" role="toolbar" aria-label="Design tools">
          <div class="cad-ribbon-tools">
            ${CAD_TOOLS.map((t) => `<button type="button" data-cad-tool="${t.id}" aria-pressed="false" data-tip="${esc(t.title)} (${t.key.toUpperCase()})">${t.label}</button>`).join("")}
          </div>
          <div class="cad-ribbon-end">
            <span class="cad-status" id="cad-status" role="status">Loading…</span>
            <button type="button" class="btn btn-sm" data-cad="undo" disabled data-tip="Undo (Ctrl+Z)">Undo</button>
            <button type="button" class="btn btn-sm" data-cad="redo" disabled data-tip="Redo (Ctrl+Shift+Z)">Redo</button>
            <button type="button" class="btn btn-sm btn-primary" data-cad="export" data-tip="Export the edited restoration as STL (Ctrl+E)">Export STL</button>
          </div>
        </div>
        <div class="cad-rail" role="toolbar" aria-label="Viewer tools" aria-orientation="vertical">
          <button class="icon-btn" type="button" data-mode="orbit" aria-pressed="true" data-tip="Rotate · drag" data-tip-pos="right">${icon("orbit")}<span class="sr-only">Rotate</span></button>
          <button class="icon-btn" type="button" data-mode="pan" aria-pressed="false" data-tip="Pan · right-drag" data-tip-pos="right">${icon("pan")}<span class="sr-only">Pan</span></button>
          <button class="icon-btn" type="button" data-mode="zoom" aria-pressed="false" data-tip="Zoom · wheel" data-tip-pos="right">${icon("zoom")}<span class="sr-only">Zoom</span></button>
          <span class="rail-sep" aria-hidden="true"></span>
          <button class="icon-btn" type="button" data-tool="fit" data-tip="Fit to view (F)" data-tip-pos="right">${icon("fit")}<span class="sr-only">Fit to view</span></button>
          <button class="icon-btn" type="button" data-tool="reset" data-tip="Reset camera (R)" data-tip-pos="right">${icon("reset")}<span class="sr-only">Reset camera</span></button>
          <span class="rail-sep" aria-hidden="true"></span>
          <button class="icon-btn" type="button" data-tool="wire" aria-pressed="false" data-tip="Wireframe (W)" data-tip-pos="right">${icon("wire")}<span class="sr-only">Wireframe</span></button>
          <button class="icon-btn" type="button" data-tool="grid" aria-pressed="true" data-tip="Grid (G)" data-tip-pos="right">${icon("grid")}<span class="sr-only">Grid</span></button>
        </div>

        <div class="vp" id="vp">
          <canvas class="gl" id="gl" role="img" aria-label="3D view of the case scans. Drag to rotate, right-drag to pan, scroll to zoom."></canvas>
          <div class="vp-tooth-labels" id="vp-tooth-labels" aria-hidden="true"></div>
          <canvas class="cad-hud" id="cad-hud" aria-hidden="true"></canvas>
          <canvas class="vp-gizmo" id="gizmo" aria-hidden="true"></canvas>
          <div class="cad-legend" id="cad-legend" hidden></div>
          <div class="vp-layers" role="group" aria-label="Visibility">
            ${hasUpper ? `<button class="layer-btn" type="button" data-layer="upper" aria-pressed="true"><span class="swatch" style="background:${JAW.upper.color}"></span>Upper jaw<kbd>1</kbd></button>` : ""}
            ${hasLower ? `<button class="layer-btn" type="button" data-layer="lower" aria-pressed="true"><span class="swatch" style="background:${JAW.lower.color}"></span>Lower jaw<kbd>2</kbd></button>` : ""}
            ${restorationFile ? `<button class="layer-btn" type="button" data-layer="restoration" aria-pressed="${mockReached(c, "design") ? "true" : "false"}" ${mockReached(c, "design") ? "" : "hidden"}><span class="swatch" style="background:${JAW.restoration.color}"></span>Crown 22 · CAD<kbd>3</kbd></button>` : ""}
          </div>
          <div class="vp-views" role="group" aria-label="Standard views">
            <button type="button" data-view="front">Front</button><button type="button" data-view="top">Occlusal</button><button type="button" data-view="left">Left</button><button type="button" data-view="right">Right</button><button type="button" data-view="iso">3D</button>
          </div>
          <div class="vp-status"><span id="vp-tris">—</span><span id="vp-grid">Grid —</span><span>Up axis <strong id="vp-up">${(c.upAxis || "y").toUpperCase()}</strong></span><span id="vp-flip-status">${c.invertUp ? "Flipped" : "Occlusal up"}</span>${c.sample ? `<span class="sample-flag">Demo · real jaw + CAD crown 22</span>` : `<span>Local file · not uploaded</span>`}</div>
          <div class="vp-overlay" id="vp-overlay"><h3>Loading scans</h3><p id="vp-load-text">Preparing meshes…</p><div class="progress"><span id="vp-load-bar" style="width:0%"></span></div></div>
          <div class="mock-overlay" id="mock-overlay" hidden>
            <div class="mock-stage">
              <div class="mock-stage-copy">
                <p class="mock-kicker" id="mock-kicker">Demo pipeline</p>
                <p class="mock-step-index" id="mock-step-index">Step 01</p>
                <h3 id="mock-title">Preparing…</h3>
                <p id="mock-text">Illustrative walkthrough — not clinical AI.</p>
                <div class="progress"><span id="mock-bar" style="width:0%"></span></div>
              </div>
              <ol class="mock-rail" id="mock-rail" aria-hidden="true">
                ${MOCK_STAGES.map((s, i) => `<li data-rail="${i}"><span>${String(i + 1).padStart(2, "0")}</span>${esc(s.label)}</li>`).join("")}
              </ol>
            </div>
          </div>
        </div>

        <aside class="props" id="props" aria-label="Properties">
          <div class="props-tabs" role="tablist" aria-label="Side panel">
            <button type="button" role="tab" data-props-tab="design" aria-selected="true">Design</button>
            <button type="button" role="tab" data-props-tab="case" aria-selected="false">Case</button>
          </div>
          <div class="cad-panel" id="cad-panel" data-props-pane="design"><p class="cad-note">Loading design tools…</p></div>
          <div data-props-pane="case" hidden>
          <details class="prop-sec" open><summary>Case information${icon("chevron")}</summary><dl>
            <div><dt>Case ID</dt><dd>${esc(c.sample ? "DEMO-22" : c.id)}</dd></div>
            <div><dt>Project</dt><dd>${esc(c.project || "Unassigned")}</dd></div>
            <div><dt>Patient reference</dt><dd>${esc(c.patientRef || "—")}</dd></div>
            <div><dt>Status</dt><dd>${c.sample ? "Demo walkthrough" : statusInfo.label}</dd></div>
            ${c.job ? `<div><dt>Client</dt><dd>${esc(c.job.client || "—")}</dd></div><div><dt>Technician</dt><dd>${esc(c.job.technician || "—")}</dd></div><div><dt>Due date</dt><dd>${esc(c.job.dueDate || "—")}</dd></div><div><dt>Scan mode</dt><dd>${c.job.scanMode === "intraoral" ? "Intraoral" : "Model scans"}</dd></div><div><dt>Material</dt><dd>${esc(c.job.units.find(u => u.fdi === tooth)?.material || c.job.material)}</dd></div><div><dt>Shade</dt><dd>${esc(c.job.units.find(u => u.fdi === tooth)?.shade || c.job.shade)}</dd></div>` : ""}
            <div><dt>Created</dt><dd>${c.sample ? "—" : fmtDate(c.created)}</dd></div>
            <div><dt>Modified</dt><dd>${c.sample ? "—" : fmtDate(c.modified)}</dd></div>
          </dl>${c.notes ? `<p class="prop-note">${esc(c.notes)}</p>` : ""}</details>

          <details class="prop-sec" open><summary>Selected tooth${icon("chevron")}</summary><dl>
            <div><dt>Tooth (FDI)</dt><dd>${teethLabel(c)}</dd></div>
            <div><dt>Name</dt><dd>${c.teeth.length === 1 ? toothName(tooth) : `${toothName(c.teeth[0])} to ${TOOTH_NAMES[c.teeth[c.teeth.length - 1] % 10]}`}</dd></div>
            <div><dt>Restoration</dt><dd>${RESTORATION[c.restoration]}${c.restoration === "bridge" ? ` · ${c.teeth.length} units` : ""}</dd></div>
            ${c.restoration === "bridge" ? `<div><dt>Abutments</dt><dd>${c.teeth[0]}, ${c.teeth[c.teeth.length - 1]}</dd></div><div><dt>Pontics</dt><dd>${c.teeth.slice(1, -1).join(", ")}</dd></div>` : ""}
            <div><dt>Jaw scan</dt><dd>${c.files.some((f) => f.jaw === archOf(tooth)) ? "Loaded" : "Missing"}</dd></div>
          </dl></details>

          ${propSec("Restoration parameters", mockReached(c, "design"), [
            ["Material", mockVal(mockReached(c, "design"), mock.design.material)],
            ["Cement gap", mockVal(mockReached(c, "design"), mock.design.cementGap)],
            ["Minimum thickness", mockVal(mockReached(c, "design"), mock.design.minThickness)],
          ], "Walkthrough values only. Real measurements are in the Design tab.")}
          ${propSec("Margin", mockReached(c, "margin"), [
            ["Preparation type", mockVal(mockReached(c, "prep"), mock.prep.type)],
            ["Margin line", mockVal(mockReached(c, "margin"), `${mock.margin.points} points`)],
            ["Margin position", mockVal(mockReached(c, "margin"), mock.margin.position)],
          ], "Walkthrough values only. The margin tools are in the Design tab.")}
          ${propSec("Contacts", mockReached(c, "review"), [
            ["Mesial contact", mockVal(mockReached(c, "review"), mock.design.mesial)],
            ["Distal contact", mockVal(mockReached(c, "review"), mock.design.distal)],
            ["Target strength", mockVal(mockReached(c, "review"), "Light · demo")],
          ], "Walkthrough values only. Measured contacts are in the Design tab.")}
          ${propSec("Occlusion", mockReached(c, "review") || (hasUpper && hasLower), [
            ["Antagonist", hasUpper && hasLower ? "Both jaws loaded" : "Antagonist scan missing"],
            ["Occlusal clearance", mockVal(mockReached(c, "review"), mock.design.clearance)],
            ["Contact map", mockVal(mockReached(c, "review"), "Generated · demo")],
          ], "Walkthrough values only. Measured occlusion is in the Design tab.")}

          <details class="prop-sec" ${c.seg ? "open" : ""} id="seg-props"><summary>Segmentation${c.seg ? `<span class="badge status-ready">Live</span>` : `<span class="badge badge-planned">Ready</span>`}${icon("chevron")}</summary>
            <dl id="seg-props-dl">
              <div><dt>Source</dt><dd>${c.seg ? "STL jaw meshes" : "—"}</dd></div>
              <div><dt>Mode</dt><dd>${c.seg?.model_type || "—"}</dd></div>
              <div><dt>Teeth found</dt><dd>${c.seg?.summary?.Teeth ?? c.seg?.teeth?.length ?? "—"}</dd></div>
              <div><dt>Upper</dt><dd>${c.seg?.summary?.Upper ?? "—"}</dd></div>
              <div><dt>Lower</dt><dd>${c.seg?.summary?.Lower ?? "—"}</dd></div>
              <div><dt>Time</dt><dd>${c.seg?.inference_ms != null ? `${c.seg.inference_ms} ms` : "—"}</dd></div>
            </dl>
            <p class="prop-note">${c.seg ? "Teeth marked on the 3D scan with blue margins and FDI labels." : "Click Segmentation to mark teeth on the loaded jaw STLs."}</p>
          </details>

          <details class="prop-sec" open><summary>Model information${icon("chevron")}</summary>
            <div id="model-info">${c.files.map((f) => `<div class="model-file"><h4><span class="swatch" style="background:${JAW[f.jaw]?.color || "#999"}"></span>${JAW[f.jaw]?.label || "Scan"}</h4><dl><div><dt>File</dt><dd title="${esc(f.name)}">${esc(f.name.length > 26 ? f.name.slice(0, 24) + "…" : f.name)}</dd></div><div><dt>File size</dt><dd>${fmtBytes(f.size)}</dd></div><div><dt>Mesh</dt><dd class="na"><span class="skel" style="width:90px;display:inline-block"></span></dd></div></dl></div>`).join("")}</div>
            <div class="prop-control"><span>Up axis</span><div class="segmented" role="group" aria-label="Up axis"><button type="button" data-up="y" aria-pressed="${(c.upAxis || "y") === "y"}">Y-up</button><button type="button" data-up="z" aria-pressed="${c.upAxis === "z"}">Z-up</button></div></div>
            <div class="prop-control"><span>Occlusal</span><div class="segmented" role="group" aria-label="Occlusal direction"><button type="button" data-flip="0" aria-pressed="${!c.invertUp}">Normal</button><button type="button" data-flip="1" aria-pressed="${!!c.invertUp}">Flip</button></div></div>
          </details>
          </div>
        </aside>
      </div>

      <nav class="workflow" aria-label="Case workflow">
        ${workflowSteps.map(([t, s, st, id, i]) => {
          const unlocked = i <= Math.max(stage, scans.length ? 1 : 0);
          return `<button type="button" class="wf-step ${st === "done" ? "is-done" : ""} ${st === "current" ? "is-current" : ""}" data-mock-step="${i}" data-mock-id="${id}" ${unlocked ? "" : `aria-disabled="true"`} data-tip="${unlocked ? `${t} · demo step` : `${t}: run the demo pipeline to unlock`}" data-tip-pos="top">
          <span class="n">${st === "done" ? icon("check", "ico-sm") : st === "planned" ? icon("lock", "ico-sm") : i + 1}</span><strong>${t}</strong><small>${s}</small></button>`;
        }).join("")}
      </nav>
    </div>`;

    const workspaceRoot = view.closest("#workspace-root");
    if (workspaceRoot) workspaceRoot.style.visibility = "visible";

    // ---- actions
    const mark = $("#mark-reviewed");
    if (mark) mark.addEventListener("click", async () => {
      c.status = "ready";
      c.modified = Date.now();
      await saveCase(c);
      await logActivity("reviewed", `${c.id} scans reviewed — ready for design`, c.id);
      toast(`${c.id} marked ready for design`);
      route();
    });

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let pipelineViewer = null;

    const paintSegResult = (result) => {
      c.seg = result;
      const dl = $("#seg-props-dl");
      if (dl) {
        dl.innerHTML = `
          <div><dt>Source</dt><dd>STL jaw meshes</dd></div>
          <div><dt>Mode</dt><dd>${result.model_type || "stl-geometry"}</dd></div>
          <div><dt>Teeth found</dt><dd>${result.summary?.Teeth ?? result.teeth?.length ?? 0}</dd></div>
          <div><dt>Upper</dt><dd>${result.summary?.Upper ?? "—"}</dd></div>
          <div><dt>Lower</dt><dd>${result.summary?.Lower ?? "—"}</dd></div>
          <div><dt>Time</dt><dd>${result.inference_ms != null ? `${result.inference_ms} ms` : "—"}</dd></div>`;
      }
      const props = $("#seg-props");
      if (props) {
        props.open = true;
        const badge = props.querySelector("summary .badge");
        if (badge) {
          badge.className = "badge status-ready";
          badge.textContent = "Live";
        }
      }
    };

    const syncToothLabels = (teeth) => {
      const host = $("#vp-tooth-labels");
      if (!host || !pipelineViewer) return;
      if (!teeth?.length) {
        host.innerHTML = "";
        host.dataset.count = "0";
        return;
      }
      host.innerHTML = teeth
        .map((t, i) => `<span class="vp-tooth-label ${t.selected ? "is-selected" : ""} ${t.confidence < 0.6 ? "is-unsure" : ""}" data-ti="${i}" data-fdi="${esc(t.label)}">${esc(t.label)}</span>`)
        .join("");
      host.dataset.count = String(teeth.length);
      const place = () => {
        const labels = $$(".vp-tooth-label", host);
        labels.forEach((el, i) => {
          const t = teeth[i];
          if (!t?.labelWorld) {
            el.classList.add("is-hidden");
            return;
          }
          const scr = pipelineViewer.projectToScreen(t.labelWorld);
          if (!scr || scr.behind || pipelineViewer.meshes.get(t.meshId)?.visible === false) {
            el.classList.add("is-hidden");
            return;
          }
          el.classList.remove("is-hidden");
          el.style.left = `${scr.x}px`;
          el.style.top = `${scr.y}px`;
        });
      };
      place();
      pipelineViewer._placeToothLabels = place;
    };

    const runSegmentation = async () => {
      const btn = $("#run-seg");
      if (btn) btn.disabled = true;
      toast("Segmenting teeth on STL meshes…");

      const t0 = performance.now();
      try {
        if (!pipelineViewer) throw new Error("3D viewer is not ready yet.");

        if (!cadEditor) throw new Error("The design tools are still loading. Try again in a moment.");
        cadEditor.setTool("teeth");
        if (!Object.keys(cadEditor.teethData).length) cadEditor.identifyTeeth({ keepSaved: true });
        const target = c.primaryTooth || c.teeth?.[0];
        const match = cadEditor.allTeeth().find(t => t.fdi === target);
        if (match) cadEditor.selectTooth(match.jaw, match.index);
        cadEditor.paintTeeth();
        const allTeeth = cadEditor.allTeeth();
        if (!allTeeth.length) throw new Error("No teeth found on the loaded scans. Check the Up axis and Flip settings.");
        cadEditor.showJaw(cadEditor.teethJaw);

        const ms = Math.round(performance.now() - t0);
        const detections = allTeeth.map((t) => ({
          label: t.label,
          tooth_id: t.label,
          confidence: t.confidence,
          jaw: t.jaw,
          width_mm: t.width,
        }));
        const summary = {
          Teeth: allTeeth.length,
          Upper: allTeeth.filter((t) => t.jaw === "upper").length,
          Lower: allTeeth.filter((t) => t.jaw === "lower").length,
        };

        paintSegResult({
          detections,
          summary,
          inference_ms: ms,
          is_demo: false,
          model_type: "arch-geometry",
          teeth: allTeeth,
        });

        if (!c.mock) c.mock = buildMockResult(c);
        c.mock.stage = Math.max(c.mock.stage || 0, 1);
        if (c.mock.analysis) {
          c.mock.analysis.regions = allTeeth.length;
          c.mock.analysis.gingiva = "Separated";
          c.mock.analysis.confidence = `${Math.round(100 * (allTeeth.reduce((s, t) => s + t.confidence, 0) / allTeeth.length))}%`;
        }
        c.modified = Date.now();
        if (!c.sample) await saveCase(c);
        await logActivity("segment", `${c.id} teeth numbered · ${allTeeth.length} found`, c.id);
        toast(`${allTeeth.length} teeth numbered. Review them in the Teeth panel.`);
      } catch (err) {
        toast(err.message || "STL segmentation failed", "error");
        console.error(err);
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    const applyStageVisuals = (i) => {
      if (!pipelineViewer) return;
      const v = pipelineViewer;
      const showCrown = i >= 4;
      // Prep / margin / design: upper (+ crown). Review+: bring antagonist back for occlusion.
      const showLower = i < 2 || i >= 5;
      const showUpper = true;

      c.files.forEach((f) => {
        try {
          if (f.jaw === "restoration") v.setVisible(f.id, showCrown);
          else if (f.jaw === "lower") v.setVisible(f.id, showLower);
          else if (f.jaw === "upper") v.setVisible(f.id, showUpper);
        } catch (_) { /* ignore */ }
      });

      const crownBtn = $(`[data-layer="restoration"]`);
      if (crownBtn) {
        crownBtn.hidden = !showCrown;
        crownBtn.setAttribute("aria-pressed", String(showCrown));
      }
      const lowerBtn = $(`[data-layer="lower"]`);
      if (lowerBtn) lowerBtn.setAttribute("aria-pressed", String(showLower));

      try { v.setWireframe(i === 1 || i === 2); } catch (_) {}
      const wireBtn = $(`[data-tool="wire"]`);
      if (wireBtn) wireBtn.setAttribute("aria-pressed", String(i === 1 || i === 2));

      try {
        if (i === 1) v.view("iso");
        else if (i === 2 || i === 3) {
          v.view("front");
          // Frame the anterior prep (tooth 22) a bit closer than full-arch fit.
          if (v.bounds) {
            const b = v.bounds;
            const center = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
            v.go({ target: center, yaw: v.cam.yaw, pitch: v.cam.pitch, dist: Math.max(28, v.cam.dist * 0.72) });
          }
        } else if (i === 4) {
          v.view("iso");
          v.fit();
          if (v.cam.dist > 40) v.go({ target: v.cam.target.slice(), yaw: v.cam.yaw, pitch: v.cam.pitch, dist: v.cam.dist * 0.55 });
        } else if (i === 5) v.view("front");
        else if (i === 6) v.view("iso");
      } catch (_) { /* ignore */ }
    };

    const runMockPipeline = async (fromStage = 1) => {
      if (!scans.length && !c.sample) {
        toast("Add scans before running the demo pipeline.", "warn");
        return;
      }
      if (!c.mock) c.mock = buildMockResult(c);
      if (c.status !== "ready" && !c.sample) c.status = "ready";
      const overlay = $("#mock-overlay");
      const title = $("#mock-title");
      const text = $("#mock-text");
      const bar = $("#mock-bar");
      const kicker = $("#mock-kicker");
      const stepIndex = $("#mock-step-index");
      const start = Math.max(1, fromStage);
      overlay.hidden = false;
      document.body.classList.add("mock-running");

      for (let i = start; i < MOCK_STAGES.length; i++) {
        const step = MOCK_STAGES[i];
        const copy = MOCK_COPY[i] || { title: step.label, line: step.running, accent: "Demo" };
        title.textContent = copy.title;
        text.textContent = copy.line;
        kicker.textContent = copy.accent;
        stepIndex.textContent = `Step ${String(i + 1).padStart(2, "0")} / ${String(MOCK_STAGES.length).padStart(2, "0")}`;
        bar.style.width = `${(i / (MOCK_STAGES.length - 1)) * 100}%`;
        $$("#mock-rail [data-rail]").forEach((el) => {
          const idx = Number(el.dataset.rail);
          el.classList.toggle("is-done", idx < i);
          el.classList.toggle("is-current", idx === i);
        });
        applyStageVisuals(i);
        if (i === 1) {
          text.textContent = "Detecting teeth on STL scans…";
          try {
            await runSegmentation();
          } catch (_) { /* toast already shown */ }
        }
        await sleep(i === 4 ? 1600 : i === 2 || i === 3 ? 1100 : 900);
        c.mock.stage = i;
        c.modified = Date.now();
        text.textContent = step.done;
        bar.style.width = `${(i / (MOCK_STAGES.length - 1)) * 100}%`;
        await sleep(380);
        if (!c.sample) await saveCase(c);
        await logActivity("demo", `${c.id} demo · ${step.label}`, c.id);
      }

      document.body.classList.remove("mock-running");
      overlay.hidden = true;
      toast("Demo complete — crown 22 revealed. Explore steps & properties.");
      route();
    };

    $("#run-mock")?.addEventListener("click", () => {
      void runMockPipeline(stage >= MOCK_STAGES.length - 1 ? 1 : Math.max(1, stage + 1));
    });
    $("#run-seg")?.addEventListener("click", () => { void runSegmentation(); });
    $$("[data-mock-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.getAttribute("aria-disabled") === "true") return;
        const i = Number(btn.dataset.mockStep);
        const id = btn.dataset.mockId;
        if (id === "analysis") {
          void runSegmentation();
          return;
        }
        if (i <= stage) {
          toast(`${MOCK_STAGES[i].label}: ${MOCK_STAGES[i].done}`);
          applyStageVisuals(i);
          return;
        }
        void runMockPipeline(Math.max(1, stage + 1));
      });
    });
    const restore = $("#restore-case");
    if (restore) restore.addEventListener("click", async () => {
      await restoreCase(c);
      route();
    });
    const del = $("#delete-case");
    if (del) del.addEventListener("click", async () => {
      if (await deleteCase(c)) navigate("/workspace/cases");
    });
    $("#download").addEventListener("click", async () => {
      for (const f of scans) {
        try {
          const blob = c.sample ? await (await fetch(f.url)).blob() : new Blob([(await store.get("files", f.id)).buffer], { type: "model/stl" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = f.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (e) {
          toast(`Could not download ${f.name}`, "error");
        }
      }
    });
    $$("[data-props-tab]").forEach((tab) => tab.addEventListener("click", () => {
      $$("[data-props-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      $$("[data-props-pane]").forEach((p) => { p.hidden = p.dataset.propsPane !== tab.dataset.propsTab; });
    }));
    const cad = $("#cad");
    const propsToggle = $("#props-toggle");
    propsToggle.addEventListener("click", () => {
      const open = !cad.classList.contains("props-open");
      cad.classList.toggle("props-open", open);
      propsToggle.setAttribute("aria-expanded", String(open));
    });

    const statsHtml = (f, stats) => `
      <div><dt>File</dt><dd title="${esc(f.name)}">${esc(f.name.length > 26 ? f.name.slice(0, 24) + "…" : f.name)}</dd></div>
      <div><dt>Triangles</dt><dd>${fmtNum(stats.triangles)}</dd></div>
      <div><dt>Vertices</dt><dd>${fmtNum(stats.vertices)}</dd></div>
      <div><dt>Dimensions</dt><dd>${stats.size.map((v) => v.toFixed(1)).join(" × ")} mm</dd></div>
      <div><dt>Surface area</dt><dd>${fmtNum(Math.round(stats.area))} mm²</dd></div>
      <div><dt>Mesh</dt><dd>${stats.closed ? `Closed${stats.volume ? ` · ${fmtNum(Math.round(stats.volume))} mm³` : ""}` : `Open · ${fmtNum(stats.boundaryEdges)} boundary edges`}</dd></div>
      ${stats.nonManifoldEdges ? `<div><dt>Non-manifold edges</dt><dd>${fmtNum(stats.nonManifoldEdges)}</dd></div>` : ""}
      <div><dt>File size</dt><dd>${fmtBytes(f.size)}</dd></div>`;

    // Phones get the monitoring view only: no 3D viewer, stats from the stored validation.
    if (window.matchMedia("(max-width: 760px)").matches) {
      $(`[data-props-tab="case"]`).click();
      $$(".model-file", $("#model-info")).forEach((block, i) => {
        const f = c.files[i];
        block.querySelector("dl").innerHTML = f.stats ? statsHtml(f, f.stats) : `<div><dt>File</dt><dd>${esc(f.name)}</dd></div><div><dt>File size</dt><dd>${fmtBytes(f.size)}</dd></div>`;
      });
      return null;
    }

    // ---- viewer
    const noDesignTools = (reason) => {
      $("#cad-panel").innerHTML = `<p class="cad-note">${reason}</p>`;
      $("#cad-status").textContent = "Design tools unavailable";
      $(`[data-props-tab="case"]`).click();
    };
    if (!window.FaucharViewer) {
      $("#vp-overlay").innerHTML = `<h3>Viewer unavailable</h3><p>The 3D viewer script could not load.</p>`;
      noDesignTools("Design tools need the 3D viewer, which could not load.");
      return null;
    }
    const viewer = new window.FaucharViewer($("#gl"), {
      gizmo: $("#gizmo"),
      onChange: (v) => {
        const g = $("#vp-grid");
        if (g) g.textContent = v.grid && v.gridStep ? `Grid ${v.gridStep} mm` : "Grid off";
        if (typeof v._placeToothLabels === "function") v._placeToothLabels();
      },
    });
    if (!viewer.supported) {
      $("#vp-overlay").innerHTML = `${icon("alert", "ico-lg")}<h3>WebGL is not available</h3><p>The 3D workspace needs WebGL with 32-bit index support. Case details remain available in the panel.</p>`;
      noDesignTools("Design tools need WebGL, which this browser does not provide.");
      return null;
    }
    viewer.upAxis = c.upAxis === "z" ? "z" : "y";
    viewer.invertUp = !!c.invertUp;
    pipelineViewer = viewer;

    let disposed = false;
    let cadEditor = null;
    const showCrownInitially = mockReached(c, "design") || (!c.sample && !!restorationFile && stage >= 4);
    const visible = { upper: true, lower: true, restoration: showCrownInitially };
    let totalTris = 0;

    const setLayer = (layer, on) => {
      visible[layer] = on;
      c.files.filter((f) => f.jaw === layer).forEach((f) => {
        const obj = cadEditor?.objects.get(f.id);
        if (obj) cadEditor.setVisible(obj, on);
        else viewer.setVisible(f.id, on);
      });
      cadEditor?.paintTeeth();
      cadEditor?.session?.refresh();
      const b = $(`[data-layer="${layer}"]`);
      if (b) b.setAttribute("aria-pressed", String(on));
    };
    $$("[data-layer]").forEach((b) => b.addEventListener("click", () => setLayer(b.dataset.layer, !visible[b.dataset.layer])));
    $$("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      viewer.setMode(b.dataset.mode);
      $$("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    const tool = (name) => {
      if (name === "fit") viewer.fit();
      if (name === "reset") viewer.reset();
      if (name === "wire") {
        viewer.setWireframe(!viewer.wireframe);
        $("[data-tool='wire']").setAttribute("aria-pressed", String(viewer.wireframe));
      }
      if (name === "grid") {
        viewer.setGrid(!viewer.grid);
        $("[data-tool='grid']").setAttribute("aria-pressed", String(viewer.grid));
      }
    };
    $$("[data-tool]").forEach((b) => b.addEventListener("click", () => tool(b.dataset.tool)));
    $$("[data-view]").forEach((b) => b.addEventListener("click", () => {
      if (!cadEditor?.dentalView(b.dataset.view)) viewer.view(b.dataset.view);
    }));
    $$("[data-up]").forEach((b) => b.addEventListener("click", async () => {
      viewer.setUpAxis(b.dataset.up);
      $$("[data-up]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      $("#vp-up").textContent = b.dataset.up.toUpperCase();
      c.upAxis = b.dataset.up;
      if (c.seg?.teeth?.length) void recolorSeg();
      if (!c.sample) await saveCase(c);
    }));
    $$("[data-flip]").forEach((b) => b.addEventListener("click", async () => {
      const on = b.dataset.flip === "1";
      viewer.setInvertUp(on);
      $$("[data-flip]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      const st = $("#vp-flip-status");
      if (st) st.textContent = on ? "Flipped" : "Occlusal up";
      c.invertUp = on;
      if (c.seg?.teeth?.length) void recolorSeg();
      if (!c.sample) await saveCase(c);
    }));

    // Numbers depend on which way the scan faces, so a change of orientation means counting again.
    const recolorSeg = () => {
      if (!cadEditor || !Object.keys(cadEditor.teethData).length) return;
      cadEditor.clearTeeth();
      cadEditor.identifyTeeth({ keepSaved: false });
      cadEditor.paintTeeth();
    };

    const onKey = (e) => {
      if (e.target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "f") tool("fit");
      else if (k === "r") tool("reset");
      else if (k === "w") tool("wire");
      else if (k === "g") tool("grid");
      else if (k === "1" && hasUpper) setLayer("upper", !visible.upper);
      else if (k === "2" && hasLower) setLayer("lower", !visible.lower);
      else if (k === "3" && restorationFile) setLayer("restoration", !visible.restoration);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);

    // ---- manual CAD editor
    const bootCadEditor = async () => {
      const designKey = `cad:${c.id}`;
      let sampleDesign = null;
      if (c.sample) {
        sampleDesign = await fetch("/assets/sample/demo-22.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      }
      const editor = new CadEditor({
        viewer, caseData: c, sampleDesign,
        hud: $("#cad-hud"), ribbon: $("#cad-ribbon"), panel: $("#cad-panel"), legend: $("#cad-legend"), statusEl: $("#cad-status"),
        io: {
          toast,
          saveDesign: (design) => store.put("files", { id: designKey, caseId: c.id, design }),
          loadDesign: async () => (await store.get("files", designKey))?.design ?? null,
          clearDesign: () => store.del("files", designKey),
          confirmDiscard: () => confirmDialog({ title: "Discard all edits to this design?", body: "Every edit, pontic and connector in this case will be removed and the restoration goes back to how it was imported. This can't be undone.", ok: "Discard edits" }),
          onTeeth: (list) => syncToothLabels(list),
          onVisibility: (o, on) => {
            if (o.jaw && on !== undefined) {
              visible[o.jaw] = on;
              const b = $(`[data-layer="${o.jaw}"]`);
              if (b) b.setAttribute("aria-pressed", String(on));
            }
          },
        },
      });
      const entries = c.files.filter((f) => viewer.meshes.has(f.id));
      try {
        await editor.init(entries);
      } catch (e) {
        console.error(e);
        toast(`Design tools could not start: ${e.message}`, "error");
        noDesignTools(`Design tools could not start: ${esc(e.message)}`);
        return null;
      }
      if (disposed) {
        editor.dispose();
        return null;
      }
      const ribbon = $("#cad-ribbon");
      ribbon.addEventListener("click", (e) => {
        if (editor.busy) return;
        const toolBtn = e.target.closest("[data-cad-tool]");
        if (toolBtn) editor.setTool(toolBtn.dataset.cadTool);
        const cmd = e.target.closest("[data-cad]")?.dataset.cad;
        if (cmd === "undo") editor.undo();
        if (cmd === "redo") editor.redo();
        if (cmd === "export") editor.exportUnit();
      });
      mountDentalSession(editor, cad);
      return editor;
    };

    // ---- load meshes
    const overlay = $("#vp-overlay");
    const bar = $("#vp-load-bar");
    const text = $("#vp-load-text");
    const n = c.files.length;
    let failed = 0;
    for (let i = 0; i < n; i++) {
      if (disposed) break;
      const f = c.files[i];
      text.textContent = `Loading ${f.name} (${i + 1} of ${n})`;
      try {
        let buffer;
        if (c.sample) {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buffer = await res.arrayBuffer();
        } else {
          const rec = await store.get("files", f.id);
          if (!rec) throw new Error("File missing from browser storage");
          buffer = rec.buffer.slice(0);
        }
        const { mesh, stats } = await parseSTL(buffer, f.name, (p) => {
          bar.style.width = `${(((i + p) / n) * 100).toFixed(0)}%`;
        });
        if (disposed) break;
        const style = f.jaw === "restoration"
          ? { color: "#F5F4EF", spec: 0.72, gloss: 72, sss: 0.35 }
          : { color: JAW[f.jaw]?.color || "#c9c2b3", spec: 0.12, gloss: 18, sss: 0.28 };
        viewer.addMesh(f.id, mesh, style);
        if (["preop", "gingiva", "bite"].includes(f.jaw)) viewer.setVisible(f.id, false);
        if (f.jaw === "restoration" && !showCrownInitially) {
          viewer.setVisible(f.id, false);
        }
        totalTris += stats.triangles;
        const block = $$(".model-file", $("#model-info"))[i];
        if (block) block.querySelector("dl").innerHTML = statsHtml(f, stats);
      } catch (e) {
        failed++;
        toast(`${f.name}: ${e.message}`, "error");
        const block = $$(".model-file", $("#model-info"))[i];
        if (block) block.querySelector("dl").innerHTML = `<div><dt>Status</dt><dd style="color:#ffb3b3">Could not load</dd></div><div><dt>Reason</dt><dd>${esc(e.message)}</dd></div>`;
      }
    }
    if (!disposed) {
      $("#vp-tris").textContent = `${fmtNum(totalTris)} triangles`;
      if (failed === n) {
        overlay.innerHTML = `${icon("alert", "ico-lg")}<h3>The scans could not be loaded</h3><p>Check the files in Model information. You can delete this case and upload the scans again.</p>`;
        noDesignTools("Design tools need at least one loaded scan or restoration.");
      } else {
        overlay.hidden = true;
        viewer.setUpAxis(viewer.upAxis);
        viewer.setInvertUp(!!viewer.invertUp);
        viewer.view("iso");
        viewer.fit();
        // Restore STL tooth colors / contours if segmentation was already run.
        const crownBtn = $(`[data-layer="restoration"]`);
        if (restorationFile && crownBtn) {
          crownBtn.hidden = false;
          setLayer("restoration", true);
        }
        cadEditor = await bootCadEditor();
      }
    }

    return {
      dispose() {
        disposed = true;
        document.removeEventListener("keydown", onKey);
        cadEditor?.dispose();
        viewer.dispose();
      },
    };
  }

  /* ========================================================== shortcuts */

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenus();
      if (document.body.classList.contains("side-open")) sidebarToggle?.click();
      return;
    }
    if (e.target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($("dialog[open]")) return;
    if (e.key === "?") {
      e.preventDefault();
      $("#shortcuts-dialog").showModal();
    } else if (e.key.toLowerCase() === "n" && !/^\/case\//.test(workspacePath())) {
      e.preventDefault();
      navigate("/workspace/cases/new");
    } else if (e.key === "/") {
      e.preventDefault();
      const s = $("[data-search]");
      if (s) s.focus();
      else {
        navigate("/workspace/cases");
        setTimeout(() => $("[data-search]")?.focus(), 50);
      }
    }
  });

  /* ============================================================== start */

  return (async () => {
    await store.open();
    await loadData();
    ready = true;
    await route();
  })();
}
