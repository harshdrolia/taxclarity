/**
 * TaxClarity v3.0 — Express Backend ("Statute" release)
 * TY2025 + TY2026 data · Draft Return Engine · Cited AI Research · Site Search
 */

"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const engine = require("./lib/taxengine");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const DEBUG = process.env.DEBUG === "true";

// ── Load data ─────────────────────────────────────────────────────
function loadJSON(p) { return JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8")); }
let D2025, D2026, AUTHORITIES, GLOSSARY;
try {
  D2025 = loadJSON("data/tax-2025.json");
  D2026 = loadJSON("data/tax-2026.json");
  AUTHORITIES = loadJSON("data/authority-directory.json");
  GLOSSARY = fs.existsSync(path.join(__dirname, "data/glossary.json")) ? loadJSON("data/glossary.json") : [];
  engine.init({ 2025: D2025, 2026: D2026 });
  console.log(`✅ Data loaded: TY2025, TY2026, ${AUTHORITIES.irc.length + AUTHORITIES.regs.length + AUTHORITIES.forms.length + AUTHORITIES.pubs.length} authorities, ${GLOSSARY.length} glossary terms`);
} catch (err) {
  console.error("❌ Failed to load data:", err.message);
  process.exit(1);
}
const dataFor = (req) => (String(req.query.year || (req.body && req.body.year)) === "2026" ? D2026 : D2025);

// ── Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors(allowed.length ? { origin: allowed } : {}));
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "7d",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: "Too many requests, please try again later." } });
app.use("/api/", apiLimiter);

// ══════════════════════════════════════════════════════════════════
// CITATION LINK BUILDER — deterministic links to primary sources
// ══════════════════════════════════════════════════════════════════
function ircUrl(ref) {
  const sec = String(ref).replace(/^§\s*/, "").trim();
  const base = sec.match(/^[0-9]+[A-Za-z]*/);
  if (!base) return null;
  const anchorMatch = sec.match(/\(([a-z0-9]+)\)/i);
  const anchor = anchorMatch ? `#${anchorMatch[1].toLowerCase()}` : "";
  return `https://www.law.cornell.edu/uscode/text/26/${base[0]}${anchor}`;
}
function regUrl(ref) {
  const r = String(ref).replace(/^(Treas\.?\s*Reg\.?|Reg\.?)\s*§?\s*/i, "").trim().match(/^[0-9]+[A-Za-z]?\.[0-9A-Za-z().-]+/);
  if (!r) return null;
  const clean = r[0].replace(/\((.*?)\)/g, "");
  return `https://www.law.cornell.edu/cfr/text/26/${clean}`;
}
const FORM_SLUGS = Object.fromEntries((AUTHORITIES.forms || []).map((f) => [f.ref.toUpperCase(), f.slug]));
function formUrl(ref) {
  const slug = FORM_SLUGS[String(ref).toUpperCase()];
  return slug ? `https://www.irs.gov/forms-pubs/${slug}` : `https://www.irs.gov/site-index-search?search=${encodeURIComponent("Form " + ref)}`;
}
function pubUrl(ref) { return `https://www.irs.gov/publications/p${String(ref).toLowerCase().replace(/[^0-9ab-]/g, "")}`; }
function irsSearch(q) { return `https://www.irs.gov/site-index-search?search=${encodeURIComponent(q)}`; }
function caseUrl(name) { return `https://www.courtlistener.com/?q=${encodeURIComponent(name)}&type=o`; }

function linkifyCitation(c) {
  const type = String(c.type || "").toLowerCase();
  const ref = c.ref || c.section || c.title || "";
  let url = null, display = c.display || null, exact = true;
  switch (type) {
    case "irc": url = ircUrl(ref); display = display || `IRC §${String(ref).replace(/^§/, "")}`; break;
    case "reg": url = regUrl(ref); display = display || `Treas. Reg. §${ref}`; break;
    case "form": url = formUrl(ref); display = display || `Form ${ref}`; break;
    case "pub": url = pubUrl(ref); display = display || `IRS Pub. ${ref}`; break;
    case "revrul": url = irsSearch(`Revenue Ruling ${ref}`); display = display || `Rev. Rul. ${ref}`; exact = false; break;
    case "revproc": url = irsSearch(`Revenue Procedure ${ref}`); display = display || `Rev. Proc. ${ref}`; exact = false; break;
    case "notice": url = irsSearch(`Notice ${ref}`); display = display || `Notice ${ref}`; exact = false; break;
    case "case": url = caseUrl(ref); display = display || ref; exact = false; break;
    default: url = irsSearch(String(ref)); display = display || String(ref); exact = false;
  }
  return { ...c, type, ref, display, url, exact };
}
function autoLink(text) {
  const irc = text.match(/IRC\s*§+\s*([0-9]+[A-Za-z]?(\([a-z0-9]+\))?)/i);
  if (irc) return { url: ircUrl(irc[1]), linkType: "irc" };
  const reg = text.match(/(?:Treas\.?\s*)?Reg\.?\s*§+\s*([0-9]+[A-Za-z]?\.[0-9A-Za-z().-]+)/i);
  if (reg) return { url: regUrl(reg[1]), linkType: "reg" };
  const rr = text.match(/Rev\.?\s*Rul\.?\s*([0-9]{2,4}-[0-9]+)/i);
  if (rr) return { url: irsSearch(`Revenue Ruling ${rr[1]}`), linkType: "revrul" };
  const rp = text.match(/Rev\.?\s*Proc\.?\s*([0-9]{2,4}-[0-9]+)/i);
  if (rp) return { url: irsSearch(`Revenue Procedure ${rp[1]}`), linkType: "revproc" };
  const vs = text.match(/^([A-Z][A-Za-z'. ]+ v\.? [A-Za-z'. ]+)/);
  if (vs) return { url: caseUrl(vs[1]), linkType: "case" };
  return { url: null };
}
function linkifyDeep(result) {
  if (Array.isArray(result.authority_hierarchy)) {
    result.authority_hierarchy = result.authority_hierarchy.map((lvl) => ({
      ...lvl,
      sources: (lvl.sources || []).map((s) => (typeof s === "string" ? { text: s, ...autoLink(s) } : { ...s, ...autoLink(s.text || "") })),
    }));
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// SITE SEARCH — index built at boot
// ══════════════════════════════════════════════════════════════════
let SEARCH_INDEX = [];
function buildSearchIndex() {
  const idx = [];
  const push = (o) => idx.push({ ...o, hay: `${o.title} ${o.snippet} ${o.keywords || ""}`.toLowerCase() });
  for (const s of AUTHORITIES.irc) push({ kind: "IRC", title: `IRC §${s.ref} — ${s.title}`, snippet: s.desc, url: ircUrl(s.ref), topic: s.topic, keywords: `section ${s.ref} usc 26` });
  for (const s of AUTHORITIES.regs) push({ kind: "Reg", title: `Treas. Reg. §${s.ref} — ${s.title}`, snippet: s.desc, url: regUrl(s.ref), topic: s.topic, keywords: "regulation treasury" });
  for (const f of AUTHORITIES.forms) push({ kind: "Form", title: `Form ${f.ref} — ${f.title}`, snippet: f.desc, url: formUrl(f.ref), topic: "Forms", keywords: "irs form" });
  for (const p of AUTHORITIES.pubs) push({ kind: "Pub", title: `IRS Pub. ${p.ref} — ${p.title}`, snippet: p.desc, url: pubUrl(p.ref), topic: "Publications", keywords: "publication guide" });
  for (const g of GLOSSARY) push({ kind: "Glossary", title: g.term, snippet: g.def, url: `/glossary.html#${encodeURIComponent(g.term.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`, topic: "Glossary", keywords: g.keywords || "" });
  const guides = [
    ["Individual taxes — the complete walkthrough", "Filing status, income, deductions, credits, and how a 1040 actually fits together.", "/guides.html#taxes", "brackets standard deduction filing status w-2 refund"],
    ["Business taxes — S-corps, partnerships, C-corps", "Reasonable comp, shareholder basis, K-1s, §754, ASC 740, PTE elections.", "/guides.html#business", "s corporation partnership llc k-1 basis 754 asc 740 pte salt"],
    ["Financial planning", "Retirement accounts, HSAs, investing and tax-efficient wealth building.", "/guides.html#planning", "401k ira roth hsa retirement compound"],
    ["IRS letters & audits", "Notice decoding, audit rights, penalties, and response strategy.", "/guides.html#audit", "audit notice cp2000 penalty abatement letter"],
    ["International students & nonresidents", "1040-NR, residency tests, treaties, FICA exemptions.", "/guides.html#international", "f-1 opt nonresident treaty 1040nr fica"],
    ["AI and the future of tax careers", "How automation reshapes tax work and how to stay valuable.", "/guides.html#ai-career", "career automation future"],
    ["Free professional templates", "Partnership basis, ASC 740 provision, penalty abatement, audit response.", "/guides.html#downloads", "template download excel workbook worksheet"],
    ["Draft Return Builder", "Build an educational draft Form 1040 line by line for 2025 or 2026.", "/calculator.html", "calculator refund estimate draft 1040 owe"],
    ["AI Tax Research Agent", "Structured research memos with linked citations to the IRC and regulations.", "/research.html", "research memo ai citations agent"],
    ["Authority Directory", "Curated IRC sections, regulations, forms and publications — all linked to primary sources.", "/research.html#authorities", "code section directory cornell"],
  ];
  for (const [title, snippet, url, keywords] of guides) push({ kind: "Guide", title, snippet, url, topic: "Guides", keywords });
  SEARCH_INDEX = idx;
  console.log(`🔎 Search index: ${idx.length} entries`);
}

function searchQuery(q, limit = 12) {
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return [];
  const secMatch = q.match(/(?:§|sec(?:tion)?\.?\s*)?\s*([0-9]{1,4}[A-Za-z]?)\b/i);
  const scored = [];
  for (const e of SEARCH_INDEX) {
    let score = 0;
    for (const t of terms) {
      if (e.hay.includes(t)) score += 2;
      if (e.title.toLowerCase().includes(t)) score += 3;
      if (e.title.toLowerCase().startsWith(t)) score += 2;
    }
    if (secMatch && e.kind === "IRC" && e.title.includes(`§${secMatch[1]} `)) score += 8;
    if (score > 0) scored.push({ ...e, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ hay, ...rest }) => rest);
}

buildSearchIndex();

// ══════════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════════
app.get("/api/tax-data", (req, res) => res.json({ success: true, data: dataFor(req) }));
app.get("/api/deadlines", (req, res) => { const D = dataFor(req); res.json({ success: true, taxYear: D.meta.taxYear, deadlines: D.deadlines }); });
app.get("/api/brackets/:status", (req, res) => {
  const D = dataFor(req);
  const brackets = D.brackets[req.params.status];
  if (!brackets) return res.status(404).json({ error: "Filing status not found" });
  res.json({ success: true, filingStatus: req.params.status, taxYear: D.meta.taxYear, brackets });
});
app.get("/api/new-laws", (req, res) => { const D = dataFor(req); res.json({ success: true, title: `OBBBA — ${D.meta.taxYear} figures`, changes: D.obbbChanges }); });
app.get("/api/downloads", (req, res) => res.json({ success: true, downloads: D2025.downloads }));
app.get("/api/retirement", (req, res) => { const D = dataFor(req); res.json({ success: true, taxYear: D.meta.taxYear, limits: D.retirement }); });
app.get("/api/credits", (req, res) => { const D = dataFor(req); res.json({ success: true, taxYear: D.meta.taxYear, credits: D.credits }); });
app.get("/api/self-employment", (req, res) => { const D = dataFor(req); res.json({ success: true, taxYear: D.meta.taxYear, data: D.selfEmployment }); });
app.get("/api/states", (req, res) => res.json({ success: true, data: D2025.stateInfo }));
app.get("/api/authorities", (req, res) => {
  res.json({
    success: true,
    meta: AUTHORITIES.meta,
    authorities: {
      irc: AUTHORITIES.irc.map((s) => ({ ...s, url: ircUrl(s.ref) })),
      regs: AUTHORITIES.regs.map((s) => ({ ...s, url: regUrl(s.ref) })),
      forms: AUTHORITIES.forms.map((f) => ({ ...f, url: formUrl(f.ref) })),
      pubs: AUTHORITIES.pubs.map((p) => ({ ...p, url: pubUrl(p.ref) })),
    },
  });
});
app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").slice(0, 120);
  if (q.trim().length < 2) return res.json({ success: true, results: [] });
  res.json({ success: true, query: q, results: searchQuery(q) });
});

// Draft Return Builder
app.post("/api/draft-return", (req, res) => {
  try {
    const result = engine.draftReturn(req.body || {});
    res.json({ success: true, result });
  } catch (err) {
    if (DEBUG) console.error("[ENGINE]", err);
    res.status(400).json({ error: "Could not compute draft return: " + err.message });
  }
});

// Legacy simple calculator (kept for compatibility)
app.post("/api/calculate-tax", (req, res) => {
  const { income, filingStatus, itemizedDeductions, selfEmployed, selfEmploymentIncome, longTermCapGains, year } = req.body || {};
  if (typeof income !== "number" || income < 0) return res.status(400).json({ error: "Valid income amount required" });
  if (!filingStatus) return res.status(400).json({ error: "Filing status required" });
  try {
    const d = engine.simpleTax(year === 2026 ? 2026 : 2025, income, filingStatus, itemizedDeductions, { selfEmployed, selfEmploymentIncome, longTermCapGains });
    res.json({ success: true, result: d.summary, draft: d });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Email delivery (newsletter + contact) ─────────────────────────
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  const nodemailer = require("nodemailer");
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  console.log("📧 Email delivery configured");
} else {
  console.log("📧 Email delivery NOT configured (set SMTP_USER / SMTP_PASS / NOTIFY_EMAIL) — submissions will only be logged");
}
async function notify(subject, text) {
  console.log(`[NOTIFY] ${subject} | ${text.slice(0, 160).replace(/\n/g, " ")}`);
  if (!transporter) return false;
  try {
    await transporter.sendMail({ from: process.env.SMTP_USER, to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER, subject: `[TaxClarity] ${subject}`, text });
    return true;
  } catch (err) { console.error("[MAIL]", err.message); return false; }
}
const formLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: "Too many submissions — please try again later." } });

app.post("/api/newsletter", formLimiter, async (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Valid email required" });
  await notify("Newsletter signup", `New subscriber: ${email}\nTime: ${new Date().toISOString()}`);
  res.json({ success: true, message: "Subscribed — deadline reminders and plain-English updates, no spam." });
});

app.post("/api/contact", formLimiter, async (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ error: "Name, email, and message required" });
  await notify(`Contact: ${String(subject || "General").slice(0, 80)}`, `From: ${String(name).slice(0, 100)} <${String(email).slice(0, 100)}>\n\n${String(message).slice(0, 4000)}`);
  res.json({ success: true, message: "Message received — expect a reply within 1–2 business days." });
});

app.get("/api/health", (req, res) => res.json({
  status: "ok", service: "TaxClarity API", version: "3.0.0",
  taxYears: [2025, 2026], searchEntries: SEARCH_INDEX.length,
  ai: !!process.env.ANTHROPIC_API_KEY, email: !!transporter, webSearch: process.env.ENABLE_WEB_SEARCH === "true",
  timestamp: new Date().toISOString(),
}));

// ══════════════════════════════════════════════════════════════════
// AI TAX RESEARCH AGENT — structured memo with linked citations
// ══════════════════════════════════════════════════════════════════
const agentLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, message: { error: "Research limit reached (20/hour). Please wait before trying again." } });

const AGENT_SYSTEM = `You are the TaxClarity Research Agent: a senior U.S. tax research specialist with deep expertise in pass-through entities, individual taxation, SALT, procedure, and international reporting. Today's law includes the One Big Beautiful Bill Act (OBBBA, P.L. 119-21, signed July 4, 2025): TY2025 figures ($15,750/$31,500 standard deduction, $40,000 SALT cap, $2,200 CTC) and TY2026 figures per Rev. Proc. 2025-32 ($16,100/$32,200 standard deduction, $40,400 SALT cap, AMT exemption phaseout reset to $500K/$1M at a 50% rate).

CRITICAL OUTPUT RULES:
1. Respond ONLY with a single valid JSON object. Begin with { and end with }. No markdown fences, no prose outside JSON.
2. NEVER write URLs anywhere. The server constructs all links from your structured citations. Cite precisely instead.
3. Every authority you rely on MUST appear in the "citations" array with an exact type and ref.
4. If authority is unsettled or you are uncertain, say so in confidence.rationale and caveats — do not invent rulings or cases.

JSON structure:
{
  "issue": "Clear restatement of the question",
  "executive_summary": "2-4 sentence plain-English answer, noting OBBBA impact and which tax year(s) it addresses",
  "citations": [
    { "type": "irc", "ref": "754", "note": "why it matters here" },
    { "type": "reg", "ref": "1.743-1(b)", "note": "..." },
    { "type": "revrul", "ref": "99-6", "note": "..." },
    { "type": "revproc", "ref": "2025-32", "note": "..." },
    { "type": "case", "ref": "Commissioner v. Culbertson (U.S. 1949)", "note": "..." },
    { "type": "form", "ref": "7203", "note": "..." },
    { "type": "pub", "ref": "541", "note": "..." }
  ],
  "authority_hierarchy": [
    { "level": "Statutory", "sources": ["IRC §XXX — one-line description"], "weight": "Highest" },
    { "level": "Regulatory", "sources": ["Treas. Reg. §X.XXX-X — description"], "weight": "High" },
    { "level": "Administrative", "sources": ["Rev. Rul. XXXX-XX — holding"], "weight": "Moderate" },
    { "level": "Judicial", "sources": ["Case v. Commissioner, court year — holding"], "weight": "Persuasive" }
  ],
  "analysis": {
    "federal": "Detailed federal analysis with section-level citations inline (write §754, Reg. §1.743-1 in text — the server links them)",
    "salt": {
      "conformity_overview": "How states generally treat this issue",
      "state_variations": [ { "category": "Full conformity", "states": ["..."], "notes": "..." } ],
      "high_risk_states": ["State — reason"]
    }
  },
  "confidence": { "score": 85, "label": "Well-Settled | Substantial Authority | Reasonable Basis | Uncertain", "rationale": "..." },
  "follow_up_issues": [ { "issue": "...", "priority": "High", "why": "..." } ],
  "planning_opportunities": ["..."],
  "caveats": ["..."]
}`;

app.post("/api/research", agentLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "AI research not configured. Add ANTHROPIC_API_KEY to environment variables." });
  const question = String((req.body && req.body.question) || "").trim();
  if (question.length < 5) return res.status(400).json({ error: "A valid research question is required." });
  if (question.length > 2000) return res.status(400).json({ error: "Question too long (max 2000 characters)." });
  const useWebSearch = process.env.ENABLE_WEB_SEARCH === "true";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const body = {
      model: process.env.AGENT_MODEL || "claude-sonnet-4-6",
      max_tokens: 6000,
      system: AGENT_SYSTEM + (useWebSearch ? "\n\nYou may use web search to verify current guidance. If you rely on a searched source, add it to citations with type \"web\" and put the exact URL in ref (web citations are the only place URLs are allowed)." : ""),
      messages: [{ role: "user", content: `Tax research question (OBBBA era; specify 2025 vs 2026 treatment where figures differ). Reply with JSON only, starting with {:\n\n${question}` }],
    };
    if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      let errMsg = `Anthropic API error ${anthropicRes.status}`;
      try { errMsg = JSON.parse(errText).error.message || errMsg; } catch {}
      return res.status(502).json({ error: errMsg });
    }

    const data = await anthropicRes.json();
    const content = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (DEBUG) console.log("RAW AI CONTENT >>>", content.slice(0, 500));

    let parsed;
    try {
      const clean = content.trim().replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
      const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
      parsed = JSON.parse(a !== -1 && b > a ? clean.slice(a, b + 1) : clean);
    } catch {
      return res.status(502).json({ error: "Could not parse AI response. Please try again." });
    }
    if (!parsed.issue) return res.status(502).json({ error: "Incomplete AI response. Please try again." });

    if (Array.isArray(parsed.citations)) {
      parsed.citations = parsed.citations.map((c) =>
        String(c.type).toLowerCase() === "web" && /^https?:\/\//.test(String(c.ref || ""))
          ? { ...c, display: c.note ? String(c.note).slice(0, 80) : c.ref, url: c.ref, exact: true, type: "web" }
          : linkifyCitation(c)
      );
    }
    linkifyDeep(parsed);
    res.json({ success: true, result: parsed });
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ error: "Research timed out after 90 seconds. Try a narrower question." });
    console.error("[AGENT ERROR]", err.message);
    res.status(500).json({ error: "Research request failed. Please try again." });
  } finally {
    clearTimeout(timeout);
  }
});

// ── 404 handling ──────────────────────────────────────────────────
app.use("/api", (req, res) => res.status(404).json({ error: "Unknown API endpoint" }));
app.get("*", (req, res) => {
  const notFound = path.join(__dirname, "public", "404.html");
  res.status(404).sendFile(fs.existsSync(notFound) ? notFound : path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ TaxClarity v3.0 "Statute" on http://localhost:${PORT}`);
  console.log(`   TY2025 + TY2026 · ${SEARCH_INDEX.length} searchable entries · AI: ${!!process.env.ANTHROPIC_API_KEY} · Email: ${!!transporter}`);
});

module.exports = app;
