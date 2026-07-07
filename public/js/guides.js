/* TaxClarity v3 — guides & glossary interactions (scoped, fixes v2 cross-section bug) */
"use strict";

function switchTab(name, btn) {
  var scope = btn.closest("section") || document;
  scope.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
  scope.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
  var panel = scope.querySelector("#tab-" + name) || document.getElementById("tab-" + name);
  if (panel) panel.classList.add("active");
  btn.classList.add("active");
}

function toggleAcc(header) {
  var item = header.closest(".acc-item") || header.parentElement;
  var scope = header.closest(".accordion") || document;
  var isOpen = item.classList.contains("open");
  scope.querySelectorAll(".acc-item").forEach(function (i) { i.classList.remove("open"); });
  scope.querySelectorAll(".acc-header").forEach(function (h) { h.classList.remove("open"); });
  if (!isOpen) { item.classList.add("open"); header.classList.add("open"); }
}

function filterGlossary() {
  var el = document.getElementById("gloss-search");
  if (!el) return;
  var val = el.value.toLowerCase();
  document.querySelectorAll("#gloss-grid .gloss-card").forEach(function (c) {
    c.style.display = ((c.dataset.term || "") + " " + c.textContent.toLowerCase()).indexOf(val) !== -1 ? "block" : "none";
  });
}
