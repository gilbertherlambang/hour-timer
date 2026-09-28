const STORAGE_KEYS = {
  active: "timerapp.active",
  history: "timerapp.history",
  names: "timerapp.names",
};

const minutesInput = document.getElementById("timer-minutes");
const startBtn = document.getElementById("start-btn");
const quickNames = document.getElementById("quick-names");
const activeGroups = document.getElementById("active-groups");
const activeEmpty = document.getElementById("active-empty");
const historyFilters = document.getElementById("history-filters");
const historyGroups = document.getElementById("history-groups");
const historyEmpty = document.getElementById("history-empty");
const HISTORY_PAGE_SIZE = 4;
const clearHistoryBtn = document.getElementById("clear-history-btn");
const toast = document.getElementById("toast");
const alarmSound = document.getElementById("alarm-sound");

let activeTimers = loadJSON(STORAGE_KEYS.active, []);
let history = loadJSON(STORAGE_KEYS.history, []);
let savedNames = loadJSON(STORAGE_KEYS.names, ["BB", "Hellodev"]);
let selectedName = savedNames[0] || null;
let historyFilter = "today";
let expandedGroups = new Set();
let toastTimeout = null;

if (window.Notification && Notification.permission === "default") {
  Notification.requestPermission();
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveActive() {
  localStorage.setItem(STORAGE_KEYS.active, JSON.stringify(activeTimers));
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
}

function saveNames() {
  localStorage.setItem(STORAGE_KEYS.names, JSON.stringify(savedNames));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isToday(ts) {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatDuration(minutes) {
  const rounded = Math.round(minutes);
  if (rounded % 60 === 0) {
    const h = rounded / 60;
    return `${h} hr${h !== 1 ? "s" : ""}`;
  }
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${h}h ${m}m`;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

function notify(name) {
  showToast(`"${name}" timer finished!`);
  try {
    alarmSound.currentTime = 0;
    alarmSound.play().catch(() => {});
  } catch (e) {}
  if (window.Notification && Notification.permission === "granted") {
    new Notification("Timer finished", { body: `"${name}" is done.` });
  }
}

// --- Saved names (the only way to pick a timer's name — no free-text field) ---

function addName() {
  const name = (window.prompt("New timer name:") || "").trim();
  if (!name) return;
  if (!savedNames.includes(name)) {
    savedNames.push(name);
    saveNames();
  }
  selectedName = name;
  render();
}

function renderQuickNames() {
  quickNames.innerHTML = "";

  savedNames.forEach((name) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    if (selectedName === name) chip.classList.add("active");

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "chip-btn";
    selectBtn.textContent = name;
    selectBtn.addEventListener("click", () => {
      selectedName = name;
      render();
    });
    chip.appendChild(selectBtn);

    quickNames.appendChild(chip);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "chip-add";
  addBtn.textContent = "+ Add name";
  addBtn.addEventListener("click", addName);
  quickNames.appendChild(addBtn);
}

// --- Timer lifecycle ---

function startTimer(name, minutes) {
  const now = Date.now();
  const timer = {
    id: uid(),
    name,
    durationMinutes: minutes,
    startedAt: now,
    endsAt: now + minutes * 60 * 1000,
    paused: false,
    remainingMs: null,
  };
  activeTimers.push(timer);
  saveActive();
  render();
}

function pauseTimer(id) {
  const timer = activeTimers.find((t) => t.id === id);
  if (!timer || timer.paused) return;
  timer.remainingMs = Math.max(0, timer.endsAt - Date.now());
  timer.paused = true;
  saveActive();
  render();
}

function resumeTimer(id) {
  const timer = activeTimers.find((t) => t.id === id);
  if (!timer || !timer.paused) return;
  timer.endsAt = Date.now() + timer.remainingMs;
  timer.paused = false;
  timer.remainingMs = null;
  saveActive();
  render();
}

function finishTimer(id, status) {
  const idx = activeTimers.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const timer = activeTimers[idx];
  activeTimers.splice(idx, 1);
  saveActive();

  history.unshift({
    id: timer.id,
    name: timer.name,
    durationMinutes: timer.durationMinutes,
    startedAt: timer.startedAt,
    endedAt: Date.now(),
    status,
  });
  saveHistory();
  return timer;
}

function cancelTimer(id) {
  finishTimer(id, "stopped");
  render();
}

function completeTimer(id) {
  const timer = finishTimer(id, "completed");
  render();
  if (timer) notify(timer.name);
}

function markDoneTimer(id) {
  finishTimer(id, "completed");
  render();
}

// --- Grouping helper ---

function groupByName(items) {
  const map = new Map();
  items.forEach((item) => {
    if (!map.has(item.name)) map.set(item.name, []);
    map.get(item.name).push(item);
  });
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

// --- Rendering ---

function buildTimerCard(timer) {
  const li = document.createElement("li");
  li.className = "timer-card";
  li.dataset.id = timer.id;

  const remaining = timer.paused ? timer.remainingMs : timer.endsAt - Date.now();

  const info = document.createElement("div");
  info.className = "timer-info";
  const metaEl = document.createElement("div");
  metaEl.className = "timer-meta";
  metaEl.textContent = `${formatDuration(timer.durationMinutes)} · started ${formatDateTime(timer.startedAt)}`;
  info.appendChild(metaEl);

  const clock = document.createElement("div");
  clock.className = "timer-clock";
  if (timer.paused) {
    clock.classList.add("paused");
  } else if (remaining <= 60000) {
    clock.classList.add("urgent");
  } else if (remaining <= 5 * 60000) {
    clock.classList.add("warning");
  }
  clock.textContent = formatClock(remaining);
  if (timer.paused) {
    const badge = document.createElement("span");
    badge.className = "pause-badge";
    badge.textContent = "Paused";
    clock.appendChild(badge);
  }

  const actions = document.createElement("div");
  actions.className = "timer-actions";

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "icon-btn";
  pauseBtn.textContent = timer.paused ? "Resume" : "Pause";
  pauseBtn.addEventListener("click", () => {
    if (timer.paused) resumeTimer(timer.id);
    else pauseTimer(timer.id);
  });
  actions.appendChild(pauseBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "icon-btn danger";
  cancelBtn.textContent = "Stop";
  cancelBtn.addEventListener("click", () => cancelTimer(timer.id));
  actions.appendChild(cancelBtn);

  const doneBtn = document.createElement("button");
  doneBtn.className = "icon-btn success";
  doneBtn.textContent = "Done";
  doneBtn.title = "Mark as completed without waiting for the countdown";
  doneBtn.addEventListener("click", () => markDoneTimer(timer.id));
  actions.appendChild(doneBtn);

  li.appendChild(info);
  li.appendChild(clock);
  li.appendChild(actions);
  return li;
}

function renderActive() {
  activeGroups.innerHTML = "";
  activeEmpty.hidden = activeTimers.length > 0;

  const groups = groupByName(activeTimers);
  groups.forEach(([name, timers]) => {
    const block = document.createElement("div");
    block.className = "group-block";

    const header = document.createElement("div");
    header.className = "group-header";
    const title = document.createElement("div");
    title.className = "group-title";
    title.textContent = name;
    const summary = document.createElement("div");
    summary.className = "group-summary";
    const runningCount = timers.filter((t) => !t.paused).length;
    const pausedCount = timers.length - runningCount;
    summary.textContent =
      timers.length === 1
        ? pausedCount ? "paused" : "running"
        : `${runningCount} running${pausedCount ? `, ${pausedCount} paused` : ""}`;
    header.appendChild(title);
    header.appendChild(summary);

    const list = document.createElement("ul");
    list.className = "active-list";
    timers.forEach((timer) => list.appendChild(buildTimerCard(timer)));

    block.appendChild(header);
    block.appendChild(list);
    activeGroups.appendChild(block);
  });
}

function buildHistoryTable(entries) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Duration</th><th>Started</th><th>Ended</th><th>Status</th></tr>";
  const tbody = document.createElement("tbody");

  entries.forEach((entry) => {
    const tr = document.createElement("tr");

    const durationTd = document.createElement("td");
    durationTd.textContent = formatDuration(entry.durationMinutes);

    const startedTd = document.createElement("td");
    startedTd.textContent = formatDateTime(entry.startedAt);

    const endedTd = document.createElement("td");
    endedTd.textContent = formatDateTime(entry.endedAt);

    const statusTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${entry.status === "completed" ? "status-completed" : "status-stopped"}`;
    badge.textContent = entry.status === "completed" ? "Completed" : "Stopped early";
    statusTd.appendChild(badge);

    tr.appendChild(durationTd);
    tr.appendChild(startedTd);
    tr.appendChild(endedTd);
    tr.appendChild(statusTd);
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

function renderHistoryFilters() {
  historyFilters.innerHTML = "";
  [
    ["today", "Today"],
    ["all", "All"],
  ].forEach(([value, label]) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "filter-tab";
    if (historyFilter === value) tab.classList.add("active");
    tab.textContent = label;
    tab.addEventListener("click", () => {
      if (historyFilter === value) return;
      historyFilter = value;
      expandedGroups.clear();
      renderHistory();
    });
    historyFilters.appendChild(tab);
  });
}

function renderHistory() {
  renderHistoryFilters();

  historyGroups.innerHTML = "";
  const visibleHistory = historyFilter === "today" ? history.filter((e) => isToday(e.startedAt)) : history;
  historyEmpty.hidden = visibleHistory.length > 0;
  historyEmpty.textContent =
    historyFilter === "today" && history.length > 0 ? "No timers today yet." : "No completed timers yet.";

  const groups = groupByName(visibleHistory);
  groups.forEach(([name, entries]) => {
    const completedCount = entries.filter((e) => e.status === "completed").length;
    const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);

    const block = document.createElement("div");
    block.className = "group-block";

    const header = document.createElement("div");
    header.className = "group-header";
    const title = document.createElement("div");
    title.className = "group-title";
    title.textContent = name;
    const summary = document.createElement("div");
    summary.className = "group-summary";
    summary.textContent = `${entries.length} session${entries.length !== 1 ? "s" : ""} · ${completedCount} completed · ${formatDuration(totalMinutes)} total`;
    header.appendChild(title);
    header.appendChild(summary);

    const expanded = expandedGroups.has(name);
    const visibleEntries = expanded ? entries : entries.slice(0, HISTORY_PAGE_SIZE);

    block.appendChild(header);
    block.appendChild(buildHistoryTable(visibleEntries));

    if (entries.length > HISTORY_PAGE_SIZE) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "see-more-btn";
      toggleBtn.textContent = expanded ? "Show less" : `See more (${entries.length - HISTORY_PAGE_SIZE})`;
      toggleBtn.addEventListener("click", () => {
        if (expanded) expandedGroups.delete(name);
        else expandedGroups.add(name);
        renderHistory();
      });
      block.appendChild(toggleBtn);
    }

    historyGroups.appendChild(block);
  });
}

function render() {
  renderQuickNames();
  renderActive();
  renderHistory();
}

function tick() {
  let changed = false;
  activeTimers.slice().forEach((timer) => {
    if (!timer.paused && Date.now() >= timer.endsAt) {
      completeTimer(timer.id);
      changed = true;
    }
  });
  if (!changed) renderActive();
}

startBtn.addEventListener("click", () => {
  if (!selectedName) {
    showToast("Add a name first");
    return;
  }
  const minutes = Math.max(1, Math.min(600, parseInt(minutesInput.value, 10) || 60));
  startTimer(selectedName, minutes);
  minutesInput.value = "60";
});

clearHistoryBtn.addEventListener("click", () => {
  if (history.length === 0) return;
  if (confirm("Clear all timer history? This can't be undone.")) {
    history = [];
    saveHistory();
    render();
  }
});

render();
setInterval(tick, 1000);
