// ── AGENT SYSTEM PROMPT ──────────────────────────────────────────
// ── AGENT STATE ───────────────────────────────────────────────────
// API key lives on the server — frontend calls /api/research only.
let agentLoading = false;
let agentResult = null;
let agentHistory = [];
let agentStageInterval = null;
let agentActiveTab = 'fed';
const STAGES = [
  "Identifying applicable authority...",
  "Analyzing IRC & Treasury Regulations...",
  "Reviewing SALT conformity — all 50 states...",
  "Examining pass-through entity rules...",
  "Checking 2025 OBBB changes...",
  "Drafting research memo...",
];

function setQ(q) { document.getElementById('ag-input').value = q; document.getElementById('ag-input').focus(); }

async function runAgent() {
  const q = document.getElementById('ag-input').value.trim();
  if (!q || agentLoading) return;

  agentLoading = true;
  document.getElementById('ag-btn').disabled = true;
  document.getElementById('ag-btn').textContent = 'RESEARCHING...';
  document.getElementById('ag-results').style.display = 'none';
  document.getElementById('ag-error').style.display = 'none';
  document.getElementById('ag-loading').style.display = 'block';

  let si = 0;
  document.getElementById('ag-stage-text').textContent = STAGES[0];
  agentStageInterval = setInterval(() => {
    si = (si + 1) % STAGES.length;
    document.getElementById('ag-stage-text').textContent = STAGES[si];
  }, 2000);

  try {
    // Call our own backend — API key never touches the browser
    const res = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    if (!data.result?.issue) throw new Error("Incomplete response — please try again.");

    agentResult = data.result;
    agentHistory.unshift({ q, result: data.result, ts: new Date() });
    if (agentHistory.length > 8) agentHistory.pop();
    renderAgentResult(data.result);
    renderAgentHistory();
  } catch(e) {
    document.getElementById('ag-error').style.display = 'block';
    document.getElementById('ag-error').textContent = '\u26a0 ' + (e.message || "Research failed. Please try again.");
  } finally {
    clearInterval(agentStageInterval);
    document.getElementById('ag-loading').style.display = 'none';
    agentLoading = false;
    document.getElementById('ag-btn').disabled = false;
    document.getElementById('ag-btn').textContent = 'RUN RESEARCH \u2192';
  }
}

function confColor(s) { return s >= 80 ? '#22c55e' : s >= 60 ? '#f59e0b' : '#ef4444'; }
function priColor(p) { return { High:'#ef4444', Medium:'#f59e0b', Low:'#6b7280' }[p] || '#6b7280'; }

function renderAgentResult(r) {
  // Memo header
  document.getElementById('ag-memo-date').textContent = `TAX RESEARCH MEMO · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}).toUpperCase()} · TAX YEAR 2025`;
  document.getElementById('ag-issue').textContent = 'Re: ' + (r.issue || '');
  document.getElementById('ag-summary').textContent = r.executive_summary || '';

  // Confidence
  const c = r.confidence || {};
  const col = confColor(c.score || 0);
  document.getElementById('ag-conf-bar').style.cssText = `width:${c.score||0}%;background:linear-gradient(90deg,${col}55,${col})`;
  document.getElementById('ag-conf-score').style.color = col;
  document.getElementById('ag-conf-score').textContent = `${c.label||''} · ${c.score||0}/100`;
  document.getElementById('ag-conf-rationale').textContent = c.rationale || '';

  // Authority
  const aList = document.getElementById('ag-authority-list');
  aList.innerHTML = '';
  const wColors = ['#d4af6a','#b8963e','#9ca3af','#6b7280'];
  (r.authority_hierarchy||[]).forEach((t,i) => {
    aList.innerHTML += `<div class="ag-authority-row">
      <div class="ag-auth-meta"><div class="ag-auth-weight" style="color:${wColors[i]||'#6b7280'}">${(t.weight||'').toUpperCase()}</div><div class="ag-auth-level">${t.level||''}</div></div>
      <div class="ag-auth-sources">${(t.sources||[]).map(s=>`<div class="ag-source-item">· ${s}</div>`).join('')}</div>
    </div>`;
  });

  // Federal
  document.getElementById('ag-federal-text').textContent = r.analysis?.federal || '';

  // SALT
  const salt = r.analysis?.salt || {};
  document.getElementById('ag-conformity').textContent = salt.conformity_overview || '';
  const sv = document.getElementById('ag-state-vars');
  sv.innerHTML = '';
  const svColors = ['#22c55e','#f59e0b','#ef4444'];
  (salt.state_variations||[]).forEach((v,i) => {
    sv.innerHTML += `<div class="ag-state-var">
      <div class="ag-state-cat" style="color:${svColors[i]||'#9ca3af'}">${(v.category||'').toUpperCase()}</div>
      <div class="ag-state-tags">${(v.states||[]).map(s=>`<span class="ag-state-tag">${s}</span>`).join('')}</div>
      <div class="ag-state-notes">${v.notes||''}</div>
    </div>`;
  });
  const riskEl = document.getElementById('ag-risk-states');
  if ((salt.high_risk_states||[]).length > 0) {
    riskEl.innerHTML = `<div class="ag-risk-box"><div class="ag-risk-title">⚠ HIGH-RISK STATES — ADDITIONAL REVIEW REQUIRED</div>${(salt.high_risk_states||[]).map(s=>`<div class="ag-risk-item">· ${s}</div>`).join('')}</div>`;
  } else riskEl.innerHTML = '';

  // Follow-up
  const fl = document.getElementById('ag-followup-list');
  fl.innerHTML = (r.follow_up_issues||[]).map(f => `<div class="ag-followup-item">
    <div class="ag-pri" style="color:${priColor(f.priority)}">${(f.priority||'').toUpperCase()}</div>
    <div><div class="ag-followup-title">${f.issue||''}</div><div class="ag-followup-why">${f.why||''}</div></div>
  </div>`).join('');

  // Planning
  const pl = document.getElementById('ag-planning-list');
  pl.innerHTML = (r.planning_opportunities||[]).map(p => `<div class="ag-planning-item"><span class="ag-planning-arrow">→</span>${p}</div>`).join('');

  // Caveats
  const cl = document.getElementById('ag-caveats-list');
  cl.innerHTML = (r.caveats||[]).map(c => `<div class="ag-caveat">· ${c}</div>`).join('');

  // Reset tabs
  switchAgTab('fed');
  document.getElementById('ag-results').style.display = 'block';
  document.getElementById('ag-results').scrollIntoView({ behavior:'smooth', block:'start' });
}

function switchAgTab(tab) {
  agentActiveTab = tab;
  ['fed','salt'].forEach(t => {
    document.getElementById(`ag-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`ag-panel-${t}`).style.display = t === tab ? 'block' : 'none';
  });
}

function renderAgentHistory() {
  const wrap = document.getElementById('ag-history-wrap');
  const list = document.getElementById('ag-history-list');
  if (agentHistory.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = agentHistory.slice(0,4).map((h,i) => `<div class="ag-history-item" onclick="loadHistory(${i})">
    <span class="ag-history-ts">${h.ts.toLocaleTimeString()}</span>
    <span>${h.q.length > 90 ? h.q.slice(0,90)+'…' : h.q}</span>
  </div>`).join('');
}

function loadHistory(i) {
  const h = agentHistory[i];
  if (!h) return;
  document.getElementById('ag-input').value = h.q;
  agentResult = h.result;
  renderAgentResult(h.result);
}

function copyMemo() {
  if (!agentResult) return;
  const r = agentResult;
  const text = `TAX RESEARCH MEMORANDUM — Tax Year 2025
Date: ${new Date().toLocaleDateString()}
Filed by: April 15, 2026
${'='.repeat(55)}

ISSUE: ${r.issue}

EXECUTIVE SUMMARY
${r.executive_summary}

CONFIDENCE: ${r.confidence?.label} (${r.confidence?.score}/100)
${r.confidence?.rationale}

AUTHORITY HIERARCHY
${(r.authority_hierarchy||[]).map(a=>`[${a.weight}] ${a.level}\n${(a.sources||[]).join('\n')}`).join('\n\n')}

FEDERAL ANALYSIS
${r.analysis?.federal}

SALT ANALYSIS — ALL 50 STATES
${r.analysis?.salt?.conformity_overview}
${(r.analysis?.salt?.state_variations||[]).map(v=>`\n${v.category}:\nStates: ${(v.states||[]).join(', ')}\n${v.notes}`).join('\n')}

FOLLOW-UP ISSUES
${(r.follow_up_issues||[]).map(f=>`[${f.priority}] ${f.issue}\n→ ${f.why}`).join('\n\n')}

PLANNING OPPORTUNITIES
${(r.planning_opportunities||[]).join('\n')}

CAVEATS
${(r.caveats||[]).join('\n')}`;
  navigator.clipboard.writeText(text);
  const btn = document.getElementById('ag-copy-btn');
  btn.textContent = '✓ COPIED'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = 'COPY MEMO'; btn.classList.remove('copied'); }, 2500);
}

// ── MAIN SITE JS ──────────────────────────────────────────────────
function toggleMobile() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.add('active');
  btn.classList.add('active');
}

function toggleAcc(header) {
  const body = header.nextElementSibling;
  const isOpen = header.classList.contains('open');
  document.querySelectorAll('.acc-header').forEach(h => { h.classList.remove('open'); h.nextElementSibling.classList.remove('open'); });
  if (!isOpen) { header.classList.add('open'); body.classList.add('open'); }
}

function filterGlossary() {
  const val = document.getElementById('gloss-search').value.toLowerCase();
  document.querySelectorAll('#gloss-grid .gloss-card').forEach(c => {
    c.style.display = ((c.dataset.term||'') + c.textContent.toLowerCase()).includes(val) ? 'block' : 'none';
  });
}

// ── TAX CALCULATOR ────────────────────────────────────────────────
const BRACKETS_2025 = {
  single: [{rate:.10,min:0,max:11925},{rate:.12,min:11925,max:48475},{rate:.22,min:48475,max:103350},{rate:.24,min:103350,max:197300},{rate:.32,min:197300,max:250525},{rate:.35,min:250525,max:626350},{rate:.37,min:626350,max:Infinity}],
  marriedFilingJointly: [{rate:.10,min:0,max:23850},{rate:.12,min:23850,max:96950},{rate:.22,min:96950,max:206700},{rate:.24,min:206700,max:394600},{rate:.32,min:394600,max:501050},{rate:.35,min:501050,max:751600},{rate:.37,min:751600,max:Infinity}],
  headOfHousehold: [{rate:.10,min:0,max:17000},{rate:.12,min:17000,max:64850},{rate:.22,min:64850,max:103350},{rate:.24,min:103350,max:197300},{rate:.32,min:197300,max:250500},{rate:.35,min:250500,max:626350},{rate:.37,min:626350,max:Infinity}],
  marriedFilingSeparately: [{rate:.10,min:0,max:11925},{rate:.12,min:11925,max:48475},{rate:.22,min:48475,max:103350},{rate:.24,min:103350,max:197300},{rate:.32,min:197300,max:250525},{rate:.35,min:250525,max:626350},{rate:.37,min:626350,max:Infinity}]
};
const STD_DED_2025 = { single:15750, marriedFilingJointly:31500, headOfHousehold:23625, marriedFilingSeparately:15750 };

function fmt(n) { return '$' + Math.round(n).toLocaleString(); }
function fmtPct(n) { return (Math.round(n*100)/100).toFixed(1) + '%'; }

function calculateTax() {
  const income = parseFloat(document.getElementById('calc-income').value);
  const status = document.getElementById('calc-status').value;
  const itemized = parseFloat(document.getElementById('calc-deductions').value) || 0;
  const credits = parseFloat(document.getElementById('calc-credits').value) || 0;

  if (!income || income <= 0) { alert('Please enter a valid income amount.'); return; }

  const brackets = BRACKETS_2025[status];
  const stdDed = STD_DED_2025[status] || 15750;
  const dedAmt = itemized > stdDed ? itemized : stdDed;
  const dedType = itemized > stdDed ? 'Itemized' : 'Standard';
  const taxable = Math.max(0, income - dedAmt);

  let totalTax = 0;
  let breakdown = [];
  let marginalRate = 0.10;

  for (const b of brackets) {
    if (taxable <= b.min) break;
    const amt = Math.min(taxable, b.max) - b.min;
    const tax = amt * b.rate;
    totalTax += tax;
    marginalRate = b.rate;
    breakdown.push({ rate: b.rate, amt: Math.round(amt), tax: Math.round(tax) });
  }

  const netTax = Math.max(0, totalTax - credits);
  const effectiveRate = income > 0 ? (netTax / income) * 100 : 0;
  const maxTax = breakdown.reduce((a,b) => a + b.tax, 0);

  const el = document.getElementById('calc-result');
  el.innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-family:'Playfair Display',serif;font-size:13px;color:var(--text3);margin-bottom:6px">TAX YEAR 2025 ESTIMATE · DUE APRIL 15, 2026</div>
      <div style="font-size:36px;font-weight:700;color:var(--teal);font-family:'Playfair Display',serif">${fmt(netTax)}</div>
      <div style="font-size:13px;color:var(--text3)">Estimated Federal Tax${credits > 0 ? ` (after ${fmt(credits)} in credits)` : ''}</div>
    </div>
    <div class="result-row"><span class="result-label">Gross Income</span><span class="result-val">${fmt(income)}</span></div>
    <div class="result-row"><span class="result-label">${dedType} Deduction</span><span class="result-val" style="color:var(--green)">− ${fmt(dedAmt)}</span></div>
    <div class="result-row"><span class="result-label">Taxable Income</span><span class="result-val">${fmt(taxable)}</span></div>
    <div class="result-row"><span class="result-label">Federal Tax (before credits)</span><span class="result-val">${fmt(totalTax)}</span></div>
    ${credits > 0 ? `<div class="result-row"><span class="result-label">Tax Credits</span><span class="result-val" style="color:var(--green)">− ${fmt(credits)}</span></div>` : ''}
    <div class="result-row" style="border-top:2px solid var(--teal);margin-top:4px;padding-top:12px"><span class="result-label" style="font-weight:700;color:var(--navy)">Net Federal Tax</span><span class="result-val highlight">${fmt(netTax)}</span></div>
    <div class="result-row"><span class="result-label">Effective Tax Rate</span><span class="result-val">${fmtPct(effectiveRate)}</span></div>
    <div class="result-row"><span class="result-label">Marginal (Top) Bracket</span><span class="result-val">${fmtPct(marginalRate*100)}</span></div>
    <div class="bracket-viz" style="margin-top:16px">
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px;font-family:'JetBrains Mono',monospace;letter-spacing:.06em">BRACKET BREAKDOWN</div>
      ${breakdown.map(b => {
        const pct = maxTax > 0 ? (b.tax / maxTax) * 100 : 0;
        const col = b.rate <= 0.12 ? '#22a898' : b.rate <= 0.24 ? '#c9933a' : '#c0392b';
        return `<div class="bv-row"><div class="bv-rate">${(b.rate*100).toFixed(0)}%</div><div class="bv-bar-wrap"><div class="bv-bar" style="width:${pct}%;background:${col}"></div></div><div class="bv-amt">${fmt(b.tax)}</div></div>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:12px;font-style:italic">⚠ Estimate only. Does not include state taxes, FICA, AMT, or all credits/deductions. OBBB 2025 rates applied.</div>
  `;
}

// ── CALCULATOR TAB SWITCHING ──────────────────────────────────────
function switchCalcTab(name, btn) {
  document.querySelectorAll('.calc-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.calc-tab-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById('calcpanel-' + name);
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');
}

// ── SELF-EMPLOYMENT TAX CALCULATOR ───────────────────────────────
function calculateSE() {
  const seIncome = parseFloat(document.getElementById('se-income').value);
  const status = document.getElementById('se-status').value;
  const otherIncome = parseFloat(document.getElementById('se-other-income').value) || 0;
  if (!seIncome || seIncome <= 0) { alert('Enter your net SE income.'); return; }

  const seBase = seIncome * 0.9235;
  const ssWageBase = 176100;
  const ssFromOther = Math.min(otherIncome, ssWageBase);
  const ssRemaining = Math.max(0, ssWageBase - ssFromOther);
  const ssSE = Math.min(seBase, ssRemaining) * 0.124;
  const mediSE = seBase * 0.029;
  const addlMediThreshold = status === 'marriedFilingJointly' ? 250000 : 200000;
  const totalEarnings = otherIncome + seBase;
  const addlMedi = totalEarnings > addlMediThreshold ? Math.min(seBase, totalEarnings - addlMediThreshold) * 0.009 : 0;
  const totalSE = ssSE + mediSE + addlMedi;
  const seDeduction = totalSE / 2;
  const qbi = seIncome * 0.20;

  const totalIncome = otherIncome + seIncome;
  const stdDed = STD_DED_2025[status] || 15750;
  const taxableIncome = Math.max(0, totalIncome - stdDed - seDeduction);
  const brackets = BRACKETS_2025[status];
  let incomeTax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    incomeTax += (Math.min(taxableIncome, b.max) - b.min) * b.rate;
  }
  const totalTax = incomeTax + totalSE;
  const effectiveRate = totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0;
  const quarterly = totalTax / 4;

  document.getElementById('se-result').innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-family:'Playfair Display',serif;font-size:13px;color:var(--text3);margin-bottom:6px">SELF-EMPLOYMENT TAX · 2025</div>
      <div style="font-size:36px;font-weight:700;color:var(--teal);font-family:'Playfair Display',serif">${fmt(totalTax)}</div>
      <div style="font-size:13px;color:var(--text3)">Combined Income + SE Tax</div>
    </div>
    <div class="se-breakdown">
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px;font-weight:600;letter-spacing:.06em">SE TAX BREAKDOWN</div>
      <div class="se-row"><span>Net SE income × 92.35%</span><span>${fmt(seBase)}</span></div>
      <div class="se-row"><span>Social Security (12.4%)</span><span>${fmt(ssSE)}</span></div>
      <div class="se-row"><span>Medicare (2.9%)</span><span>${fmt(mediSE)}</span></div>
      ${addlMedi > 0 ? `<div class="se-row"><span>Additional Medicare (0.9%)</span><span>${fmt(addlMedi)}</span></div>` : ''}
      <div class="se-row total"><span>Total SE Tax</span><span>${fmt(totalSE)}</span></div>
    </div>
    <div class="se-breakdown" style="margin-top:10px">
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px;font-weight:600;letter-spacing:.06em">INCOME TAX</div>
      <div class="se-row"><span>½ SE deduction</span><span style="color:var(--green)">− ${fmt(seDeduction)}</span></div>
      <div class="se-row"><span>Standard deduction</span><span style="color:var(--green)">− ${fmt(stdDed)}</span></div>
      <div class="se-row"><span>§199A QBI deduction (20%)</span><span style="color:var(--green)">− ${fmt(qbi)}</span></div>
      <div class="se-row"><span>Taxable income</span><span>${fmt(taxableIncome)}</span></div>
      <div class="se-row total"><span>Federal income tax</span><span>${fmt(incomeTax)}</span></div>
    </div>
    <div class="result-row" style="border-top:2px solid var(--teal);margin-top:12px;padding-top:12px"><span class="result-label" style="font-weight:700">Effective rate (all taxes / total income)</span><span class="result-val highlight">${fmtPct(effectiveRate)}</span></div>
    <div class="result-row"><span class="result-label">Quarterly estimated payment (Form 1040-ES)</span><span class="result-val" style="color:var(--gold)">${fmt(quarterly)}</span></div>
    <div style="font-size:11px;color:var(--text3);margin-top:12px;font-style:italic">⚠ Does not include state taxes. QBI deduction shown for reference — subject to W-2/UBIA limits above phase-out.</div>
  `;
}

// ── WITHHOLDING CHECK ────────────────────────────────────────────
function calculateWithholding() {
  const income = parseFloat(document.getElementById('wh-income').value);
  const status = document.getElementById('wh-status').value;
  const withheld = parseFloat(document.getElementById('wh-withheld').value) || 0;
  const estimated = parseFloat(document.getElementById('wh-estimated').value) || 0;
  if (!income || income <= 0) { alert('Enter your expected income.'); return; }

  const stdDed = STD_DED_2025[status] || 15750;
  const taxable = Math.max(0, income - stdDed);
  const brackets = BRACKETS_2025[status];
  let totalTax = 0;
  for (const b of brackets) {
    if (taxable <= b.min) break;
    totalTax += (Math.min(taxable, b.max) - b.min) * b.rate;
  }

  const totalPaid = withheld + estimated;
  const diff = totalPaid - totalTax;
  const isRefund = diff >= 0;
  const penaltyRisk = !isRefund && Math.abs(diff) > 1000;

  document.getElementById('wh-result').innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-family:'Playfair Display',serif;font-size:13px;color:var(--text3);margin-bottom:6px">WITHHOLDING CHECK · APRIL 2026</div>
      <div style="font-size:36px;font-weight:700;color:${isRefund ? 'var(--green2)' : 'var(--red2)'};font-family:'Playfair Display',serif">${isRefund ? '+' : '−'} ${fmt(Math.abs(diff))}</div>
      <div style="font-size:14px;color:${isRefund ? 'var(--green2)' : 'var(--red2)'};font-weight:600">${isRefund ? '🎉 Estimated REFUND' : '⚠️ Estimated BALANCE DUE'}</div>
    </div>
    <div class="result-row"><span class="result-label">Estimated 2025 tax liability</span><span class="result-val">${fmt(totalTax)}</span></div>
    <div class="result-row"><span class="result-label">Federal tax withheld</span><span class="result-val" style="color:var(--green)">− ${fmt(withheld)}</span></div>
    <div class="result-row"><span class="result-label">Estimated payments made</span><span class="result-val" style="color:var(--green)">− ${fmt(estimated)}</span></div>
    <div class="result-row" style="border-top:2px solid ${isRefund ? 'var(--green2)' : 'var(--red2)'};margin-top:4px;padding-top:12px"><span class="result-label" style="font-weight:700">${isRefund ? 'Overpayment (refund)' : 'Underpayment (owe)'}</span><span class="result-val highlight" style="color:${isRefund ? 'var(--green2)' : 'var(--red2)'}">${fmt(Math.abs(diff))}</span></div>
    ${penaltyRisk ? '<div class="tip warn" style="margin-top:14px"><div class="tip-icon">⚠️</div><p>You may owe an <strong>underpayment penalty</strong> if you owe $1,000+ at filing. Consider making an estimated payment by January 15, 2026 (Q4) or adjusting your W-4 withholding now.</p></div>' : ''}
    ${isRefund && diff > 3000 ? '<div class="tip info" style="margin-top:14px"><div class="tip-icon">💡</div><p>A large refund means you\'re giving the IRS an interest-free loan. Consider reducing your W-4 withholding to keep more in each paycheck.</p></div>' : ''}
    <div style="font-size:11px;color:var(--text3);margin-top:12px;font-style:italic">⚠ Estimate only. Uses standard deduction and does not account for credits, SE tax, cap gains, or state taxes.</div>
  `;
}

// ── CAPITAL GAINS CALCULATOR ─────────────────────────────────────
function calculateCapGains() {
  const ordinary = parseFloat(document.getElementById('cg-ordinary').value) || 0;
  const ltcg = parseFloat(document.getElementById('cg-ltcg').value) || 0;
  const stcg = parseFloat(document.getElementById('cg-stcg').value) || 0;
  const status = document.getElementById('cg-status').value;
  if (ltcg <= 0 && stcg <= 0) { alert('Enter at least one capital gain amount.'); return; }

  const rate0Max = { single: 48350, marriedFilingJointly: 96700, headOfHousehold: 64750 }[status] || 48350;
  const rate15Max = { single: 533400, marriedFilingJointly: 600050, headOfHousehold: 566700 }[status] || 533400;
  const niitThreshold = status === 'marriedFilingJointly' ? 250000 : 200000;

  // STCG taxed as ordinary income
  const brackets = BRACKETS_2025[status];
  const totalOrdinary = ordinary + stcg;
  let stcgTax = 0;
  for (const b of brackets) {
    if (totalOrdinary <= b.min) break;
    stcgTax += (Math.min(totalOrdinary, b.max) - b.min) * b.rate;
  }
  let ordOnlyTax = 0;
  for (const b of brackets) {
    if (ordinary <= b.min) break;
    ordOnlyTax += (Math.min(ordinary, b.max) - b.min) * b.rate;
  }
  const stcgTaxOnly = stcgTax - ordOnlyTax;

  // LTCG
  let ltcgTax = 0, at0 = 0, at15 = 0, at20 = 0;
  if (ltcg > 0) {
    const room0 = Math.max(0, rate0Max - ordinary);
    at0 = Math.min(ltcg, room0);
    const room15 = Math.max(0, rate15Max - Math.max(ordinary, rate0Max));
    at15 = Math.min(ltcg - at0, room15);
    at20 = Math.max(0, ltcg - at0 - at15);
    ltcgTax = at15 * 0.15 + at20 * 0.20;
  }

  // NIIT
  const agi = ordinary + ltcg + stcg;
  let niit = 0;
  if (agi > niitThreshold) {
    const niitIncome = Math.min(ltcg + stcg, agi - niitThreshold);
    niit = niitIncome * 0.038;
  }

  const totalGainsTax = stcgTaxOnly + ltcgTax + niit;

  document.getElementById('cg-result').innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-family:'Playfair Display',serif;font-size:13px;color:var(--text3);margin-bottom:6px">CAPITAL GAINS TAX · 2025</div>
      <div style="font-size:36px;font-weight:700;color:var(--teal);font-family:'Playfair Display',serif">${fmt(totalGainsTax)}</div>
      <div style="font-size:13px;color:var(--text3)">Tax on investment gains</div>
    </div>
    ${stcg > 0 ? `<div class="se-breakdown"><div style="font-size:11px;color:var(--text3);margin-bottom:8px;font-weight:600">SHORT-TERM GAINS (ordinary rates)</div>
      <div class="se-row"><span>Short-term gains</span><span>${fmt(stcg)}</span></div>
      <div class="se-row total"><span>Tax (at marginal rate)</span><span>${fmt(stcgTaxOnly)}</span></div></div>` : ''}
    ${ltcg > 0 ? `<div class="se-breakdown" style="margin-top:10px"><div style="font-size:11px;color:var(--text3);margin-bottom:8px;font-weight:600">LONG-TERM GAINS (preferential rates)</div>
      ${at0 > 0 ? `<div class="se-row"><span>Taxed at 0%</span><span>${fmt(at0)}</span></div>` : ''}
      ${at15 > 0 ? `<div class="se-row"><span>Taxed at 15%</span><span>${fmt(at15)} → ${fmt(at15*0.15)}</span></div>` : ''}
      ${at20 > 0 ? `<div class="se-row"><span>Taxed at 20%</span><span>${fmt(at20)} → ${fmt(at20*0.20)}</span></div>` : ''}
      <div class="se-row total"><span>LTCG tax</span><span>${fmt(ltcgTax)}</span></div></div>` : ''}
    ${niit > 0 ? `<div class="se-breakdown" style="margin-top:10px;border-color:var(--red2)"><div style="font-size:11px;color:var(--red2);margin-bottom:8px;font-weight:600">NET INVESTMENT INCOME TAX (3.8%)</div>
      <div class="se-row"><span>AGI above ${fmt(niitThreshold)} threshold</span><span>${fmt(niit / 0.038)}</span></div>
      <div class="se-row total"><span>NIIT</span><span style="color:var(--red2)">${fmt(niit)}</span></div></div>` : ''}
    <div class="result-row" style="border-top:2px solid var(--teal);margin-top:12px;padding-top:12px"><span class="result-label" style="font-weight:700">Total tax on gains</span><span class="result-val highlight">${fmt(totalGainsTax)}</span></div>
    <div style="font-size:11px;color:var(--text3);margin-top:12px;font-style:italic">⚠ Estimate only. Does not include state capital gains tax, AMT, collectibles (28%), or unrecaptured §1250 (25%).</div>
  `;
}

// ── SCROLL & NAV ──────────────────────────────────────────────────
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

const sections = document.querySelectorAll('section[id], div[id]');
const navLinks = document.querySelectorAll('.nav-links a');
window.addEventListener('scroll', () => {
  let cur = '';
  sections.forEach(s => { if (window.scrollY >= s.offsetTop - 120) cur = s.id; });
  navLinks.forEach(a => { a.classList.toggle('active', a.getAttribute('href') === '#'+cur); });
});
// ── FILING DEADLINE COUNTDOWN ────────────────────────────────────
function updateCountdown() {
  const deadline = new Date('2026-04-15T23:59:59');
  const now = new Date();
  const diff = deadline - now;
  if (diff <= 0) { document.getElementById('countdown-text').textContent = 'Filing deadline has passed!'; return; }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const el = document.getElementById('countdown-text');
  if (el) el.innerHTML = `<span class="cd-num">${days}</span><span class="cd-label">days</span><span class="cd-num">${hours}</span><span class="cd-label">hrs</span><span class="cd-num">${mins}</span><span class="cd-label">min</span>`;
}
if (document.getElementById('countdown-text')) {
  updateCountdown();
  setInterval(updateCountdown, 60000);
}

// ── ANIMATED STAT COUNTERS ───────────────────────────────────────
function animateValue(el, start, end, duration, prefix, suffix) {
  let startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    const progress = Math.min((ts - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const val = Math.floor(start + (end - start) * eased);
    el.textContent = (prefix || '') + val.toLocaleString() + (suffix || '');
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

const statObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting && !e.target.dataset.animated) {
      e.target.dataset.animated = 'true';
      const end = parseInt(e.target.dataset.value);
      const prefix = e.target.dataset.prefix || '';
      const suffix = e.target.dataset.suffix || '';
      animateValue(e.target, 0, end, 1500, prefix, suffix);
    }
  });
}, { threshold: 0.5 });
document.querySelectorAll('.stat-animate').forEach(el => statObserver.observe(el));

// ── QUICK SITUATION FINDER ───────────────────────────────────────
function showSituation(type) {
  const map = {
    'employee': '#taxes',
    'selfemployed': '#business',
    'investor': '#calculator',
    'international': '#international',
    'business': '#business',
    'audit': '#audit'
  };
  const target = map[type] || '#taxes';
  
  // Highlight the relevant section briefly
  const section = document.querySelector(target);
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.style.boxShadow = '0 0 0 4px var(--teal3)';
    setTimeout(() => { section.style.boxShadow = ''; }, 2000);
  }
  
  // If calculator related, switch to the right tab
  if (type === 'selfemployed') {
    setTimeout(() => {
      const seBtn = document.querySelector('.calc-tab-btn:nth-child(2)');
      if (seBtn) switchCalcTab('se', seBtn);
    }, 800);
  }
  if (type === 'investor') {
    setTimeout(() => {
      const cgBtn = document.querySelector('.calc-tab-btn:nth-child(4)');
      if (cgBtn) switchCalcTab('capgains', cgBtn);
    }, 800);
  }
}

// ── NEXT DEADLINE HIGHLIGHTER ────────────────────────────────────
function highlightNextDeadline() {
  const now = new Date();
  const deadlines = document.querySelectorAll('.dl-item');
  let found = false;
  deadlines.forEach(d => {
    const dateStr = d.dataset.date;
    if (!dateStr) return;
    const date = new Date(dateStr);
    if (!found && date > now) {
      d.classList.add('dl-next');
      found = true;
    }
  });
}
highlightNextDeadline();
