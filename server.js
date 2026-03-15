/**
 * TaxClarity v2.0 — Express Backend
 * All tax data loaded from /data/tax-2025.json (single source of truth)
 * Tax Year 2025 | Filed April 15, 2026
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Load tax data from JSON ──────────────────────────────────────
const TAX_DATA_PATH = path.join(__dirname, "data", "tax-2025.json");
let TAX_DATA;
try {
  TAX_DATA = JSON.parse(fs.readFileSync(TAX_DATA_PATH, "utf8"));
  console.log(`✅ Tax data loaded: TY${TAX_DATA.meta.taxYear} (v${TAX_DATA.meta.version})`);
} catch (err) {
  console.error("❌ Failed to load tax data:", err.message);
  process.exit(1);
}

// ── Security Middleware ──────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api/", apiLimiter);

// ── TAX CALCULATOR ENGINE ────────────────────────────────────────
function calculateTax(income, filingStatus, itemizedDeductions = null, options = {}) {
  const brackets = TAX_DATA.brackets[filingStatus];
  if (!brackets) return { error: "Invalid filing status" };

  const stdDed = TAX_DATA.standardDeductions[filingStatus] || TAX_DATA.standardDeductions.single;
  const deductionUsed = itemizedDeductions && itemizedDeductions > stdDed ? itemizedDeductions : stdDed;
  const deductionType = itemizedDeductions && itemizedDeductions > stdDed ? "itemized" : "standard";
  const taxableIncome = Math.max(0, income - deductionUsed);

  let totalTax = 0;
  let bracketBreakdown = [];

  for (const bracket of brackets) {
    const max = bracket.max === null ? Infinity : bracket.max;
    if (taxableIncome <= bracket.min) break;
    const taxable = Math.min(taxableIncome, max) - bracket.min;
    const tax = taxable * bracket.rate;
    totalTax += tax;
    bracketBreakdown.push({
      rate: bracket.rate,
      min: bracket.min,
      max: bracket.max,
      taxableAmount: Math.round(taxable),
      tax: Math.round(tax),
    });
  }

  // Apply credits
  const credits = options.credits || 0;
  const netTax = Math.max(0, totalTax - credits);

  // Self-employment tax
  let seTax = 0;
  if (options.selfEmployed && options.selfEmploymentIncome > 0) {
    const seIncome = options.selfEmploymentIncome * 0.9235;
    const ssWageBase = TAX_DATA.selfEmployment.socialSecurityWageBase;
    const ssTax = Math.min(seIncome, ssWageBase) * TAX_DATA.selfEmployment.socialSecurityRate;
    const mediTax = seIncome * TAX_DATA.selfEmployment.medicareRate;
    let addlMedi = 0;
    const mediThreshold = filingStatus === "marriedFilingJointly"
      ? TAX_DATA.selfEmployment.additionalMedicareThresholdMFJ
      : TAX_DATA.selfEmployment.additionalMedicareThresholdSingle;
    if (seIncome > mediThreshold) {
      addlMedi = (seIncome - mediThreshold) * TAX_DATA.selfEmployment.additionalMedicareRate;
    }
    seTax = ssTax + mediTax + addlMedi;
  }

  // Capital gains
  let capGainsTax = 0;
  if (options.longTermCapGains > 0) {
    const ltcg = options.longTermCapGains;
    const cgBrackets = TAX_DATA.capitalGains.longTerm;
    const rate0Max = cgBrackets.rate0[filingStatus] || cgBrackets.rate0.single;
    const rate15Max = cgBrackets.rate15[filingStatus] || cgBrackets.rate15.single;
    if (taxableIncome + ltcg <= rate0Max) {
      capGainsTax = 0;
    } else if (taxableIncome + ltcg <= rate15Max) {
      const taxableAt15 = Math.max(0, taxableIncome + ltcg - rate0Max);
      capGainsTax = taxableAt15 * 0.15;
    } else {
      const at15 = Math.max(0, rate15Max - Math.max(taxableIncome, rate0Max));
      const at20 = ltcg - at15;
      capGainsTax = at15 * 0.15 + Math.max(0, at20) * 0.20;
    }
    // NIIT
    const niitThreshold = filingStatus === "marriedFilingJointly"
      ? TAX_DATA.capitalGains.niit.thresholdMFJ
      : TAX_DATA.capitalGains.niit.thresholdSingle;
    if (income + ltcg > niitThreshold) {
      const niitIncome = Math.min(ltcg, income + ltcg - niitThreshold);
      capGainsTax += niitIncome * TAX_DATA.capitalGains.niit.rate;
    }
  }

  const effectiveRate = income > 0 ? (netTax + seTax + capGainsTax) / income : 0;
  const lastBracket = bracketBreakdown[bracketBreakdown.length - 1];

  return {
    taxYear: TAX_DATA.meta.taxYear,
    grossIncome: income,
    filingStatus,
    deductionType,
    deductionAmount: deductionUsed,
    taxableIncome: Math.round(taxableIncome),
    federalTax: Math.round(totalTax),
    credits: Math.round(credits),
    netFederalTax: Math.round(netTax),
    selfEmploymentTax: Math.round(seTax),
    capitalGainsTax: Math.round(capGainsTax),
    totalTaxLiability: Math.round(netTax + seTax + capGainsTax),
    effectiveRate: Math.round(effectiveRate * 10000) / 100,
    marginalRate: lastBracket ? lastBracket.rate * 100 : 10,
    bracketBreakdown,
  };
}

// ── API ROUTES ───────────────────────────────────────────────────

// Full tax data (for frontend hydration)
app.get("/api/tax-data", (req, res) => {
  res.json({ success: true, data: TAX_DATA });
});

// Tax calculator
app.post("/api/calculate-tax", (req, res) => {
  const { income, filingStatus, itemizedDeductions, credits, selfEmployed, selfEmploymentIncome, longTermCapGains } = req.body;
  if (!income || typeof income !== "number" || income < 0) {
    return res.status(400).json({ error: "Valid income amount required" });
  }
  if (!filingStatus) {
    return res.status(400).json({ error: "Filing status required" });
  }
  const result = calculateTax(income, filingStatus, itemizedDeductions, {
    credits, selfEmployed, selfEmploymentIncome, longTermCapGains
  });
  res.json({ success: true, result });
});

// Deadlines
app.get("/api/deadlines", (req, res) => {
  res.json({ success: true, taxYear: TAX_DATA.meta.taxYear, deadlines: TAX_DATA.deadlines });
});

// Brackets
app.get("/api/brackets/:status", (req, res) => {
  const brackets = TAX_DATA.brackets[req.params.status];
  if (!brackets) return res.status(404).json({ error: "Filing status not found" });
  res.json({ success: true, filingStatus: req.params.status, taxYear: TAX_DATA.meta.taxYear, brackets });
});

// OBBB changes
app.get("/api/new-laws", (req, res) => {
  res.json({
    success: true,
    title: "One Big Beautiful Bill — 2025 Tax Changes",
    effectiveDate: TAX_DATA.meta.legislationDate,
    changes: TAX_DATA.obbbChanges,
  });
});

// Downloads manifest
app.get("/api/downloads", (req, res) => {
  res.json({ success: true, downloads: TAX_DATA.downloads });
});

// Retirement limits
app.get("/api/retirement", (req, res) => {
  res.json({ success: true, taxYear: TAX_DATA.meta.taxYear, limits: TAX_DATA.retirement });
});

// Credits
app.get("/api/credits", (req, res) => {
  res.json({ success: true, taxYear: TAX_DATA.meta.taxYear, credits: TAX_DATA.credits });
});

// Self-employment data
app.get("/api/self-employment", (req, res) => {
  res.json({ success: true, taxYear: TAX_DATA.meta.taxYear, data: TAX_DATA.selfEmployment });
});

// State info
app.get("/api/states", (req, res) => {
  res.json({ success: true, data: TAX_DATA.stateInfo });
});

// Newsletter signup
const subscribers = new Set();
app.post("/api/newsletter", (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
  subscribers.add(email.toLowerCase());
  res.json({ success: true, message: "Subscribed! We'll send tax tips and deadline reminders." });
});

// Contact form
app.post("/api/contact", (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: "Name, email, and message required" });
  console.log(`[CONTACT] ${name} <${email}> | ${subject} | ${message.slice(0, 100)}`);
  res.json({ success: true, message: "Message received! We'll respond within 1-2 business days." });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "TaxClarity API",
    version: TAX_DATA.meta.version,
    taxYear: TAX_DATA.meta.taxYear,
    dataUpdated: TAX_DATA.meta.lastUpdated,
    timestamp: new Date().toISOString(),
  });
});

// ── AI TAX RESEARCH AGENT (Anthropic Proxy) ──────────────────────
const agentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Research limit reached. Please wait before trying again." },
});

const AGENT_SYSTEM = `You are an elite tax research agent specializing in pass-through entities (S-Corps and partnerships), with deep expertise in federal and all 50 state tax laws, SALT regulations, and multi-state apportionment. You are fully up to date on the One Big Beautiful Bill (OBBB) signed July 4, 2025, which applies to Tax Year 2025 returns filed April 15, 2026.

CRITICAL: Respond ONLY with a single valid JSON object. Begin with { and end with }. No markdown, no backticks, no text outside the JSON.

Use this exact structure:
{
  "issue": "Clear restatement of the legal question",
  "executive_summary": "2-3 sentence plain-English answer including any 2025 OBBB impact",
  "authority_hierarchy": [
    { "level": "Statutory", "sources": ["IRC §XXX - description"], "weight": "Highest" },
    { "level": "Regulatory", "sources": ["Treas. Reg. §X.XXXX - description"], "weight": "High" },
    { "level": "Administrative", "sources": ["Rev. Rul. XXXX-XX - description"], "weight": "Moderate" },
    { "level": "Judicial", "sources": ["Case name, court, year - holding"], "weight": "Lower" }
  ],
  "analysis": {
    "federal": "Detailed federal analysis for S-Corp/partnership context with 2025 updates",
    "salt": {
      "conformity_overview": "How states generally treat this issue",
      "state_variations": [
        { "category": "Full Conformity States", "states": ["NY","CA","TX"], "notes": "treatment" },
        { "category": "Partial Conformity", "states": ["IL","OH"], "notes": "modifications" },
        { "category": "Non-Conformity / Special Rules", "states": ["PA","NJ"], "notes": "differences" }
      ],
      "high_risk_states": ["State A - reason", "State B - reason"]
    }
  },
  "confidence": { "score": 85, "label": "Well-Settled", "rationale": "Why this confidence level" },
  "follow_up_issues": [
    { "issue": "Related issue title", "priority": "High", "why": "Why this matters in 2025" }
  ],
  "planning_opportunities": ["Specific planning idea relevant to pass-throughs and 2025 law"],
  "caveats": ["Important limitation or warning, especially any OBBB uncertainty"]
}`;

app.post("/api/research", agentLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "AI research not configured. Add ANTHROPIC_API_KEY to environment variables." });
  }
  const { question } = req.body;
  if (!question || typeof question !== "string" || question.trim().length < 5) {
    return res.status(400).json({ error: "A valid research question is required." });
  }
  if (question.length > 2000) {
    return res.status(400).json({ error: "Question too long (max 2000 characters)." });
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: AGENT_SYSTEM,
        messages: [{ role: "user", content: `Tax research question for Tax Year 2025 (OBBB applies). Reply with JSON only, starting with {:\n\n${question.trim()}` }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      let errMsg = `Anthropic API error ${anthropicRes.status}`;
      try { errMsg = JSON.parse(errText)?.error?.message || errMsg; } catch {}
      return res.status(502).json({ error: errMsg });
    }

    const data = await anthropicRes.json();
    const content = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");

    let parsed;
    try {
      const clean = content.trim().replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
      const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
      parsed = JSON.parse(a !== -1 && b > a ? clean.slice(a, b + 1) : clean);
    } catch {
      return res.status(502).json({ error: "Could not parse AI response. Please try again." });
    }

    if (!parsed.issue) return res.status(502).json({ error: "Incomplete AI response. Please try again." });
    res.json({ success: true, taxYear: TAX_DATA.meta.taxYear, result: parsed });
  } catch (err) {
    console.error("[AGENT ERROR]", err.message);
    res.status(500).json({ error: "Research request failed. Please try again." });
  }
});

// ── SPA Fallback ─────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── START ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ TaxClarity v${TAX_DATA.meta.version} running on http://localhost:${PORT}`);
  console.log(`📊 Tax Year: ${TAX_DATA.meta.taxYear} | Filing: ${TAX_DATA.meta.filingDeadline}`);
  console.log(`📁 Downloads: ${TAX_DATA.downloads.length} templates available`);
});

module.exports = app;
