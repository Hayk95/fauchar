import { voxelMarkSvg } from "@/lib/brandMark";

export const workspaceHtml = `<svg class="sprite" aria-hidden="true" focusable="false">
    <symbol id="w-dashboard" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/></symbol>
    <symbol id="w-folder" viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></symbol>
    <symbol id="w-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="w-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol>
    <symbol id="w-tooth" viewBox="0 0 24 24"><path d="M7 8.2C7 5.6 9.2 4.4 11 5.4l1 .55 1-.55c1.8-1 4 .2 4 2.8 0 3.1-1.1 4.6-1.6 6.9l-.75 4.3c-.2 1.1-1.75 1.1-1.95 0L12.5 15h-1l-.95 4.4c-.2 1.1-1.75 1.1-1.95 0l-.75-4.3C7.1 12.8 7 11.3 7 8.2z"/></symbol>
    <symbol id="w-share" viewBox="0 0 24 24"><circle cx="17" cy="6" r="2.5"/><circle cx="7" cy="12" r="2.5"/><circle cx="17" cy="18" r="2.5"/><path d="m9.2 10.8 5.6-3.4M9.2 13.2l5.6 3.4"/></symbol>
    <symbol id="w-archive" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4"/></symbol>
    <symbol id="w-bell" viewBox="0 0 24 24"><path d="M6.5 16.5v-5.5a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></symbol>
    <symbol id="w-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></symbol>
    <symbol id="w-chevron" viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></symbol>
    <symbol id="w-chevron-right" viewBox="0 0 24 24"><path d="m10 8 4 4-4 4"/></symbol>
    <symbol id="w-upload" viewBox="0 0 24 24"><path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/></symbol>
    <symbol id="w-download" viewBox="0 0 24 24"><path d="M12 4.5v11M7.5 11 12 15.5 16.5 11M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/></symbol>
    <symbol id="w-file" viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></symbol>
    <symbol id="w-library" viewBox="0 0 24 24"><path d="M4.5 4.5h4v15h-4zM10.5 4.5h4v15h-4z"/><path d="m16.5 5.2 3.6-.9 3 14.6-3.6.9z" transform="translate(-2.5 0)"/></symbol>
    <symbol id="w-activity" viewBox="0 0 24 24"><path d="M3.5 12h4l2.5-6 4 12 2.5-6h4"/></symbol>
    <symbol id="w-more" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></symbol>
    <symbol id="w-check" viewBox="0 0 24 24"><path d="m5.5 12.5 4 4 9-9"/></symbol>
    <symbol id="w-x" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>
    <symbol id="w-lock" viewBox="0 0 24 24"><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>
    <symbol id="w-alert" viewBox="0 0 24 24"><path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17.2v.1"/></symbol>
    <symbol id="w-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/></symbol>
    <symbol id="w-orbit" viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v3.7h-3.7"/></symbol>
    <symbol id="w-pan" viewBox="0 0 24 24"><path d="M12 3.5v17M3.5 12h17M12 3.5 9.5 6M12 3.5 14.5 6M12 20.5 9.5 18M12 20.5l2.5-2.5M3.5 12 6 9.5M3.5 12 6 14.5M20.5 12 18 9.5M20.5 12 18 14.5"/></symbol>
    <symbol id="w-zoom" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5M8.5 11h5M11 8.5v5"/></symbol>
    <symbol id="w-fit" viewBox="0 0 24 24"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="2.5"/></symbol>
    <symbol id="w-reset" viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.7h3.7"/></symbol>
    <symbol id="w-cube" viewBox="0 0 24 24"><path d="M12 2.75 20.25 7.5v9L12 21.25 3.75 16.5v-9z"/><path d="M3.75 7.5 12 12.25l8.25-4.75M12 12.25v9"/></symbol>
    <symbol id="w-wire" viewBox="0 0 24 24"><path d="M12 3.5 20.5 19h-17z"/><path d="M7.75 11.25h8.5L12 19z"/></symbol>
    <symbol id="w-grid" viewBox="0 0 24 24"><path d="M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17"/><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/></symbol>
    <symbol id="w-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></symbol>
    <symbol id="w-eye-off" viewBox="0 0 24 24"><path d="M4 4l16 16M9.9 6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-2.9 3.6M6.1 7.9A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 3.6-.7"/></symbol>
    <symbol id="w-user" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.9-3.6 3.9-5.5 7.5-5.5s6.6 1.9 7.5 5.5"/></symbol>
    <symbol id="w-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></symbol>
    <symbol id="w-keyboard" viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/></symbol>
    <symbol id="w-external" viewBox="0 0 24 24"><path d="M13.5 4.5h6v6M19.5 4.5l-8.5 8.5M17.5 13.5v5a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18.5V8A1.5 1.5 0 0 1 6 6.5h5"/></symbol>
    <symbol id="w-trash" viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6"/></symbol>
    <symbol id="w-restore" viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.7h3.7M12 8v4l2.5 1.5"/></symbol>
    <symbol id="w-layers" viewBox="0 0 24 24"><path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/></symbol>
    <symbol id="w-panel" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M14.5 4.5v15"/></symbol>
    <symbol id="w-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
  </svg>

  <a class="skip" href="#view">Skip to content</a>

  <header class="topbar">
    <button class="icon-btn topbar-menu" type="button" id="sidebar-toggle" aria-controls="sidebar" aria-expanded="false" data-tip="Menu">
      <svg class="ico"><use href="#w-menu"/></svg><span class="sr-only">Open navigation</span>
    </button>

    <a class="brand" href="/workspace" aria-label="FAUCHAR Workspace, dashboard">
      ${voxelMarkSvg("brand-mark")}
      <svg class="brand-word" viewBox="-1.5 -1.5 157 23.6" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4"><path d="M1.2 20V1.2H13M1.2 10.4H11"/><path d="M22 20.6 29 1 36 20.6"/><path d="M45.2 0v12.6a6.8 6.8 0 0 0 13.6 0V0"/><path d="M85.5 4.3A9.6 9.6 0 1 0 85.5 15.7"/><path d="M94.2 0v20M108.6 0v20M94.2 10.2h14.4"/><path d="M117 20.6 124 1 131 20.6"/><path d="M141.2 20V1.2h7.6a5.3 5.3 0 0 1 0 10.6h-7.6M147.6 11.8 154 20"/></g></svg>
    </a>

    <div class="menu-wrap">
      <button class="ws-select" type="button" id="ws-button" aria-haspopup="menu" aria-expanded="false" aria-controls="ws-menu">
        <span class="ws-dot" aria-hidden="true"></span>
        <span class="ws-name">Local workspace</span>
        <svg class="ico ico-sm"><use href="#w-chevron"/></svg>
      </button>
      <div class="menu" id="ws-menu" role="menu" hidden>
        <p class="menu-label">Workspaces</p>
        <button type="button" role="menuitemradio" aria-checked="true" class="menu-item"><span class="ws-dot" aria-hidden="true"></span>Local workspace<span class="menu-meta">This browser</span></button>
        <button type="button" role="menuitem" class="menu-item" aria-disabled="true" data-tip="Team workspaces need a FAUCHAR account (planned)"><svg class="ico ico-sm"><use href="#w-lock"/></svg>Team workspaces<span class="badge badge-planned">Planned</span></button>
      </div>
    </div>

    <nav class="topnav" aria-label="Workspace">
      <a href="/workspace/projects" data-nav="projects">Projects</a>
      <a href="/workspace/cases" data-nav="cases">Cases</a>
      <a href="/workspace/library" data-nav="library">Library</a>
      <a href="/workspace/activity" data-nav="activity">Activity</a>
    </nav>

    <div class="topbar-end">
      <span class="local-pill" data-tip="Cases and scans are stored only in this browser. Nothing is uploaded."><svg class="ico ico-sm"><use href="#w-lock"/></svg>Local · not synced</span>

      <div class="menu-wrap">
        <button class="icon-btn" type="button" id="notif-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="notif-panel" data-tip="Notifications">
          <svg class="ico"><use href="#w-bell"/></svg>
          <span class="notif-count" id="notif-count" hidden>0</span>
          <span class="sr-only">Notifications</span>
        </button>
        <div class="menu menu-wide" id="notif-panel" role="dialog" aria-label="Notifications" hidden>
          <div class="menu-head">
            <p class="menu-label">Notifications</p>
            <button type="button" class="link-btn" id="notif-read">Mark all read</button>
          </div>
          <ul class="notif-list" id="notif-list"></ul>
        </div>
      </div>

      <div class="menu-wrap">
        <button class="avatar-btn" type="button" id="user-button" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu">
          <span class="avatar" aria-hidden="true">LU</span><span class="sr-only">Account menu</span>
        </button>
        <div class="menu" id="user-menu" role="menu" hidden>
          <div class="menu-user">
            <span class="avatar" aria-hidden="true">LU</span>
            <span><strong>Local user</strong><small>Not signed in</small></span>
          </div>
          <a role="menuitem" class="menu-item" href="/workspace/settings"><svg class="ico ico-sm"><use href="#w-settings"/></svg>Workspace settings</a>
          <button role="menuitem" type="button" class="menu-item" data-action="shortcuts"><svg class="ico ico-sm"><use href="#w-keyboard"/></svg>Keyboard shortcuts<kbd>?</kbd></button>
          <a role="menuitem" class="menu-item" href="/projects"><svg class="ico ico-sm"><use href="#w-folder"/></svg>My projects</a>
          <a role="menuitem" class="menu-item" href="/signin"><svg class="ico ico-sm"><use href="#w-user"/></svg>Sign in</a>
          <a role="menuitem" class="menu-item" href="/"><svg class="ico ico-sm"><use href="#w-external"/></svg>fauchar.com</a>
        </div>
      </div>
    </div>
  </header>

  <div class="shell">
    <aside class="sidebar" id="sidebar" aria-label="Sections">
      <nav>
        <ul class="side-nav">
          <li><a href="/workspace" data-nav="dashboard"><svg class="ico"><use href="#w-dashboard"/></svg>Dashboard</a></li>
          <li><a href="/workspace/projects" data-nav="projects"><svg class="ico"><use href="#w-folder"/></svg>All Projects</a></li>
          <li><a href="/workspace/cases/new" data-nav="new" class="side-new"><svg class="ico"><use href="#w-plus"/></svg>New Dental Case<kbd>N</kbd></a></li>
          <li><a href="/workspace/recent" data-nav="recent"><svg class="ico"><use href="#w-clock"/></svg>Recent Cases</a></li>
          <li><a href="/workspace/designs" data-nav="designs"><svg class="ico"><use href="#w-tooth"/></svg>My Designs</a></li>
          <li><a href="/workspace/shared" data-nav="shared"><svg class="ico"><use href="#w-share"/></svg>Shared with Me</a></li>
          <li><a href="/workspace/archived" data-nav="archived"><svg class="ico"><use href="#w-archive"/></svg>Archived<span class="side-count" id="count-archived"></span></a></li>
        </ul>
      </nav>
      <div class="side-foot">
        <div class="storage" id="storage">
          <div class="storage-row"><span>Browser storage</span><span id="storage-text">—</span></div>
          <div class="meter" aria-hidden="true"><span id="storage-bar"></span></div>
        </div>
        <p class="side-note">Preview build · manual design tools run in this browser. AI analysis is not connected yet.</p>
      </div>
    </aside>
    <div class="scrim" id="scrim" hidden></div>

    <main id="view" class="view" tabindex="-1" aria-live="polite"></main>
  </div>

  <nav class="tabbar" aria-label="Primary">
    <a href="/workspace" data-nav="dashboard"><svg class="ico"><use href="#w-dashboard"/></svg>Home</a>
    <a href="/workspace/cases" data-nav="cases"><svg class="ico"><use href="#w-folder"/></svg>Cases</a>
    <a href="/workspace/cases/new" data-nav="new" class="tab-new"><svg class="ico"><use href="#w-plus"/></svg>New</a>
    <a href="/workspace/activity" data-nav="activity"><svg class="ico"><use href="#w-activity"/></svg>Activity</a>
  </nav>

  <dialog class="dialog" id="confirm-dialog" aria-labelledby="confirm-title">
    <form method="dialog">
      <h2 id="confirm-title">Confirm</h2>
      <p id="confirm-body"></p>
      <label class="field confirm-type" id="confirm-type-wrap" hidden>
        <span id="confirm-type-label">Type to confirm</span>
        <input id="confirm-type" autocomplete="off">
      </label>
      <div class="dialog-actions">
        <button class="btn btn-quiet" value="cancel" type="submit">Cancel</button>
        <button class="btn btn-danger" value="ok" type="submit" id="confirm-ok">Confirm</button>
      </div>
    </form>
  </dialog>

  <dialog class="dialog" id="shortcuts-dialog" aria-labelledby="shortcuts-title">
    <form method="dialog">
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <dl class="shortcuts">
        <div><dt><kbd>N</kbd></dt><dd>New dental case</dd></div>
        <div><dt><kbd>/</kbd></dt><dd>Search cases</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>Show shortcuts</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>Close menus and dialogs</dd></div>
        <div class="shortcuts-sep"><dt>3D viewer</dt><dd></dd></div>
        <div><dt><kbd>F</kbd></dt><dd>Fit model to view</dd></div>
        <div><dt><kbd>R</kbd></dt><dd>Reset camera</dd></div>
        <div><dt><kbd>W</kbd></dt><dd>Toggle wireframe</dd></div>
        <div><dt><kbd>G</kbd></dt><dd>Toggle grid</dd></div>
        <div><dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt><dd>Toggle upper jaw, lower jaw, restoration</dd></div>
        <div><dt>Drag · Right-drag · Wheel</dt><dd>Rotate · Pan · Zoom</dd></div>
        <div class="shortcuts-sep"><dt>Design tools</dt><dd></dd></div>
        <div><dt><kbd>Q</kbd> <kbd>T</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>M</kbd> <kbd>O</kbd></dt><dd>Teeth, Move, Anatomy, Sculpt, Margin, Occlusion</dd></div>
        <div><dt><kbd>C</kbd> <kbd>D</kbd> <kbd>B</kbd> <kbd>E</kbd> <kbd>V</kbd></dt><dd>Contacts, Crown, Bridge, Measure, View</dd></div>
        <div><dt><kbd>Y</kbd> <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd></dt><dd>Brush: add, remove, smooth, flatten</dd></div>
        <div><dt><kbd>L</kbd> <kbd>U</kbd> <kbd>I</kbd> <kbd>P</kbd></dt><dd>Brush: grab, ridge, groove, restore</dd></div>
        <div><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Brush radius (with Shift: strength)</dd></div>
        <div><dt><kbd>Ctrl Z</kbd> · <kbd>Ctrl Shift Z</kbd></dt><dd>Undo · Redo</dd></div>
        <div><dt><kbd>X</kbd></dt><dd>Show original design / edited</dd></div>
        <div><dt><kbd>Ctrl E</kbd> · <kbd>Ctrl S</kbd></dt><dd>Export STL · Save now</dd></div>
        <div><dt>Arrows · Page Up/Down</dt><dd>Nudge in Move (Shift for finer)</dd></div>
        <div><dt><kbd>Enter</kbd> · <kbd>Delete</kbd> · <kbd>Esc</kbd></dt><dd>Margin: close line, delete point (last point while marking), cancel</dd></div>
      </dl>
      <div class="dialog-actions"><button class="btn btn-primary" type="submit">Done</button></div>
    </form>
  </dialog>

  <div class="toasts" id="toasts" role="status" aria-live="polite"></div>

  
  `;
