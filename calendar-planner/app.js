/* Calendar Planner
 * Month grid with a status and an optional note per day, bulk selection,
 * persisted to localStorage. No dependencies.
 */
(function () {
  "use strict";

  /* ---------- constants ---------- */

  // v2 stores { s: status, n: note } per day; v1 stored a bare status string
  var STORAGE_KEY = "calendar-planner.v2";
  var LEGACY_KEY  = "calendar-planner.v1";
  var NOTE_MAX    = 500;

  var STATUSES = [
    { key: "off",     label: "Off",     color: "#e2e5ea" },
    { key: "holiday", label: "Holiday", color: "#ffd8a8" },
    { key: "leave",   label: "Leave",   color: "#ffc9c9" },
    { key: "wfh",     label: "WFH",     color: "#c3e0ff" },
    { key: "office",  label: "Office",  color: "#c6f0d2" }
  ];

  var MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

  /* ---------- elements ---------- */

  var yearSel  = document.getElementById("year");
  var monthSel = document.getElementById("month");
  var grid     = document.getElementById("grid");
  var menu     = document.getElementById("menu");
  var legendEl = document.getElementById("legend");
  var sumEl    = document.getElementById("summary");
  var bulkBtn  = document.getElementById("bulk");
  var selBar   = document.getElementById("selbar");
  var hintEl   = document.getElementById("hint");

  /* ---------- state ---------- */

  var today = new Date();
  var view = { y: today.getFullYear(), m: today.getMonth() };
  var data = load();

  var menuKeys = [];         // the days the open menu will act on
  var menuMode = "status";   // "status" | "note"
  var bulkMode = false;
  var selection = {};        // dayKey -> true
  var anchorKey = null;      // last plain-clicked day, origin for shift-range

  /* ---------- storage ---------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) raw = localStorage.getItem(LEGACY_KEY); // migrate old saves
      var obj = raw ? JSON.parse(raw) : {};
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
      return normalize(obj);
    } catch (e) {
      return {};
    }
  }

  // accepts both the v1 ("wfh") and v2 ({s,n}) shapes, drops anything unrecognised
  function normalize(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      var v = obj[k];
      var e = {};

      if (typeof v === "string") {
        if (statusOf(v)) e.s = v;
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        if (typeof v.s === "string" && statusOf(v.s)) e.s = v.s;
        if (typeof v.n === "string" && v.n.trim()) e.n = v.n.trim().slice(0, NOTE_MAX);
      }

      if (e.s || e.n) out[k] = e;
    });
    return out;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      /* storage unavailable (private mode / quota) - keep working in memory */
    }
  }

  /* ---------- helpers ---------- */

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }

  function statusOf(key) {
    for (var i = 0; i < STATUSES.length; i++) {
      if (STATUSES[i].key === key) return STATUSES[i];
    }
    return null;
  }

  function parseKey(k) {
    var p = k.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  /* ---------- day entries ---------- */

  function entryOf(key) {
    var e = data[key];
    return (e && typeof e === "object") ? e : null;
  }

  function statusKeyOf(key) {
    var e = entryOf(key);
    return e && e.s ? e.s : "";
  }

  function noteOf(key) {
    var e = entryOf(key);
    return e && e.n ? e.n : "";
  }

  // writes status and/or note, removing the day entirely once both are empty
  function writeDay(key, status, note) {
    var e = {};
    if (status) e.s = status;
    if (note) e.n = note;
    if (e.s || e.n) data[key] = e;
    else delete data[key];
  }

  function setStatus(keys, status) {
    keys.forEach(function (k) { writeDay(k, status, noteOf(k)); });
    save();
    render();
  }

  function setNote(keys, note) {
    keys.forEach(function (k) { writeDay(k, statusKeyOf(k), note); });
    save();
    render();
  }

  /* ---------- year / month selectors ---------- */

  function buildSelectors() {
    var base = today.getFullYear();
    var html = "";
    for (var y = base - 10; y <= base + 10; y++) {
      html += '<option value="' + y + '">' + y + "</option>";
    }
    yearSel.innerHTML = html;

    html = "";
    for (var m = 0; m < 12; m++) {
      html += '<option value="' + m + '">' + MONTHS[m] + "</option>";
    }
    monthSel.innerHTML = html;
  }

  function syncSelectors() {
    // keep the year list valid even if navigation runs past its edges
    if (!yearSel.querySelector('option[value="' + view.y + '"]')) {
      var opt = document.createElement("option");
      opt.value = String(view.y);
      opt.textContent = String(view.y);
      yearSel.appendChild(opt);
      sortYearOptions();
    }
    yearSel.value = String(view.y);
    monthSel.value = String(view.m);
  }

  function sortYearOptions() {
    var opts = Array.prototype.slice.call(yearSel.options);
    opts.sort(function (a, b) { return Number(a.value) - Number(b.value); });
    opts.forEach(function (o) { yearSel.appendChild(o); });
  }

  /* ---------- rendering ---------- */

  function render() {
    syncSelectors();
    closeMenu();

    var first = new Date(view.y, view.m, 1);
    var lead = (first.getDay() + 6) % 7;            // Monday-first offset
    var total = new Date(view.y, view.m + 1, 0).getDate();

    var frag = document.createDocumentFragment();

    for (var i = 0; i < lead; i++) {
      var blank = document.createElement("div");
      blank.className = "day empty";
      blank.setAttribute("aria-hidden", "true");
      frag.appendChild(blank);
    }

    for (var d = 1; d <= total; d++) {
      var key = dayKey(view.y, view.m, d);
      var st = statusOf(statusKeyOf(key));
      var note = noteOf(key);
      var dow = new Date(view.y, view.m, d).getDay();

      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day" + (dow === 0 || dow === 6 ? " weekend" : "");
      cell.dataset.key = key;
      if (st) cell.dataset.status = st.key;
      if (selection[key]) cell.classList.add("sel");
      if (view.y === today.getFullYear() && view.m === today.getMonth() && d === today.getDate()) {
        cell.classList.add("today");
      }

      var num = document.createElement("span");
      num.className = "num";
      num.textContent = String(d);
      cell.appendChild(num);

      if (note) {
        var dot = document.createElement("span");
        dot.className = "dot";
        cell.appendChild(dot);

        var noteEl = document.createElement("span");
        noteEl.className = "note";
        noteEl.textContent = note;    // textContent, so a note can never inject markup
        cell.appendChild(noteEl);
        cell.title = note;
      }

      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = st ? st.label : "";
      cell.appendChild(tag);

      cell.setAttribute("aria-label",
        MONTHS[view.m] + " " + d + ", " + view.y +
        (st ? " - " + st.label : " - no status") +
        (note ? " - note: " + note : "") +
        (selection[key] ? " - selected" : ""));
      cell.setAttribute("aria-pressed", selection[key] ? "true" : "false");

      frag.appendChild(cell);
    }

    grid.innerHTML = "";
    grid.appendChild(frag);

    renderSummary(total);
    renderSelBar();
  }

  function renderLegend() {
    var html = "";
    STATUSES.forEach(function (s) {
      html += '<span><i style="background:' + s.color + '"></i>' + s.label + "</span>";
    });
    legendEl.innerHTML = html;
  }

  function renderSummary(total) {
    var counts = {};
    var notes = 0;

    for (var d = 1; d <= total; d++) {
      var key = dayKey(view.y, view.m, d);
      var v = statusKeyOf(key);
      if (v) counts[v] = (counts[v] || 0) + 1;
      if (noteOf(key)) notes++;
    }

    var parts = [];
    STATUSES.forEach(function (s) {
      if (counts[s.key]) {
        parts.push('<span><i style="background:' + s.color + '"></i>' +
                   s.label + " <b>" + counts[s.key] + "</b></span>");
      }
    });
    if (notes) parts.push("<span>Notes <b>" + notes + "</b></span>");

    sumEl.innerHTML = parts.length
      ? parts.join("")
      : '<span class="none">No days marked this month.</span>';
  }

  function renderHint() {
    hintEl.innerHTML = bulkMode
      ? "Bulk select is <b>on</b>: click days to toggle, shift-click for a range. " +
        "Then apply a status from the bar below, or right-click the selection."
      : "Right-click (or long-press on touch) a date to set its status or add a note. " +
        "Shift-click a date to start a bulk selection.";
  }

  /* ---------- selection ---------- */

  function selectedKeys() {
    return Object.keys(selection).sort();
  }

  function selectionCount() {
    return selectedKeys().length;
  }

  function clearSelection() {
    selection = {};
    anchorKey = null;
  }

  function selectRange(a, b) {
    var d1 = parseKey(a), d2 = parseKey(b);
    if (d1 > d2) { var t = d1; d1 = d2; d2 = t; }
    var cur = new Date(d1.getTime());
    while (cur <= d2) {
      selection[dayKey(cur.getFullYear(), cur.getMonth(), cur.getDate())] = true;
      cur.setDate(cur.getDate() + 1);
    }
  }

  // these replace the selection rather than adding to it, so each button is predictable
  function selectMonth(which) {
    clearSelection();
    var total = new Date(view.y, view.m + 1, 0).getDate();
    for (var d = 1; d <= total; d++) {
      var dow = new Date(view.y, view.m, d).getDay();
      var weekend = (dow === 0 || dow === 6);
      if (which === "all" ||
          (which === "weekdays" && !weekend) ||
          (which === "weekends" && weekend)) {
        selection[dayKey(view.y, view.m, d)] = true;
      }
    }
  }

  function applyBulkMode() {
    bulkBtn.setAttribute("aria-pressed", bulkMode ? "true" : "false");
    bulkBtn.textContent = "Bulk select: " + (bulkMode ? "On" : "Off");
    document.body.classList.toggle("bulk", bulkMode);
    renderHint();
  }

  function setBulkMode(on) {
    bulkMode = !!on;
    if (!bulkMode) clearSelection();
    applyBulkMode();
    render();
  }

  function buildSelBar() {
    var html = '<span class="cnt" id="selcnt">0 days selected</span>' +
               '<span class="sep"></span><span class="grp">';

    STATUSES.forEach(function (s) {
      html += '<button type="button" data-bulk="' + s.key + '">' +
              '<span class="sw" style="background:' + s.color + '"></span>' + s.label + "</button>";
    });

    html += '</span><span class="sep"></span><span class="grp">' +
              '<button type="button" data-bulk="">Clear status</button>' +
              '<button type="button" data-act="note">Note&hellip;</button>' +
            '</span><span class="sep"></span><span class="grp">' +
              '<button type="button" data-sel="all">All</button>' +
              '<button type="button" data-sel="weekdays">Weekdays</button>' +
              '<button type="button" data-sel="weekends">Weekends</button>' +
              '<button type="button" data-sel="none">Deselect</button>' +
            "</span>";

    selBar.innerHTML = html;
  }

  function renderSelBar() {
    var n = selectionCount();
    selBar.classList.toggle("show", bulkMode);

    var cnt = document.getElementById("selcnt");
    if (cnt) cnt.textContent = n + (n === 1 ? " day selected" : " days selected");

    // status / note actions only make sense with something selected
    Array.prototype.forEach.call(selBar.querySelectorAll("[data-bulk],[data-act]"), function (b) {
      b.disabled = (n === 0);
    });
  }

  /* ---------- context menu ---------- */

  function menuLabel() {
    if (menuKeys.length === 1) {
      var d = parseKey(menuKeys[0]);
      return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getFullYear();
    }
    return menuKeys.length + " days selected";
  }

  function buildStatusView() {
    var html = '<div class="mhead">' + menuLabel() + "</div>";

    STATUSES.forEach(function (s) {
      html += '<button class="mi" type="button" role="menuitem" data-set="' + s.key + '">' +
              '<span class="sw" style="background:' + s.color + '"></span>' + s.label + "</button>";
    });

    html += "<hr>";

    var hasNote = menuKeys.some(function (k) { return !!noteOf(k); });
    html += '<button class="mi" type="button" role="menuitem" data-act="note">' +
            '<span class="sw" style="background:#f08c00"></span>' +
            (hasNote ? "Edit note" : "Add note") + "&hellip;</button>";
    html += '<button class="mi" type="button" role="menuitem" data-set="">' +
            '<span class="sw" style="background:#fff"></span>Clear status</button>';

    menu.innerHTML = html;
  }

  function buildNoteView() {
    // prefill only when every target day already shares the same note
    var notes = menuKeys.map(noteOf);
    var common = notes.every(function (n) { return n === notes[0]; }) ? notes[0] : "";

    menu.innerHTML =
      '<div class="mhead">Note &middot; ' + menuLabel() + "</div>" +
      '<div class="note-wrap">' +
        '<textarea id="noteText" maxlength="' + NOTE_MAX + '" ' +
          'placeholder="e.g. Team offsite, half day, client visit"></textarea>' +
        '<div class="chars" id="noteChars"></div>' +
        '<div class="mrow">' +
          '<button type="button" class="primary" data-act="note-save">Save</button>' +
          '<button type="button" data-act="note-clear">Remove</button>' +
          '<button type="button" data-act="back">Back</button>' +
        "</div>" +
      "</div>";

    var ta = document.getElementById("noteText");
    ta.value = common;
    if (!common && menuKeys.length > 1) {
      ta.placeholder = "Applies to all " + menuKeys.length + " selected days";
    }

    var chars = document.getElementById("noteChars");
    function count() { chars.textContent = ta.value.length + " / " + NOTE_MAX; }
    ta.addEventListener("input", count);
    count();

    // Enter saves, Shift+Enter starts a new line
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitNote();
      }
    });

    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function commitNote() {
    var ta = document.getElementById("noteText");
    if (!ta) return;
    setNote(menuKeys.slice(), ta.value.trim().slice(0, NOTE_MAX));
  }

  function renderMenu() {
    if (menuMode === "note") buildNoteView();
    else buildStatusView();
  }

  function focusMenu() {
    var target = menu.querySelector(menuMode === "note" ? "textarea" : ".mi");
    if (target) target.focus();
  }

  function openMenu(x, y, keys, mode) {
    menuKeys = keys;
    menuMode = mode || "status";
    renderMenu();

    // place first so nothing flashes at the document flow position,
    // then measure and clamp inside the viewport
    menu.style.left = (x + window.scrollX) + "px";
    menu.style.top  = (y + window.scrollY) + "px";
    menu.classList.add("open");

    var r = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth  - r.width  - 8);
    var top  = Math.min(y, window.innerHeight - r.height - 8);

    menu.style.left = Math.max(8, left) + window.scrollX + "px";
    menu.style.top  = Math.max(8, top)  + window.scrollY + "px";

    focusMenu();   // only works once the menu is actually visible
  }

  // swap between the status list and the note editor without moving the menu
  function switchMenu(mode) {
    if (!menu.classList.contains("open")) return;
    menuMode = mode;
    renderMenu();
    focusMenu();
  }

  function closeMenu() {
    menu.classList.remove("open");
    menuKeys = [];
    menuMode = "status";
  }

  /* ---------- events ---------- */

  // which days should an action on this cell apply to?
  // the whole selection if the cell is part of it, otherwise just that cell
  function targetsFor(key) {
    return (bulkMode && selection[key] && selectionCount() > 0) ? selectedKeys() : [key];
  }

  function toggle(key) {
    if (selection[key]) delete selection[key];
    else selection[key] = true;
    anchorKey = key;
  }

  grid.addEventListener("contextmenu", function (e) {
    var cell = e.target.closest(".day");
    if (!cell || !cell.dataset.key) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, targetsFor(cell.dataset.key));
  });

  grid.addEventListener("click", function (e) {
    var cell = e.target.closest(".day");
    if (!cell || !cell.dataset.key) return;
    var key = cell.dataset.key;

    // shift-click starts a bulk selection even when the mode is off
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      if (!bulkMode) { bulkMode = true; applyBulkMode(); }
      if (e.shiftKey && anchorKey) selectRange(anchorKey, key);
      else toggle(key);
      closeMenu();
      render();
      return;
    }

    if (bulkMode) {
      toggle(key);
      closeMenu();
      render();
      return;
    }

    // normal mode: left-click / Enter / Space opens the same menu as right-click
    var r = cell.getBoundingClientRect();
    openMenu(r.left, r.bottom + 2, [key]);
  });

  // long-press opens the menu on touch devices
  var pressTimer = null;

  grid.addEventListener("touchstart", function (e) {
    var cell = e.target.closest(".day");
    if (!cell || !cell.dataset.key) return;
    var t = e.touches[0];
    pressTimer = setTimeout(function () {
      pressTimer = null;
      openMenu(t.clientX, t.clientY, targetsFor(cell.dataset.key));
    }, 450);
  }, { passive: true });

  ["touchend", "touchmove", "touchcancel"].forEach(function (evt) {
    grid.addEventListener(evt, function () {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }, { passive: true });
  });

  menu.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn || !menuKeys.length) return;

    switch (btn.dataset.act) {
      case "note":       switchMenu("note"); return;
      case "back":       switchMenu("status"); return;
      case "note-save":  commitNote(); return;
      case "note-clear": setNote(menuKeys.slice(), ""); return;
    }

    if (typeof btn.dataset.set === "string") setStatus(menuKeys.slice(), btn.dataset.set);
  });

  selBar.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;

    if (btn.dataset.sel) {
      if (btn.dataset.sel === "none") clearSelection();
      else selectMonth(btn.dataset.sel);
      render();
      return;
    }

    var keys = selectedKeys();
    if (!keys.length) return;

    if (btn.dataset.act === "note") {
      var r = btn.getBoundingClientRect();
      openMenu(r.left, r.bottom + 2, keys, "note");
      return;
    }

    if (typeof btn.dataset.bulk === "string") setStatus(keys, btn.dataset.bulk);
  });

  bulkBtn.addEventListener("click", function () {
    setBulkMode(!bulkMode);
  });

  document.addEventListener("mousedown", function (e) {
    if (menu.classList.contains("open") && !menu.contains(e.target)) closeMenu();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    // Esc backs out of the menu first, then drops the selection
    if (menu.classList.contains("open")) closeMenu();
    else if (selectionCount()) { clearSelection(); render(); }
  });

  // don't reposition a stale menu; a note in progress would be lost
  window.addEventListener("resize", closeMenu);

  yearSel.addEventListener("change", function () {
    view.y = Number(yearSel.value);
    render();
  });

  monthSel.addEventListener("change", function () {
    view.m = Number(monthSel.value);
    render();
  });

  document.getElementById("prev").addEventListener("click", function () { shift(-1); });
  document.getElementById("next").addEventListener("click", function () { shift(1); });

  document.getElementById("today").addEventListener("click", function () {
    view.y = today.getFullYear();
    view.m = today.getMonth();
    render();
  });

  document.getElementById("clear").addEventListener("click", function () {
    var label = MONTHS[view.m] + " " + view.y;
    if (!window.confirm("Clear all statuses and notes in " + label + "?")) return;
    var total = new Date(view.y, view.m + 1, 0).getDate();
    for (var d = 1; d <= total; d++) delete data[dayKey(view.y, view.m, d)];
    save();
    render();
  });

  function shift(delta) {
    var m = view.m + delta;
    view.y += Math.floor(m / 12);
    view.m = ((m % 12) + 12) % 12;
    render();
  }

  /* ---------- init ---------- */

  buildSelectors();
  buildSelBar();
  renderLegend();
  renderHint();
  render();
})();
