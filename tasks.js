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

function addTask(list, title, notes, parentId) {
  list.tasks.push({ id: uid(), title, notes, done: false, parentId: parentId || null, createdAt: Date.now() });
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
  document.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
}

// Move a top-level task (with its subtasks) next to targetId in toList; no targetId appends to the end
function moveTask(fromList, taskId, toList, targetId, after) {
  const group = fromList.tasks.filter((t) => t.id === taskId || t.parentId === taskId);
  if (group.length === 0 || targetId === taskId) return;
  fromList.tasks = fromList.tasks.filter((t) => !group.includes(t));
  let index = toList.tasks.length;
  if (targetId) {
    const ids = toList.tasks.map((t) => t.id);
    const start = ids.indexOf(targetId);
    if (start >= 0) {
      index = start;
      if (after) {
        index = start + 1;
        while (index < toList.tasks.length && toList.tasks[index].parentId === targetId) index++;
      }
    }
  }
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
  form.append(title, notes, actions);

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
    } else {
      addTask(list, t, notes.value.trim(), parentId);
    }
    saveTasks();
    editor = parentId ? { listId: list.id, taskId: null, parentId } : { listId: list.id, taskId: null, parentId: null };
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

  const actions = el("div", "task-actions");
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
  row.append(check, body, actions);

  if (!task.done && !task.parentId) {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
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
      if (!dragState || dragState.taskId === task.id) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      clearDropMarks();
      row.classList.add(after ? "drop-after" : "drop-before");
    });
    row.addEventListener("drop", (e) => {
      if (!dragState) return;
      e.preventDefault();
      e.stopPropagation();
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
    node.replaceWith(input);
    input.focus();
    input.select();
  });
  return node;
}

function buildListCard(list, section) {
  const card = el("div", "task-card");
  card.dataset.id = list.id;
  card.addEventListener("dragover", (e) => {
    if (dragState) e.preventDefault();
  });
  card.addEventListener("drop", (e) => {
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
  head.appendChild(makeRenamable(el("h3", "task-card-title", list.name), list.name, (n) => (list.name = n)));
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
