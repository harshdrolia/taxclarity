/* TaxClarity v3 — Draft Return Builder */
"use strict";

var TC_YEAR = 2025;
var computeTimer = null;

function fmt$(n) { return "$" + Math.round(Math.abs(n)).toLocaleString(); }
function V(id) { var el = document.getElementById(id); return el ? (parseFloat(el.value) || 0) : 0; }
function B(id) { var el = document.getElementById(id); return !!(el && el.checked); }
function S(id) { var el = document.getElementById(id); return el ? el.value : ""; }

function setYear(y, btn) {
  TC_YEAR = y;
  document.querySelectorAll(".year-toggle button").forEach(function (b) { b.classList.remove("active"); });
  btn.classList.add("active");
  scheduleCompute();
}

function toggleStep(head) {
  var step = head.closest(".bstep");
  var wasOpen = step.classList.contains("open");
  document.querySelectorAll(".bstep").forEach(function (s) { s.classList.remove("open"); });
  if (!wasOpen) step.classList.add("open");
}

function gather() {
  return {
    year: TC_YEAR,
    filingStatus: S("f-status") || "single",
    household: {
      childrenUnder17: V("f-kids"),
      otherDependents: V("f-odeps"),
      taxpayer65: B("f-t65"), spouse65: B("f-s65"),
      taxpayerBlind: B("f-tblind"), spouseBlind: B("f-sblind"),
      hsaFamily: S("f-hsatype") === "family",
      age50Plus: B("f-age50"), age55Plus: B("f-t65") || B("f-age50"),
    },
    income: {
      wages: V("i-wages"),
      interest: V("i-interest"), taxExemptInterest: V("i-teinterest"),
      ordinaryDividends: V("i-orddiv"), qualifiedDividends: V("i-qualdiv"),
      iraDistributions: V("i-ira"), pensions: V("i-pension"), socialSecurity: V("i-ss"),
      shortTermGain: V("i-stcg"), longTermGain: V("i-ltcg"),
      scheduleCGross: V("i-scgross"), scheduleCExpenses: V("i-scexp"),
      sstb: B("i-sstb"), w2WagesPaid: V("i-w2paid"),
      rentalNet: V("i-rental"), rentalIsQBI: B("i-rentalqbi"),
      k1Passive: V("i-k1p"), k1Nonpassive: V("i-k1np"), k1SubjectToSE: B("i-k1se"),
      unemployment: V("i-unemp"), otherIncome: V("i-other"),
    },
    adjustments: {
      hsa: V("a-hsa"), iraDeduction: V("a-ira"), studentLoanInterest: V("a-sli"),
      seHealthInsurance: V("a-sehealth"), educatorExpenses: V("a-educator"),
    },
    deductions: {
      saltPaid: V("d-salt"), mortgageInterest: V("d-mortgage"),
      charitable: V("d-charity"), medicalExpenses: V("d-medical"),
      forceItemize: S("d-mode") === "itemize" ? true : S("d-mode") === "standard" ? false : undefined,
    },
    obbba: { tips: V("o-tips"), overtimePremium: V("o-ot"), carLoanInterest: V("o-car") },
    credits: {
      childCareExpenses: V("c-care"), aotcExpenses: V("c-aotc"),
      llcExpenses: V("c-llc"), foreignTaxPaid: V("c-ftc"), otherNonrefundable: V("c-othernr"),
    },
    payments: {
      withholding: V("p-wh"), estimatedPayments: V("p-est"), extensionPayment: V("p-ext"),
      priorYearTax: V("p-pytax"), priorYearAGI: V("p-pyagi"),
    },
  };
}

function scheduleCompute() {
  clearTimeout(computeTimer);
  computeTimer = setTimeout(compute, 350);
}

function compute() {
  var payload = gather();
  var out = document.getElementById("d1040-body");
  fetch("/api/draft-return", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (x) {
      if (!x.ok || !x.d.success) {
        out.innerHTML = '<div class="dline"><span class="lbl" style="color:var(--ox)">' + (x.d.error || "Computation error") + "</span></div>";
        return;
      }
      render(x.d.result);
    })
    .catch(function () {
      out.innerHTML = '<div class="dline"><span class="lbl">Network error — is the server awake? Try again in a moment.</span></div>';
    });
}

function render(r) {
  var s = r.summary;
  document.getElementById("d1040-year").textContent = "TY " + r.taxYear;

  var stat = document.getElementById("d1040-stat");
  var refundSide = s.balance <= 0;
  stat.innerHTML =
    '<div><div class="v">' + fmt$(s.totalTax) + '</div><div class="k">Total tax</div></div>' +
    '<div><div class="v" style="color:' + (refundSide ? "var(--good)" : "var(--ox)") + '">' + fmt$(Math.abs(s.balance)) + '</div><div class="k">' + (refundSide ? "Refund" : "You owe") + "</div></div>" +
    '<div><div class="v">' + s.effectiveRate + '%</div><div class="k">Effective rate</div></div>';

  var body = document.getElementById("d1040-body");
  body.innerHTML = r.lines.map(function (l) {
    var cls = "dline" + (l.strong ? " strong" : "") + (l.good ? " good" : "") + (l.bad ? " bad" : "");
    return '<div class="' + cls + '"><span class="ln">' + l.line + '</span><span class="lbl">' + l.label +
      (l.memo ? "<small>" + l.memo + "</small>" : "") + '</span><span class="amt">' + fmt$(l.amount) + "</span></div>";
  }).join("");

  var extra = [];
  extra.push("Marginal rate: <b>" + s.marginalRate + "%</b> · Deduction used: <b>" + r.itemization.used + " (" + fmt$(r.itemization.used === "itemized" ? r.itemization.itemized : r.itemization.standard) + ")</b>" + (r.qbi.amount ? " · QBI: <b>" + fmt$(r.qbi.amount) + "</b>" : ""));
  if (s.capitalGainsTiers && s.capitalGainsTiers.length) {
    extra.push("Capital gains taxed at: " + s.capitalGainsTiers.map(function (t) { return fmt$(t.amount) + " @ " + Math.round(t.rate * 100) + "%"; }).join(", "));
  }
  if (r.safeHarbor) {
    extra.push((r.safeHarbor.met ? "✓ Safe harbor met" : "✗ Safe harbor NOT met") + " — required " + fmt$(r.safeHarbor.required) + " (" + r.safeHarbor.basis + ")");
  }
  document.getElementById("d1040-extra").innerHTML = extra.join("<br/>");

  var diag = document.getElementById("diag");
  diag.innerHTML = (r.diagnostics || []).map(function (d) {
    return '<li class="' + (d.indexOf("⚠") === 0 || d.indexOf("NOT met") !== -1 ? "warn" : "") + '">' + d + "</li>";
  }).join("");
  document.getElementById("results-wrap").style.display = "block";
}

function copyDraft() {
  var lines = Array.prototype.map.call(document.querySelectorAll("#d1040-body .dline"), function (el) {
    return el.querySelector(".ln").textContent + "\t" + el.querySelector(".lbl").childNodes[0].textContent.trim() + "\t" + el.querySelector(".amt").textContent;
  }).join("\n");
  navigator.clipboard.writeText("TaxClarity Draft 1040 (" + document.getElementById("d1040-year").textContent + ") — educational estimate\n\n" + lines)
    .then(function () { var b = document.getElementById("copy-btn"); b.textContent = "Copied ✓"; setTimeout(function () { b.textContent = "Copy draft"; }, 1600); });
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".builder-form input, .builder-form select").forEach(function (el) {
    el.addEventListener("input", scheduleCompute);
    el.addEventListener("change", scheduleCompute);
  });
  compute();
});
