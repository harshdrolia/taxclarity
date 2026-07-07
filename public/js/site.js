/* TaxClarity v3 — shared site behaviors */
"use strict";

function toggleMobile() {
  var m = document.getElementById("mobileMenu");
  if (m) m.classList.toggle("open");
}

/* ── Site search (nav + hero) ── */
function wireSearch(inputId, resultsId) {
  var input = document.getElementById(inputId);
  var box = document.getElementById(resultsId);
  if (!input || !box) return;
  var t = null, lastQ = "";
  function close() { box.classList.remove("open"); box.innerHTML = ""; }
  function render(results, q) {
    if (!results.length) {
      box.innerHTML = '<div class="sr-empty">No matches for “' + escapeHtml(q) + '” — try a section number (754), a form (7203), or a plain word (basis).</div>';
    } else {
      box.innerHTML = results.map(function (r) {
        var ext = /^https?:/.test(r.url);
        return '<a class="sr-item" href="' + r.url + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + '>' +
          '<span class="sr-kind k-' + r.kind.toLowerCase() + '">' + r.kind + "</span>" +
          '<span class="sr-title">' + escapeHtml(r.title) + "</span>" +
          '<div class="sr-snippet">' + escapeHtml(r.snippet || "") + "</div></a>";
      }).join("");
    }
    box.classList.add("open");
  }
  input.addEventListener("input", function () {
    var q = input.value.trim();
    clearTimeout(t);
    if (q.length < 2) { close(); return; }
    t = setTimeout(function () {
      lastQ = q;
      fetch("/api/search?q=" + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (d) { if (q === lastQ) render(d.results || [], q); })
        .catch(function () {});
    }, 220);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
    if (e.key === "Enter") { var first = box.querySelector(".sr-item"); if (first) first.click(); }
  });
  document.addEventListener("click", function (e) {
    if (!box.contains(e.target) && e.target !== input) close();
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function heroTry(q) {
  var i = document.getElementById("hero-search");
  if (i) { i.value = q; i.dispatchEvent(new Event("input")); i.focus(); }
}

/* ── Newsletter ── */
function subscribeNews(e, formId, msgId) {
  e.preventDefault();
  var form = document.getElementById(formId), msg = document.getElementById(msgId);
  var email = form.querySelector("input[type=email]").value;
  msg.className = "form-msg"; msg.textContent = "…";
  fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email }) })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (x) {
      msg.className = "form-msg " + (x.ok ? "ok" : "err");
      msg.textContent = x.ok ? x.d.message : (x.d.error || "Something went wrong.");
      if (x.ok) form.reset();
    })
    .catch(function () { msg.className = "form-msg err"; msg.textContent = "Network error — try again."; });
  return false;
}

/* ── Legacy hash redirects (old single-page links) ── */
(function () {
  if (location.pathname === "/" && location.hash) {
    var h = location.hash.replace("#", "");
    var guides = ["taxes", "business", "planning", "audit", "international", "ai-career", "downloads"];
    if (guides.indexOf(h) !== -1) location.replace("/guides.html#" + h);
    else if (h === "glossary") location.replace("/glossary.html");
    else if (h === "agent") location.replace("/research.html");
    else if (h === "calculator") location.replace("/calculator.html");
  }
})();

document.addEventListener("DOMContentLoaded", function () {
  wireSearch("nav-search", "nav-search-results");
  wireSearch("hero-search", "hero-search-results");
});
