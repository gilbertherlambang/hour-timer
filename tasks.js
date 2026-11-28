// --- Tabs ---

const TASKS_KEY = "timerapp.board";
const tabButtons = document.querySelectorAll(".tab");
const views = { timer: document.getElementById("view-timer"), tasks: document.getElementById("view-tasks") };
const taskBoard = document.getElementById("task-board");

function setTab(name) {
  tabButtons.forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  Object.entries(views).forEach(([key, el]) => (el.hidden = key !== name));
  try {
    localStorage.setItem("timerapp.tab", name);
  } catch (e) {}
}

tabButtons.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

// --- Task data: lists of tasks, one level of subtasks (parentId) ---

function newList(name) {
  return { id: uid(), name, tasks: [], showCompleted: false };
}

function newSection(name) {
  return { id: uid(), name, collapsed: false, lists: [newList("To do")] };
}

let sections = loadJSON(TASKS_KEY, null) || [newSection("This month"), newSection("This week")];
let editor = null; // { listId, taskId, parentId } while an add/edit form is open
let openMenuId = null;

function saveTasks() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(sections));
}

// New top-level tasks go to the top of the list; subtasks are added after their siblings
function addTask(list, title, notes, parentId, today) {
  const task = { id: uid(), title, notes, today: !!today, done: false, parentId: parentId || null, createdAt: Date.now() };
  if (parentId) list.tasks.push(task);
  else list.tasks.unshift(task);
}

function fireIcon() {
  const span = el("span", "fire-icon");
  span.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';
  return span;
}

function setDone(list, task, done) {
  const affected = [task, ...list.tasks.filter((t) => t.parentId === task.id)];
  affected.forEach((t) => {
    t.done = done;
    t.completedAt = done ? Date.now() : null;
  });
  // Un-completing a subtask brings its parent back too
  if (!done && task.parentId) {
    const parent = list.tasks.find((t) => t.id === task.parentId);
    if (parent) parent.done = false;
  }
}

// --- Drag to reorder (within a list, or onto another list) ---

let dragState = null; // { taskId, listId }

function findListById(id) {
  for (const s of sections) {
    const l = s.lists.find((x) => x.id === id);
    if (l) return l;
  }
  return null;
}

function clearDropMarks() {
  document
    .querySelectorAll(".drop-before, .drop-after, .drop-card-before, .drop-card-after")
    .forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-wide", "drop-card-before", "drop-card-after"));
}

// --- Drag a list card: reorder within a section or move to the other section ---

let listDrag = null; // { listId }

function findSectionOfList(id) {
  return sections.find((s) => s.lists.some((l) => l.id === id)) || null;
}

// Move a list next to targetId in toSection; no targetId appends to the end
function moveList(fromSection, listId, toSection, targetId, after) {
  const list = fromSection.lists.find((l) => l.id === listId);
  if (!list || targetId === listId) return;
  fromSection.lists = fromSection.lists.filter((l) => l.id !== listId);
  const idx = targetId ? toSection.lists.findIndex((l) => l.id === targetId) : -1;
  if (idx < 0) toSection.lists.push(list);
  else toSection.lists.splice(idx + (after ? 1 : 0), 0, list);
}

function dropList(toSection, targetId, after) {
  const from = listDrag && findSectionOfList(listDrag.listId);
  if (from) moveList(from, listDrag.listId, toSection, targetId, after);
  listDrag = null;
  clearDropMarks();
  saveTasks();
  renderTasks();
}

function listPercent(list) {
  const total = list.tasks.length;
  const done = list.tasks.filter((t) => t.done).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Move a task next to targetId in toList. A top-level task takes its subtasks along. Dropping next to a
// subtask makes the moved subtask a sibling of it; next to a top-level task makes it top-level. No targetId
// appends to the end as a top-level task.
function moveTask(fromList, taskId, toList, targetId, after) {
  const task = fromList.tasks.find((t) => t.id === taskId);
  if (!task || targetId === taskId) return;
  const children = fromList.tasks.filter((t) => t.parentId === taskId);
  if (children.some((c) => c.id === targetId)) return;
  const group = [task, ...children];
  fromList.tasks = fromList.tasks.filter((t) => !group.includes(t));
  const target = targetId ? toList.tasks.find((t) => t.id === targetId) : null;
  task.parentId = target ? target.parentId : null;
  let index = toList.tasks.length;
  if (target) index = toList.tasks.indexOf(target) + (after ? 1 : 0);
  toList.tasks.splice(index, 0, ...group);
}

function deleteTask(list, task) {
  list.tasks = list.tasks.filter((t) => t.id !== task.id && t.parentId !== task.id);
}

// --- Rendering ---

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconBtn(label, text, onClick) {
  const b = el("button", "task-icon-btn", text);
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function buildEditor(list, task, parentId) {
  const form = el("form", "task-editor" + (parentId || (task && task.parentId) ? " sub" : ""));
  const title = el("input", "task-input");
  title.placeholder = "Title";
  title.value = task ? task.title : "";
  title.maxLength = 200;
  const notes = el("input", "task-input notes");
  notes.placeholder = "Details";
  notes.value = task ? task.notes || "" : "";
  const actions = el("div", "editor-actions");
  const cancel = el("button", "ghost-btn", "Cancel");
  cancel.type = "button";
  const save = el("button", "primary-btn", "Save");
  save.type = "submit";
  actions.append(cancel, save);
  let isToday = !!(task && task.today);
  const fire = el("button", "fire-btn" + (isToday ? " on" : ""));
  fire.type = "button";
  fire.title = "Due today";
  fire.setAttribute("aria-label", "Mark as due today");
  fire.setAttribute("aria-pressed", String(isToday));
  fire.appendChild(fireIcon());
  fire.addEventListener("click", () => {
    isToday = !isToday;
    fire.classList.toggle("on", isToday);
    fire.setAttribute("aria-pressed", String(isToday));
  });
  const titleRow = el("div", "title-row");
  titleRow.append(title, fire);
  form.append(titleRow, notes, actions);

  const close = () => {
    editor = null;
    renderTasks();
  };
  cancel.addEventListener("click", close);
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = title.value.trim();
    if (!t) {
      close();
      return;
    }
    if (task) {
      task.title = t;
      task.notes = notes.value.trim();
      task.today = isToday;
    } else {
      addTask(list, t, notes.value.trim(), parentId, isToday);
    }
    saveTasks();
    editor = null;
    renderTasks();
  });
  setTimeout(() => title.focus(), 0);
  return form;
}

function buildTaskRow(list, task) {
  const row = el("li", "task-row" + (task.parentId ? " sub" : "") + (task.done ? " done" : ""));
  const check = el("button", "task-check");
  check.type = "button";
  check.setAttribute("aria-label", task.done ? "Mark as not completed" : "Mark as completed");
  check.textContent = task.done ? "✓" : "";
  check.addEventListener("click", () => {
    setDone(list, task, !task.done);
    saveTasks();
    renderTasks();
  });

  const body = el("div", "task-body");
  const title = el("div", "task-title", task.title);
  body.appendChild(title);
  if (task.notes) body.appendChild(el("div", "task-notes", task.notes));
  body.addEventListener("click", () => {
    editor = { listId: list.id, taskId: task.id, parentId: null };
    renderTasks();
  });

  const toggleToday = () => {
    task.today = !task.today;
    saveTasks();
    renderTasks();
  };
  let todayBadge = null;
  const actions = el("div", "task-actions");
  if (!task.done) {
    const fire = el("button", "fire-btn" + (task.today ? " on" : ""));
    fire.type = "button";
    fire.title = task.today ? "Remove due today" : "Mark as due today";
    fire.setAttribute("aria-label", fire.title);
    fire.appendChild(fireIcon());
    if (task.today) {
      fire.appendChild(el("span", "fire-label", "Today"));
      todayBadge = fire;
    } else {
      actions.appendChild(fire);
    }
    fire.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleToday();
    });
  }
  if (!task.parentId && !task.done) {
    actions.appendChild(
      iconBtn("Add a subtask", "↳", () => {
        editor = { listId: list.id, taskId: null, parentId: task.id };
        renderTasks();
      })
    );
  }
  actions.appendChild(
    iconBtn("Delete task", "✕", () => {
      deleteTask(list, task);
      saveTasks();
      renderTasks();
    })
  );
  if (todayBadge) body.appendChild(todayBadge);
  row.append(check, body, actions);

  row.dataset.id = task.id;
  if (task.parentId) row.dataset.parent = task.parentId;

  if (!task.done) {
    row.draggable = true;
    const dragged = () => {
      if (!dragState) return null;
      const from = findListById(dragState.listId);
      return from ? { from, task: from.tasks.find((t) => t.id === dragState.taskId) } : null;
    };
    // A task that has subtasks can't become a subtask, so it can only be dropped next to top-level tasks
    const canDropHere = () => {
      const d = dragged();
      if (!d || !d.task || d.task.id === task.id) return false;
      if (task.parentId && d.from.tasks.some((t) => t.parentId === d.task.id)) return false;
      return true;
    };
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      dragState = { taskId: task.id, listId: list.id };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", task.id);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      dragState = null;
      row.classList.remove("dragging");
      clearDropMarks();
    });
    row.addEventListener("dragover", (e) => {
      if (!dragState) return;
      e.stopPropagation();
      if (!canDropHere()) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      clearDropMarks();
      let markRow = row;
      let cls = after ? "drop-after" : "drop-before";
      if (after && !task.parentId) {
        // Below a top-level task its subtasks come first, so draw the full-width line under the last one
        const subs = [...row.parentElement.querySelectorAll(`[data-parent="${task.id}"]`)].filter(
          (r) => !r.classList.contains("dragging")
        );
        if (subs.length) {
          markRow = subs[subs.length - 1];
          cls += " drop-wide";
        }
      }
      cls.split(" ").forEach((c) => markRow.classList.add(c));
    });
    row.addEventListener("drop", (e) => {
      if (!dragState) return;
      e.stopPropagation();
      if (!canDropHere()) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      const from = findListById(dragState.listId);
      if (from) moveTask(from, dragState.taskId, list, task.id, after);
      dragState = null;
      clearDropMarks();
      saveTasks();
      renderTasks();
    });
  }
  return row;
}

// Double-click a title to rename it in place
function makeRenamable(node, current, save) {
  node.title = "Double-click to rename";
  node.addEventListener("dblclick", () => {
    const input = el("input", "title-input");
    input.value = current;
    input.maxLength = 80;
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (commit && name && name !== current) {
        save(name);
        saveTasks();
      }
      renderTasks();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    const draggableParent = node.closest("[draggable]");
    if (draggableParent) draggableParent.draggable = false;
    node.replaceWith(input);
    input.focus();
    input.select();
  });
  return node;
}

function buildListCard(list, section) {
  const card = el("div", "task-card");
  card.dataset.id = list.id;
  const sideAfter = (e) => {
    const r = card.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  };
  card.addEventListener("dragover", (e) => {
    if (listDrag) {
      e.preventDefault();
      e.stopPropagation();
      clearDropMarks();
      if (listDrag.listId !== list.id) card.classList.add(sideAfter(e) ? "drop-card-after" : "drop-card-before");
      return;
    }
    if (dragState) e.preventDefault();
  });
  card.addEventListener("drop", (e) => {
    if (listDrag) {
      e.preventDefault();
      e.stopPropagation();
      dropList(section, list.id, sideAfter(e));
      return;
    }
    if (!dragState) return;
    e.preventDefault();
    const from = findListById(dragState.listId);
    if (from) moveTask(from, dragState.taskId, list, null, false);
    dragState = null;
    clearDropMarks();
    saveTasks();
    renderTasks();
  });

  const head = el("div", "task-card-head");
  head.draggable = true;
  head.addEventListener("dragstart", (e) => {
    listDrag = { listId: list.id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "list:" + list.id);
    e.dataTransfer.setDragImage(card, 20, 20);
    card.classList.add("dragging-card");
  });
  head.addEventListener("dragend", () => {
    listDrag = null;
    card.classList.remove("dragging-card");
    clearDropMarks();
  });

  const { total, done, pct } = listPercent(list);
  const titleBox = el("div", "task-card-titlebox");
  const percent = el("span", "list-percent " + (pct > 70 ? "high" : pct > 30 ? "mid" : "low"), pct + "%");
  percent.title = `${done} of ${total} tasks completed`;
  titleBox.append(makeRenamable(el("h3", "task-card-title", list.name), list.name, (n) => (list.name = n)), percent);
  head.appendChild(titleBox);
  const menuWrap = el("div", "menu-wrap");
  menuWrap.appendChild(
    iconBtn("List options", "⋮", () => {
      openMenuId = openMenuId === list.id ? null : list.id;
      renderTasks();
    })
  );
  if (openMenuId === list.id) {
    const menu = el("div", "menu");
    const item = (label, fn, danger) => {
      const b = el("button", "menu-item" + (danger ? " danger" : ""), label);
      b.type = "button";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        openMenuId = null;
        fn();
        saveTasks();
        renderTasks();
      });
      menu.appendChild(b);
    };
    item("Rename", () => {
      const name = (window.prompt("Rename list:", list.name) || "").trim();
      if (name) list.name = name;
    });
    item("Delete completed", () => {
      if (list.tasks.some((t) => t.done) && confirm("Delete all completed tasks in this list?")) {
        list.tasks = list.tasks.filter((t) => !t.done);
      }
    });
    item(
      "Delete",
      () => {
        if (confirm(`Delete "${list.name}" and all its tasks? This can't be undone.`)) {
          section.lists = section.lists.filter((l) => l.id !== list.id);
        }
      },
      true
    );
    menuWrap.appendChild(menu);
  }
  head.appendChild(menuWrap);
  card.appendChild(head);

  // Add a task
  const adding = editor && editor.listId === list.id && !editor.taskId && !editor.parentId;
  if (adding) {
    card.appendChild(buildEditor(list, null, null));
  } else {
    const add = el("button", "add-task-btn");
    add.type = "button";
    add.innerHTML = '<span class="add-icon">+</span> Add a task';
    add.addEventListener("click", () => {
      editor = { listId: list.id, taskId: null, parentId: null };
      renderTasks();
    });
    card.appendChild(add);
  }

  // Open tasks, each followed by its subtasks
  const open = el("ul", "task-list");
  const topLevel = list.tasks.filter((t) => !t.parentId && !t.done);
  topLevel.forEach((task) => {
    open.appendChild(
      editor && editor.listId === list.id && editor.taskId === task.id
        ? wrapLi(buildEditor(list, task, null))
        : buildTaskRow(list, task)
    );
    list.tasks
      .filter((t) => t.parentId === task.id && !t.done)
      .forEach((sub) => {
        open.appendChild(
          editor && editor.taskId === sub.id ? wrapLi(buildEditor(list, sub, null), true) : buildTaskRow(list, sub)
        );
      });
    if (editor && editor.listId === list.id && !editor.taskId && editor.parentId === task.id) {
      open.appendChild(wrapLi(buildEditor(list, null, task.id), true));
    }
  });
  card.appendChild(open);

  // Completed (collapsible)
  const doneTasks = list.tasks.filter((t) => t.done);
  if (doneTasks.length > 0) {
    const toggle = el("button", "completed-toggle");
    toggle.type = "button";
    toggle.innerHTML = `<span class="caret">${list.showCompleted ? "▾" : "▸"}</span> Completed (${doneTasks.length})`;
    toggle.addEventListener("click", () => {
      list.showCompleted = !list.showCompleted;
      saveTasks();
      renderTasks();
    });
    card.appendChild(toggle);
    if (list.showCompleted) {
      const ul = el("ul", "task-list");
      doneTasks.forEach((t) => ul.appendChild(buildTaskRow(list, t)));
      card.appendChild(ul);
    }
  }
  return card;
}

function wrapLi(node, sub) {
  const li = el("li", "task-editor-li" + (sub ? " sub" : ""));
  li.appendChild(node);
  return li;
}

function addListTo(section) {
  const list = newList("New list");
  section.lists.push(list);
  section.collapsed = false;
  saveTasks();
  renderTasks();
  // Open the new card's title for renaming right away
  const cards = taskBoard.querySelectorAll(".task-card");
  const card = [...cards].find((c) => c.dataset.id === list.id);
  if (card) card.querySelector(".task-card-title").dispatchEvent(new MouseEvent("dblclick"));
}

function buildSection(section) {
  const box = el("div", "board-section" + (section.collapsed ? " collapsed" : ""));
  box.addEventListener("dragover", (e) => {
    if (!listDrag) return;
    e.preventDefault();
    clearDropMarks();
  });
  box.addEventListener("drop", (e) => {
    if (!listDrag) return;
    e.preventDefault();
    dropList(section, null, false);
  });

  const head = el("div", "section-head");
  const toggle = el("button", "section-toggle", section.collapsed ? "▸" : "▾");
  toggle.type = "button";
  toggle.setAttribute("aria-label", section.collapsed ? "Expand section" : "Collapse section");
  toggle.addEventListener("click", () => {
    section.collapsed = !section.collapsed;
    saveTasks();
    renderTasks();
  });
  const openCount = section.lists.reduce((n, l) => n + l.tasks.filter((x) => !x.done).length, 0);
  head.append(toggle, makeRenamable(el("h2", "section-title", section.name), section.name, (n) => (section.name = n)), el("span", "section-count", String(openCount)));

  const spacer = el("span", "spacer");
  const addList = el("button", "ghost-btn", "+ New list");
  addList.type = "button";
  addList.addEventListener("click", () => addListTo(section));

  head.append(spacer, addList);
  box.appendChild(head);

  if (!section.collapsed) {
    const row = el("div", "section-lists");
    section.lists.forEach((list) => row.appendChild(buildListCard(list, section)));
    const add = el("button", "new-list-col", "+");
    add.type = "button";
    add.setAttribute("aria-label", "New list");
    add.addEventListener("click", () => addListTo(section));
    row.appendChild(add);
    box.appendChild(row);
  }
  return box;
}

function renderTasks() {
  taskBoard.innerHTML = "";
  sections.forEach((s) => taskBoard.appendChild(buildSection(s)));
}

document.addEventListener("click", () => {
  if (openMenuId) {
    openMenuId = null;
    renderTasks();
  }
});

renderTasks();
try {
  const saved = localStorage.getItem("timerapp.tab");
  if (saved === "tasks") setTab("tasks");
} catch (e) {}
