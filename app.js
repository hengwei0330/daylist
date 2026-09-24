/* =========================================================
   Daylist — the task list

   Tasks live in a Postgres table in your Supabase project, one row
   per task, each stamped with the account that owns it. The browser
   never decides who may read what: every request carries the signed-in
   account's token, and the Row Level Security rules in
   supabase-setup.sql filter the rows inside the database.
   ========================================================= */
(function () {
  "use strict";

  var db = null;          // the Supabase client
  var USER_ID = null;
  var USER_EMAIL = "";

  /* ---------------- dates ---------------- */
  var WD = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function keyOf(d){
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function todayKey(){ return keyOf(new Date()); }
  function fromKey(k){ var p = k.split("-"); return new Date(+p[0], +p[1]-1, +p[2]); }
  function addDays(n){ var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return keyOf(d); }
  function diffDays(k){ return Math.round((fromKey(k) - fromKey(todayKey())) / 86400000); }

  function dueLabel(k){
    var d = diffDays(k), dt = fromKey(k);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d === -1) return "Yesterday";
    if (d > 1 && d < 7) return WD[dt.getDay()].slice(0,3).replace(/^./, function(c){ return c.toUpperCase(); });
    var s = MON[dt.getMonth()] + " " + dt.getDate();
    if (dt.getFullYear() !== new Date().getFullYear()) s += " " + dt.getFullYear();
    return s;
  }

  /* ---------------- quick-add parser ----------------
     Pulls a due date, a #list and a ! priority out of the typed line,
     and leaves the rest as the task's title. */
  function parseInput(raw){
    var text = " " + raw.trim() + " ";
    var priority = 0, list = null, due = null;

    text = text.replace(/\s(!{1,3})(?=\s)/g, function(_m, bangs){
      priority = Math.max(priority, Math.min(2, bangs.length));
      return " ";
    });

    text = text.replace(/\s#([A-Za-z0-9_-]+)(?=\s)/, function(_m, tag){
      list = tag.toLowerCase();
      return " ";
    });

    function take(re, fn){
      if (due) return;
      text = text.replace(re, function(){
        var d = fn.apply(null, arguments);
        if (d === null) return arguments[0];
        due = d;
        return " ";
      });
    }

    take(/\s(\d{4})-(\d{1,2})-(\d{1,2})(?=\s)/, function(_m, y, mo, dd){
      return keyOf(new Date(+y, +mo-1, +dd));
    });
    take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, function(_m, mo, dd, yy){
      var y = yy ? (yy.length === 2 ? 2000 + +yy : +yy) : new Date().getFullYear();
      var k = keyOf(new Date(y, +mo-1, +dd));
      if (!yy && diffDays(k) < -180) k = keyOf(new Date(y+1, +mo-1, +dd));
      return k;
    });
    take(/\sin\s+(\d{1,3})\s+(day|days|week|weeks|month|months)(?=\s)/i, function(_m, n, unit){
      var u = unit.toLowerCase();
      var mult = u.indexOf("week") === 0 ? 7 : u.indexOf("month") === 0 ? 30 : 1;
      return addDays(+n * mult);
    });
    take(/\s(today|tonight|tod)(?=\s)/i, function(){ return addDays(0); });
    take(/\s(tomorrow|tmrw|tmr|tom)(?=\s)/i, function(){ return addDays(1); });
    take(/\snext\s+week(?=\s)/i, function(){ return addDays(7); });
    take(/\s(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)(?=\s)/i,
      function(_m, next, name){
        var n = name.toLowerCase(), target = -1;
        for (var i = 0; i < WD.length; i++){ if (WD[i].indexOf(n) === 0) { target = i; break; } }
        if (target < 0) return null;
        var delta = (target - new Date().getDay() + 7) % 7;
        if (next) delta = delta === 0 ? 7 : delta;
        return addDays(delta);
      });

    text = text.replace(/\s+/g, " ").trim();
    if (!text) text = raw.trim();
    return { text: text, due: due, priority: priority, list: list };
  }

  /* ---------------- rows in, rows out ----------------
     Postgres columns are snake_case and timestamps are strings;
     the rest of this file works in camelCase and numbers. */
  function fromRow(r){
    return {
      id: r.id,
      text: r.text,
      done: !!r.done,
      due: r.due || null,
      priority: r.priority || 0,
      list: r.list || null,
      createdAt: r.created_at ? Date.parse(r.created_at) : 0,
      completedAt: r.completed_at ? Date.parse(r.completed_at) : null
    };
  }

  function patchToRow(p){
    var row = {};
    if ("text" in p)     row.text = p.text;
    if ("done" in p)     row.done = p.done;
    if ("due" in p)      row.due = p.due;
    if ("priority" in p) row.priority = p.priority;
    if ("list" in p)     row.list = p.list;
    if ("completedAt" in p) row.completed_at = p.completedAt ? new Date(p.completedAt).toISOString() : null;
    return row;
  }

  function newId(){
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // Fallback for older browsers: a random RFC-4122-shaped id.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c){
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /* ---------------- state ---------------- */
  var Store = { items: [] };
  var editingId = null;
  var filter = "open", activeList = null;

  function showNotice(msg){
    var n = document.getElementById("notice");
    n.textContent = msg;
    n.hidden = false;
  }
  function clearNotice(){ document.getElementById("notice").hidden = true; }

  /* A write failed. Say so, and pull the real state back from the
     database rather than leaving the screen showing a lie. */
  function writeFailed(error){
    showNotice(Auth.friendly(error) + " Your last change was not saved.");
    return refresh();
  }

  function refresh(){
    return db.from("tasks").select("*").order("created_at", { ascending: true })
      .then(function (res){
        if (res.error) { showNotice(Auth.friendly(res.error)); return; }
        Store.items = (res.data || []).map(fromRow);
        draw();
      });
  }

  function addTask(fields){
    var item = Object.assign({ id: newId(), done: false, createdAt: Date.now(), completedAt: null }, fields);
    Store.items = Store.items.concat(item);   // show it at once
    clearNotice();
    render();

    db.from("tasks").insert({
      id: item.id,
      user_id: USER_ID,
      text: item.text,
      done: false,
      due: item.due || null,
      priority: item.priority || 0,
      list: item.list || null
    }).then(function (res){
      if (res.error) writeFailed(res.error);
    });
  }

  function patchTask(id, patch){
    var i = -1;
    for (var j = 0; j < Store.items.length; j++) if (Store.items[j].id === id) { i = j; break; }
    if (i < 0) return;
    Store.items = Store.items.slice();
    Store.items[i] = Object.assign({}, Store.items[i], patch);
    clearNotice();
    render();

    db.from("tasks").update(patchToRow(patch)).eq("id", id).then(function (res){
      if (res.error) writeFailed(res.error);
    });
  }

  function removeTask(id){
    Store.items = Store.items.filter(function (t){ return t.id !== id; });
    clearNotice();
    render();

    db.from("tasks").delete().eq("id", id).then(function (res){
      if (res.error) writeFailed(res.error);
    });
  }

  function clearDone(){
    Store.items = Store.items.filter(function (t){ return !t.done; });
    clearNotice();
    render();

    db.from("tasks").delete().eq("user_id", USER_ID).eq("done", true).then(function (res){
      if (res.error) writeFailed(res.error);
    });
  }

  /* ---------------- grouping ---------------- */
  var GROUPS = [
    ["overdue", "Overdue"], ["today", "Today"], ["tomorrow", "Tomorrow"],
    ["week", "This week"], ["later", "Later"], ["anytime", "Anytime"], ["done", "Done"]
  ];

  function groupOf(t){
    if (t.done) return "done";
    if (!t.due) return "anytime";
    var d = diffDays(t.due);
    if (d < 0) return "overdue";
    if (d === 0) return "today";
    if (d === 1) return "tomorrow";
    if (d <= 7) return "week";
    return "later";
  }

  function cmp(a, b){
    if (a.done && b.done) return (b.completedAt || 0) - (a.completedAt || 0);
    var pa = a.priority || 0, pb = b.priority || 0;
    if (pa !== pb) return pb - pa;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  function esc(s){
    return String(s).replace(/[&<>"']/g, function (c){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- render ---------------- */
  var raf = 0;
  function render(){
    if (editingId || raf) return;
    var run = function (){ raf = 0; draw(); };
    // Browsers pause requestAnimationFrame on a hidden tab, which would leave
    // the list stale until you switched back — so fall back to a timer there.
    raf = (document.hidden ? setTimeout(run, 0) : requestAnimationFrame(run)) || 1;
  }

  function draw(){
    var items = Store.items;
    var scoped = activeList ? items.filter(function (t){ return t.list === activeList; }) : items;

    var open = 0, done = 0, dueNow = 0;
    scoped.forEach(function (t){
      if (t.done) { done++; return; }
      open++;
      var g = groupOf(t);
      if (g === "overdue" || g === "today") dueNow++;
    });

    var total = open + done;
    document.getElementById("meter-txt").textContent = done + "/" + total;
    document.getElementById("meter-fill").style.width = (total ? Math.round(done / total * 100) : 0) + "%";

    drawFilters(open, done, dueNow, total);

    var shown = scoped.filter(function (t){
      if (filter === "open") return !t.done;
      if (filter === "done") return t.done;
      if (filter === "today"){
        if (t.done) return false;
        var g = groupOf(t);
        return g === "overdue" || g === "today";
      }
      return true;
    }).slice().sort(cmp);

    var wrap = document.getElementById("groups");
    if (!shown.length){ wrap.innerHTML = emptyHtml(items.length); return; }

    var buckets = {};
    shown.forEach(function (t){
      var g = groupOf(t);
      (buckets[g] || (buckets[g] = [])).push(t);
    });

    var html = "";
    GROUPS.forEach(function (pair){
      var key = pair[0], rows = buckets[key];
      if (!rows || !rows.length) return;
      html += '<section class="group" data-g="' + key + '">' +
        '<div class="ghead">' +
          '<span class="glabel">' + pair[1] + '</span>' +
          '<span class="gcount">' + rows.length + '</span>' +
          '<span class="grule"></span>' +
          (key === "done" ? '<button class="clear" type="button" data-act="clear">Clear completed</button>' : "") +
        '</div><ul class="list">' + rows.map(rowHtml).join("") + '</ul></section>';
    });
    wrap.innerHTML = html;
  }

  function rowHtml(t){
    var g = groupOf(t);
    var urg = g === "overdue" ? "overdue" : g === "today" ? "today" : "none";
    var meta = "";
    if (t.due){
      var cls = g === "overdue" ? " due-overdue" : g === "today" ? " due-today" : "";
      meta += '<span class="mchip' + cls + '">' + esc(dueLabel(t.due)) + '</span>';
    }
    if (t.list) meta += '<span class="mchip tag">#' + esc(t.list) + '</span>';

    return '<li class="task' + (t.done ? " done" : "") + '" data-id="' + esc(t.id) + '" data-urg="' + urg + '">' +
      '<input class="check" type="checkbox" id="chk-' + esc(t.id) + '"' + (t.done ? " checked" : "") +
        ' aria-label="Mark ' + esc(t.text) + ' done">' +
      '<span class="body">' +
        '<span class="title" data-act="edit" role="button" tabindex="0">' + esc(t.text) + '</span>' +
        (meta ? '<span class="meta">' + meta + '</span>' : "") +
      '</span>' +
      (t.priority ? '<span class="prio" title="Priority">' + (t.priority > 1 ? "!!" : "!") + '</span>' : "") +
      '<button class="del" type="button" data-act="del" aria-label="Delete ' + esc(t.text) + '">&times;</button>' +
    '</li>';
  }

  function drawFilters(open, done, dueNow, total){
    var lists = {};
    Store.items.forEach(function (t){ if (t.list) lists[t.list] = (lists[t.list] || 0) + (t.done ? 0 : 1); });
    var names = Object.keys(lists).sort();

    var defs = [["open", "Open", open], ["today", "Today", dueNow], ["done", "Done", done], ["all", "All", total]];
    var html = defs.map(function (d){
      return '<button class="chip" type="button" data-filter="' + d[0] + '" aria-pressed="' +
        (filter === d[0]) + '">' + d[1] + '<span class="n">' + d[2] + '</span></button>';
    }).join("");

    if (names.length){
      html += '<span class="sep"></span>' + names.map(function (n){
        return '<button class="chip list-chip" type="button" data-list="' + esc(n) + '" aria-pressed="' +
          (activeList === n) + '">#' + esc(n) + '<span class="n">' + lists[n] + '</span></button>';
      }).join("");
    }
    document.getElementById("filters").innerHTML = html;
  }

  function emptyHtml(totalItems){
    var h, p;
    if (!totalItems){
      h = "Nothing on the list";
      p = "Add your first task above. Words like <em>friday</em>, <em>tomorrow</em> or <em>in 3 days</em> become a due date, <em>#work</em> becomes a list, and <em>!!</em> marks it urgent.";
    } else if (filter === "open"){
      h = "All clear";
      p = "Every task in view is done. Nicely handled.";
    } else if (filter === "today"){
      h = "Nothing due today";
      p = "No overdue or same-day tasks. Switch to <em>Open</em> to see what is coming up.";
    } else if (filter === "done"){
      h = "Nothing finished yet";
      p = "Completed tasks collect here so you can look back on the day.";
    } else {
      h = "Nothing in this view";
      p = "Try another filter, or clear the list tag you have selected.";
    }
    return '<div class="empty"><h2>' + h + '</h2><p>' + p + '</p></div>';
  }

  /* ---------------- interaction ---------------- */
  function wireUp(){
    var input = document.getElementById("task-input");
    var addBtn = document.getElementById("add-btn");

    document.getElementById("who").textContent = USER_EMAIL;
    document.getElementById("today-date").textContent =
      new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

    document.getElementById("signout").addEventListener("click", function (){
      Auth.signOut().then(function (){ window.location.replace("login.html"); });
    });

    input.addEventListener("input", function (){ addBtn.disabled = !input.value.trim(); });

    document.getElementById("compose-form").addEventListener("submit", function (e){
      e.preventDefault();
      var raw = input.value.trim();
      if (!raw) return;
      var f = parseInput(raw);
      if (!f.list && activeList) f.list = activeList;
      addTask(f);
      input.value = "";
      addBtn.disabled = true;
      input.focus();
    });

    document.getElementById("syntax").addEventListener("click", function (e){
      var b = e.target.closest(".tok");
      if (!b) return;
      var v = input.value.replace(/\s+$/, "");
      input.value = (v ? v + " " : "") + b.getAttribute("data-tok") + " ";
      addBtn.disabled = !input.value.trim();
      input.focus();
    });

    document.getElementById("filters").addEventListener("click", function (e){
      var b = e.target.closest(".chip");
      if (!b) return;
      if (b.hasAttribute("data-filter")) filter = b.getAttribute("data-filter");
      else {
        var l = b.getAttribute("data-list");
        activeList = activeList === l ? null : l;
      }
      draw();
    });

    var groups = document.getElementById("groups");

    groups.addEventListener("change", function (e){
      var box = e.target.closest(".check");
      if (!box) return;
      var li = box.closest(".task");
      patchTask(li.getAttribute("data-id"), { done: box.checked, completedAt: box.checked ? Date.now() : null });
    });

    groups.addEventListener("click", function (e){
      var clear = e.target.closest('[data-act="clear"]');
      if (clear){
        if (clear.getAttribute("data-armed") === "1"){ clearDone(); return; }
        clear.setAttribute("data-armed", "1");
        clear.textContent = "Delete them? Click again";
        setTimeout(function (){
          if (!clear.isConnected) return;
          clear.removeAttribute("data-armed");
          clear.textContent = "Clear completed";
        }, 3500);
        return;
      }
      var del = e.target.closest('[data-act="del"]');
      if (del){ removeTask(del.closest(".task").getAttribute("data-id")); return; }
      var title = e.target.closest('[data-act="edit"]');
      if (title) beginEdit(title);
    });

    groups.addEventListener("keydown", function (e){
      if (e.key !== "Enter" && e.key !== " ") return;
      var title = e.target.closest('[data-act="edit"]');
      if (title){ e.preventDefault(); beginEdit(title); }
    });

    document.addEventListener("keydown", function (e){
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      input.focus();
    });
  }

  function beginEdit(titleEl){
    var li = titleEl.closest(".task");
    var id = li.getAttribute("data-id");
    var current = titleEl.textContent;
    editingId = id;

    var field = document.createElement("input");
    field.type = "text";
    field.className = "edit";
    field.id = "edit-" + id;
    field.value = current;
    titleEl.replaceWith(field);
    field.focus();
    field.setSelectionRange(current.length, current.length);

    var settled = false;
    function finish(save){
      if (settled) return;
      settled = true;
      var next = field.value.trim();
      editingId = null;
      if (save && next && next !== current) patchTask(id, { text: next });
      else draw();
    }
    field.addEventListener("keydown", function (ev){
      if (ev.key === "Enter"){ ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape"){ ev.preventDefault(); finish(false); }
    });
    field.addEventListener("blur", function (){ finish(true); });
  }

  /* ---------------- start ---------------- */
  function bootError(msg){
    var boot = document.getElementById("boot");
    boot.innerHTML = '<div class="boot-msg"><h1>Daylist needs a moment of setup</h1><p></p></div>';
    boot.querySelector("p").textContent = msg;
  }

  /* On a slow connection the Supabase library can take a while to arrive.
     Say so rather than sitting on "Checking your session…" indefinitely. */
  var settled = false;
  setTimeout(function (){
    if (settled) return;
    var p = document.querySelector("#boot p");
    if (p) p.textContent = "Still connecting… if this does not clear, check your internet connection and reload.";
  }, 8000);

  var problem = Auth.setupProblem();
  if (problem){ settled = true; bootError(problem); return; }

  Auth.requireSession().then(function (s){
    settled = true;
    if (!s) return;                 // redirecting to the login page
    USER_ID = s.user.id;
    USER_EMAIL = Auth.emailOf(s);
    db = Auth.client();

    document.getElementById("boot").hidden = true;
    document.getElementById("wrap").hidden = false;

    wireUp();
    return refresh();
  }).catch(function (e){
    settled = true;
    bootError(Auth.friendly(e));
  });
})();
