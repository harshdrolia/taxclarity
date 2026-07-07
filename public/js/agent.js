/* TaxClarity v3 — Research Agent + Authority Directory */
"use strict";

var HIST = [];
var STAGES = [
  "Framing the issue…",
  "Consulting the Code…",
  "Checking regulations and rulings…",
  "Mapping state conformity…",
  "Assembling the memo with citations…",
];
var stageTimer = null;

function setQ(q) {
  var el = document.getElementById("ag-input");
  el.value = q; el.focus();
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* Client-side inline linkifier for §refs inside analysis prose */
function linkifyText(text) {
  var t = esc(text);
  t = t.replace(/(?:IRC\s*)?§\s*(\d{1,4}[A-Za-z]?)((?:\([a-z0-9]{1,3}\))*)/g, function (m, sec, subs) {
    return '<a href="https://www.law.cornell.edu/uscode/text/26/' + sec + '" target="_blank" rel="noopener">' + m + "</a>";
  });
  t = t.replace(/(?:Treas\.?\s*)?Reg\.?\s*§?\s*(\d{1,3}[A-Za-z]?\.[0-9A-Za-z.-]+)/g, function (m, reg) {
    return '<a href="https://www.law.cornell.edu/cfr/text/26/' + reg.replace(/\([^)]*\)/g, "") + '" target="_blank" rel="noopener">' + m + "</a>";
  });
  return t;
}

function runAgent() {
  var q = document.getElementById("ag-input").value.trim();
  if (q.length < 5) return;
  var btn = document.getElementById("ag-btn");
  btn.disabled = true;
  document.getElementById("memo-wrap").innerHTML = "";
  var load = document.getElementById("ag-loading");
  load.classList.add("on");
  var i = 0;
  document.getElementById("ag-stage").textContent = STAGES[0];
  stageTimer = setInterval(function () {
    i = Math.min(i + 1, STAGES.length - 1);
    document.getElementById("ag-stage").textContent = STAGES[i];
  }, 6000);

  fetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: q }),
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (x) {
      clearInterval(stageTimer); load.classList.remove("on"); btn.disabled = false;
      if (!x.ok || !x.d.success) {
        document.getElementById("memo-wrap").innerHTML = '<div class="alert">' + esc(x.d.error || "Research failed — please try again.") + "</div>";
        return;
      }
      HIST.unshift({ q: q, r: x.d.result }); if (HIST.length > 10) HIST.pop();
      renderHistory();
      renderMemo(x.d.result, q);
    })
    .catch(function () {
      clearInterval(stageTimer); load.classList.remove("on"); btn.disabled = false;
      document.getElementById("memo-wrap").innerHTML = '<div class="alert">Network error — the free server may be waking up. Try again in ~30 seconds.</div>';
    });
}

function chipHtml(c) {
  var slate = c.type === "form" || c.type === "pub" || c.type === "web";
  var approx = c.exact === false;
  return '<a class="chip' + (slate ? " slate" : "") + (approx ? " approx" : "") + '" href="' + esc(c.url) + '" target="_blank" rel="noopener" title="' + esc(c.note || "") + '">' + esc(c.display) + "</a>";
}

function confColor(s) { return s >= 80 ? "var(--good)" : s >= 55 ? "var(--warn)" : "var(--ox)"; }

function renderMemo(r, q) {
  var h = "";
  h += '<div class="memo">';
  h += '<div class="memo-head"><div class="kicker">Research Memorandum · Cited</div><h3>' + esc(r.issue) + "</h3></div>";

  h += '<div class="memo-sec"><h4>Executive summary</h4><p>' + linkifyText(r.executive_summary) + "</p></div>";

  if (r.citations && r.citations.length) {
    h += '<div class="memo-sec"><h4>Cited authority — click through to the source</h4><div class="chips">' + r.citations.map(chipHtml).join("") + "</div>";
    h += '<p style="margin-top:10px;font-size:12.5px;color:var(--ink3)">Chips marked “↗ search” open an official search for that authority (rulings and cases lack stable public URLs). Verify every citation against the source — that is the point of the links.</p></div>';
  }

  if (r.authority_hierarchy && r.authority_hierarchy.length) {
    h += '<div class="memo-sec"><h4>Hierarchy of authority</h4>';
    r.authority_hierarchy.forEach(function (lvl) {
      (lvl.sources || []).forEach(function (s, idx) {
        var text = typeof s === "string" ? s : s.text;
        var url = typeof s === "object" && s.url ? s.url : null;
        h += '<div class="auth-row"><span class="auth-w">' + esc(idx === 0 ? lvl.level : "") + "</span><span>" + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + "</a>" : linkifyText(text)) + "</span></div>";
      });
    });
    h += "</div>";
  }

  if (r.analysis && r.analysis.federal) {
    h += '<div class="memo-sec"><h4>Federal analysis</h4><p class="fed">' + linkifyText(r.analysis.federal) + "</p></div>";
  }
  if (r.analysis && r.analysis.salt) {
    var s = r.analysis.salt;
    h += '<div class="memo-sec"><h4>State & local (SALT)</h4>';
    if (s.conformity_overview) h += "<p>" + esc(s.conformity_overview) + "</p><br/>";
    (s.state_variations || []).forEach(function (v) {
      h += '<div class="statebox"><b>' + esc(v.category) + ":</b> " + esc((v.states || []).join(", ")) + " — " + esc(v.notes || "") + "</div>";
    });
    if (s.high_risk_states && s.high_risk_states.length) {
      h += '<div class="statebox" style="border-left:3px solid var(--ox)"><b>Watch closely:</b> ' + s.high_risk_states.map(esc).join(" · ") + "</div>";
    }
    h += "</div>";
  }

  if (r.confidence) {
    var sc = Math.max(0, Math.min(100, r.confidence.score || 0));
    h += '<div class="memo-sec"><h4>Confidence</h4><div class="conf"><span class="score">' + sc + "/100 · " + esc(r.confidence.label || "") + '</span><div class="conf-bar"><i style="width:' + sc + "%;background:" + confColor(sc) + '"></i></div></div>';
    if (r.confidence.rationale) h += '<p style="margin-top:8px">' + esc(r.confidence.rationale) + "</p>";
    h += "</div>";
  }

  if (r.follow_up_issues && r.follow_up_issues.length) {
    h += '<div class="memo-sec"><h4>Follow-up issues</h4><ul>' + r.follow_up_issues.map(function (f) {
      return "<li><b>" + esc(f.issue) + "</b> (" + esc(f.priority || "—") + ") — " + esc(f.why || "") + "</li>";
    }).join("") + "</ul></div>";
  }
  if (r.planning_opportunities && r.planning_opportunities.length) {
    h += '<div class="memo-sec"><h4>Planning opportunities</h4><ul>' + r.planning_opportunities.map(function (p) { return "<li>" + linkifyText(p) + "</li>"; }).join("") + "</ul></div>";
  }
  if (r.caveats && r.caveats.length) {
    h += '<div class="memo-sec"><h4>Caveats</h4><ul>' + r.caveats.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul></div>";
  }

  h += '<div class="memo-actions"><button class="btn btn-ghost" id="memo-copy" onclick="copyMemo()">Copy memo</button><button class="btn btn-ghost" onclick="window.print()">Print / PDF</button></div>';
  h += '<div class="memo-disc">AI-generated research starting point — not tax advice and not a substitute for professional judgment. Citations are linked so you can verify them; always read the primary source.</div>';
  h += "</div>";
  document.getElementById("memo-wrap").innerHTML = h;
  document.getElementById("memo-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

function copyMemo() {
  var el = document.querySelector(".memo");
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(function () {
    var b = document.getElementById("memo-copy");
    b.textContent = "Copied ✓"; setTimeout(function () { b.textContent = "Copy memo"; }, 1600);
  });
}

function renderHistory() {
  var el = document.getElementById("ag-history");
  if (!el) return;
  el.innerHTML = HIST.map(function (h, i) {
    return '<button onclick="loadHistory(' + i + ')">' + esc(h.q.slice(0, 60)) + (h.q.length > 60 ? "…" : "") + "</button>";
  }).join("");
}
function loadHistory(i) {
  var h = HIST[i];
  if (h) { document.getElementById("ag-input").value = h.q; renderMemo(h.r, h.q); }
}

/* ── Authority Directory ── */
var DIR = null, DIR_FILTER = "all";
function loadDirectory() {
  fetch("/api/authorities").then(function (r) { return r.json(); }).then(function (d) {
    DIR = d.authorities; renderDirectory();
  }).catch(function () {
    document.getElementById("dir-grid").innerHTML = '<div class="sr-empty">Could not load the directory — refresh to retry.</div>';
  });
}
function setDirFilter(f, btn) {
  DIR_FILTER = f;
  document.querySelectorAll(".dir-controls .pill").forEach(function (p) { p.classList.remove("active"); });
  btn.classList.add("active");
  renderDirectory();
}
function renderDirectory() {
  if (!DIR) return;
  var q = (document.getElementById("dir-search").value || "").toLowerCase();
  var rows = [];
  function add(kind, label, arr, refFmt) {
    if (DIR_FILTER !== "all" && DIR_FILTER !== kind) return;
    arr.forEach(function (e) {
      var hay = (e.ref + " " + e.title + " " + (e.desc || "") + " " + (e.topic || "")).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      rows.push('<a class="dir-card" href="' + esc(e.url) + '" target="_blank" rel="noopener">' +
        '<div class="dir-ref">' + refFmt(e.ref) + '<span class="t">' + label + (e.topic ? " · " + esc(e.topic) : "") + "</span></div>" +
        '<div class="dir-title">' + esc(e.title) + "</div>" +
        '<div class="dir-desc">' + esc(e.desc || "") + "</div></a>");
    });
  }
  add("irc", "Statute", DIR.irc, function (r) { return "IRC §" + r; });
  add("regs", "Regulation", DIR.regs, function (r) { return "Reg. §" + r; });
  add("forms", "Form", DIR.forms, function (r) { return "Form " + r; });
  add("pubs", "Publication", DIR.pubs, function (r) { return "Pub. " + r; });
  document.getElementById("dir-grid").innerHTML = rows.length ? rows.join("") : '<div class="sr-empty">No matches — try a section number or a plain word like “basis”.</div>';
  document.getElementById("dir-count").textContent = rows.length + " authorities";
}

document.addEventListener("DOMContentLoaded", function () {
  loadDirectory();
  var ds = document.getElementById("dir-search");
  if (ds) ds.addEventListener("input", renderDirectory);
  var input = document.getElementById("ag-input");
  if (input) input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAgent();
  });
});
