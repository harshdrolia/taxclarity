/**
 * TaxClarity Draft Return Engine v3
 * Computes an educational draft Form 1040 for TY2025 / TY2026.
 * Pure functions; tax data injected at init. NOT filing software —
 * every result carries diagnostics and simplification notes.
 */

"use strict";

let DATA = {}; // { 2025: {...}, 2026: {...} }

function init(dataByYear) { DATA = dataByYear; }

const r0 = (n) => Math.round(n || 0);
const pos = (n) => Math.max(0, n || 0);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

// ── Ordinary brackets ────────────────────────────────────────────
function ordinaryTax(taxable, brackets) {
  let tax = 0;
  const breakdown = [];
  for (const b of brackets) {
    const max = b.max === null ? Infinity : b.max;
    if (taxable <= b.min) break;
    const slice = Math.min(taxable, max) - b.min;
    tax += slice * b.rate;
    breakdown.push({ rate: b.rate, from: b.min, to: b.max, amount: r0(slice), tax: r0(slice * b.rate) });
  }
  return { tax, breakdown };
}

function marginalRate(taxable, brackets) {
  let rate = brackets[0].rate;
  for (const b of brackets) {
    const max = b.max === null ? Infinity : b.max;
    if (taxable > b.min) rate = b.rate;
    if (taxable <= max) break;
  }
  return rate;
}

// ── Preferential rate stacking (LTCG + qualified dividends) ─────
function capGainsTax(ordinaryTI, prefIncome, fs, D) {
  if (prefIncome <= 0) return { tax: 0, tiers: [] };
  const b0 = D.capitalGains.longTerm.rate0[fs] ?? D.capitalGains.longTerm.rate0.single;
  const b15 = D.capitalGains.longTerm.rate15[fs] ?? D.capitalGains.longTerm.rate15.single;
  const tiers = [];
  let remaining = prefIncome;
  const at0 = Math.min(remaining, pos(b0 - ordinaryTI));
  if (at0 > 0) tiers.push({ rate: 0, amount: r0(at0) });
  remaining -= at0;
  const at15 = Math.min(remaining, pos(b15 - Math.max(ordinaryTI, b0)));
  if (at15 > 0) tiers.push({ rate: 0.15, amount: r0(at15) });
  remaining -= at15;
  if (remaining > 0) tiers.push({ rate: 0.20, amount: r0(remaining) });
  const tax = tiers.reduce((s, t) => s + t.amount * t.rate, 0);
  return { tax, tiers };
}

// ── Self-employment tax with W-2 coordination ────────────────────
function seTax(schCNet, w2SSWages, fs, D) {
  const SE = D.selfEmployment;
  const net = schCNet * (SE.netEarningsFactor || 0.9235);
  if (net < 400) return { tax: 0, half: 0, netSE: r0(net), ss: 0, medicare: 0, note: net > 0 ? "Under $400 — no SE tax" : null };
  const ssRoom = pos(SE.socialSecurityWageBase - pos(w2SSWages));
  const ss = Math.min(net, ssRoom) * SE.socialSecurityRate;
  const medicare = net * SE.medicareRate;
  const tax = ss + medicare;
  return { tax, half: tax / 2, netSE: r0(net), ss: r0(ss), medicare: r0(medicare), note: null };
}

// ── Additional Medicare Tax (§3101(b)(2)/§1401(b)(2)) ────────────
function additionalMedicare(wages, netSE, fs, D) {
  const SE = D.selfEmployment;
  const thr = fs === "marriedFilingJointly" ? SE.additionalMedicareThresholdMFJ
    : fs === "marriedFilingSeparately" ? (SE.additionalMedicareThresholdMFS || 125000)
    : SE.additionalMedicareThresholdSingle;
  const wageExcess = pos(wages - thr);
  const seThreshold = pos(thr - wages);
  const seExcess = pos(netSE - seThreshold);
  return r0((wageExcess + seExcess) * (SE.additionalMedicareRate || 0.009));
}

// ── Taxable Social Security (simplified official worksheet) ─────
function taxableSocialSecurity(ssBenefits, otherIncome, taxExemptInterest, fs) {
  if (ssBenefits <= 0) return 0;
  const base1 = fs === "marriedFilingJointly" ? 32000 : fs === "marriedFilingSeparately" ? 0 : 25000;
  const base2 = fs === "marriedFilingJointly" ? 44000 : fs === "marriedFilingSeparately" ? 0 : 34000;
  const provisional = otherIncome + taxExemptInterest + ssBenefits * 0.5;
  if (provisional <= base1) return 0;
  const t1 = Math.min((provisional - base1) * 0.5, ssBenefits * 0.5);
  if (provisional <= base2) return r0(t1);
  const t2 = (provisional - base2) * 0.85 + Math.min(t1, (base2 - base1) * 0.5);
  return r0(Math.min(t2, ssBenefits * 0.85));
}

// ── SALT cap with OBBBA phasedown ─────────────────────────────────
function saltAllowed(saltPaid, magi, fs, D) {
  const cap = D.saltCap;
  let limit = fs === "marriedFilingSeparately" ? cap.amount / 2 : cap.amount;
  const thr = fs === "marriedFilingSeparately" ? (cap.phaseoutMAGI || 500000) / 2 : (cap.phaseoutMAGI || 500000);
  if (magi > thr) limit = Math.max(cap.floor || 10000, limit - (magi - thr) * (cap.phaseoutRate || 0.30));
  return Math.min(pos(saltPaid), r0(limit));
}

// ── QBI (§199A) simplified with honest limits ────────────────────
function qbiDeduction(qbiIncome, tiBeforeQBI, netCapGain, fs, sstb, w2WagesPaid, D) {
  const Q = D.qbi || { deductionRate: 0.20, thresholdSingle: 197300, thresholdMFJ: 394600, phaseInRangeSingle: 75000, phaseInRangeMFJ: 150000 };
  if (qbiIncome <= 0) return { amount: 0, notes: [] };
  const notes = [];
  const thr = fs === "marriedFilingJointly" ? Q.thresholdMFJ : Q.thresholdSingle;
  const range = fs === "marriedFilingJointly" ? Q.phaseInRangeMFJ : Q.phaseInRangeSingle;
  const tentative = Q.deductionRate * qbiIncome;
  const overallCap = Q.deductionRate * pos(tiBeforeQBI - netCapGain);
  let allowed = tentative;
  if (tiBeforeQBI > thr) {
    const excessPct = Math.min(1, (tiBeforeQBI - thr) / range);
    if (sstb) {
      allowed = tentative * (1 - excessPct);
      notes.push(excessPct >= 1
        ? "SSTB above the §199A threshold — QBI deduction fully phased out."
        : `SSTB inside the phase-in range — deduction reduced ${r0(excessPct * 100)}%.`);
    } else {
      const wageLimit = 0.50 * pos(w2WagesPaid);
      const excessReduction = pos(tentative - wageLimit) * excessPct; // §199A(b)(3)(B) phase-in
      allowed = pos(tentative - excessReduction);
      if (!w2WagesPaid) notes.push("Above the §199A threshold with no W-2 wages entered — the wage limit phases the deduction " + (excessPct >= 1 ? "out entirely" : "down") + ". Enter W-2 wages paid by the business (25%+2.5% UBIA alternative not modeled).");
      else notes.push("Above the §199A threshold — 50%-of-W-2-wages limit phased in (simplified; UBIA alternative and aggregation not modeled).");
    }
  }
  return { amount: r0(Math.min(pos(allowed), overallCap)), notes };
}

// ── Child Tax Credit / ACTC ──────────────────────────────────────
function childTaxCredit(kidsU17, otherDeps, magi, taxBeforeCredits, earnedIncome, fs, D) {
  const C = D.credits.childTaxCredit;
  const gross = kidsU17 * C.amount + otherDeps * (C.otherDependentCredit || 500);
  const thr = fs === "marriedFilingJointly" ? C.phaseoutMFJ : C.phaseoutSingle;
  const reduction = magi > thr ? Math.ceil((magi - thr) / 1000) * (C.phaseoutRatePer1000 || 50) : 0;
  const afterPhaseout = pos(gross - reduction);
  const nonrefundable = Math.min(afterPhaseout, pos(taxBeforeCredits));
  const actcCap = kidsU17 * (C.refundable || 1700);
  const earnedFormula = pos(earnedIncome - 2500) * 0.15;
  const refundable = Math.min(pos(afterPhaseout - nonrefundable), actcCap, earnedFormula);
  return { gross: r0(gross), afterPhaseout: r0(afterPhaseout), nonrefundable: r0(nonrefundable), refundable: r0(refundable) };
}

// ── Education credits (simplified) ───────────────────────────────
function educationCredits(aotcExpenses, llcExpenses, magi, fs, D) {
  const E = D.credits.education || {};
  const out = { aotcNonref: 0, aotcRefundable: 0, llc: 0, notes: [] };
  const phase = (lo, hi) => magi <= lo ? 1 : magi >= hi ? 0 : (hi - magi) / (hi - lo);
  if (aotcExpenses > 0 && E.aotc) {
    const [lo, hi] = fs === "marriedFilingJointly" ? E.aotc.phaseoutMFJ : E.aotc.phaseoutSingle;
    const base = Math.min(aotcExpenses, 2000) + 0.25 * pos(Math.min(aotcExpenses, 4000) - 2000);
    const allowed = base * phase(lo, hi);
    out.aotcRefundable = r0(allowed * 0.40);
    out.aotcNonref = r0(allowed - out.aotcRefundable);
    if (phase(lo, hi) === 0) out.notes.push("AOTC fully phased out at this MAGI.");
  }
  if (llcExpenses > 0 && E.llc) {
    const [lo, hi] = fs === "marriedFilingJointly" ? E.llc.phaseoutMFJ : E.llc.phaseoutSingle;
    out.llc = r0(Math.min(llcExpenses, 10000) * 0.20 * phase(lo, hi));
  }
  return out;
}

// ── NIIT (§1411) ─────────────────────────────────────────────────
function niit(nii, magi, fs, D) {
  const N = D.capitalGains.niit || { rate: 0.038, thresholdSingle: 200000, thresholdMFJ: 250000, thresholdMFS: 125000 };
  const thr = fs === "marriedFilingJointly" ? N.thresholdMFJ : fs === "marriedFilingSeparately" ? (N.thresholdMFS || 125000) : N.thresholdSingle;
  return r0(N.rate * Math.min(pos(nii), pos(magi - thr)));
}

// ── AMT screen (simplified) ──────────────────────────────────────
function amtScreen(taxableIncome, saltDeducted, prefIncome, regularTax, fs, D) {
  const A = D.amt;
  if (!A) return { applies: false, amount: 0 };
  const amti = taxableIncome + saltDeducted; // primary common preference for W-2/SALT taxpayers
  let exemption = fs === "marriedFilingJointly" ? A.exemptionMFJ : fs === "marriedFilingSeparately" ? (A.exemptionMFS || A.exemptionSingle / 1.25) : A.exemptionSingle;
  const phaseStart = fs === "marriedFilingJointly" ? A.phaseoutMFJ : fs === "marriedFilingSeparately" ? (A.phaseoutMFJ / 2) : A.phaseoutSingle;
  const phaseRate = A.phaseoutRate || 0.25;
  if (amti > phaseStart) exemption = pos(exemption - (amti - phaseStart) * phaseRate);
  const base = pos(amti - exemption);
  const ordBase = pos(base - prefIncome);
  const thr28 = A.rate28PctThreshold || A.rate26Pct || 239100;
  const tmtOrd = ordBase <= thr28 ? ordBase * 0.26 : thr28 * 0.26 + (ordBase - thr28) * 0.28;
  // preferential income keeps cap-gains rates under AMT; approximate at 15% blended for the screen
  const tmt = tmtOrd + prefIncome * 0.15;
  const excess = pos(tmt - regularTax);
  return { applies: excess > 0, amount: r0(excess), note: "Screening estimate only — assumes SALT is the sole preference; ISOs, depreciation and other adjustments not modeled." };
}

// ── Student loan interest phase-out ──────────────────────────────
function studentLoanDeduction(paid, magi, fs, year) {
  const cap = Math.min(pos(paid), 2500);
  if (fs === "marriedFilingSeparately") return { amount: 0, note: "Student loan interest deduction not allowed for MFS." };
  const [lo, hi] = fs === "marriedFilingJointly"
    ? (year >= 2026 ? [175000, 205000] : [170000, 200000])
    : (year >= 2026 ? [85000, 100000] : [85000, 100000]);
  if (magi <= lo) return { amount: cap };
  if (magi >= hi) return { amount: 0, note: "Student loan interest deduction fully phased out at this MAGI." };
  return { amount: r0(cap * (hi - magi) / (hi - lo)), note: "Student loan interest deduction partially phased out." };
}

// ═════════════════════════════════════════════════════════════════
// MAIN: draft return builder
// ═════════════════════════════════════════════════════════════════
function draftReturn(input) {
  const year = input.year === 2026 ? 2026 : 2025;
  const D = DATA[year];
  if (!D) throw new Error(`No tax data loaded for ${year}`);
  const fs = D.brackets[input.filingStatus] ? input.filingStatus : "single";
  const brackets = D.brackets[fs];
  const diag = [];
  const I = input.income || {}, A = input.adjustments || {}, DED = input.deductions || {}, CR = input.credits || {}, P = input.payments || {}, H = input.household || {}, OB = input.obbba || {};

  // — Income pieces —
  const wages = num(I.wages);
  const interest = num(I.interest);
  const taxExemptInterest = num(I.taxExemptInterest);
  const ordDiv = num(I.ordinaryDividends);
  const qualDiv = Math.min(num(I.qualifiedDividends), ordDiv);
  const iraDist = num(I.iraDistributions);
  const pensions = num(I.pensions);
  const ssBenefits = num(I.socialSecurity);
  const stcg = num(I.shortTermGain);
  const ltcgRaw = num(I.longTermGain);
  const schCNet = num(I.scheduleCGross) - num(I.scheduleCExpenses);
  const rental = num(I.rentalNet);
  const k1Passive = num(I.k1Passive);
  const k1Nonpassive = num(I.k1Nonpassive);
  const unemployment = num(I.unemployment);
  const otherIncome = num(I.otherIncome);

  if (schCNet < 0) diag.push("Schedule C loss entered — hobby-loss (§183), at-risk (§465) and excess-business-loss (§461(l)) limits are not modeled; loss allowed in full here.");
  if (rental < 0 || k1Passive < 0) diag.push("Passive losses entered — §469 passive activity limits are not modeled; consult before relying on these losses.");

  // — Capital gain netting (§1211/1212 simplified) —
  const netCapital = stcg + ltcgRaw;
  let capGainLine7, ltcgForRates = 0, lossCarryover = 0;
  if (netCapital >= 0) {
    capGainLine7 = netCapital;
    ltcgForRates = pos(Math.min(ltcgRaw, netCapital)); // ST losses absorb LT first when ST negative
    if (stcg < 0) ltcgForRates = pos(ltcgRaw + stcg);
  } else {
    capGainLine7 = Math.max(netCapital, -3000 / (fs === "marriedFilingSeparately" ? 2 : 1));
    lossCarryover = r0(Math.abs(netCapital) - Math.abs(capGainLine7));
    if (lossCarryover > 0) diag.push(`Capital loss limited to ${fs === "marriedFilingSeparately" ? "$1,500" : "$3,000"} — $${lossCarryover.toLocaleString()} carries forward.`);
  }

  // — SE tax (needs to precede AGI) —
  const se = seTax(pos(schCNet) + pos(k1Nonpassive && I.k1SubjectToSE ? k1Nonpassive : 0), wages, fs, D);
  if (se.note) diag.push(se.note);

  // — Social Security taxability —
  const incomeExSS = wages + interest + ordDiv + iraDist + pensions + capGainLine7 + schCNet + rental + k1Passive + k1Nonpassive + unemployment + otherIncome - se.half;
  const taxableSS = taxableSocialSecurity(ssBenefits, incomeExSS, taxExemptInterest, fs);
  if (ssBenefits > 0) diag.push(`$${taxableSS.toLocaleString()} of $${r0(ssBenefits).toLocaleString()} Social Security is taxable at this income.`);

  const totalIncome = wages + interest + ordDiv + iraDist + pensions + taxableSS + capGainLine7 + schCNet + rental + k1Passive + k1Nonpassive + unemployment + otherIncome;

  // — Adjustments (Schedule 1, Part II) —
  const hsaLimit = ((H.hsaFamily ? D.retirement.hsaFamily : D.retirement.hsaSelfOnly) || 0) + (H.age55Plus ? (D.retirement.hsaCatchUp55Plus || 0) : 0);
  const hsa = Math.min(num(A.hsa), hsaLimit);
  if (num(A.hsa) > hsaLimit) diag.push(`HSA contribution capped at the $${hsaLimit.toLocaleString()} ${year} limit.`);
  const iraLimit = (D.retirement.iraLimit || 0) + (H.age50Plus ? (D.retirement.iraCatchUp50Plus || 0) : 0);
  const ira = Math.min(num(A.iraDeduction), iraLimit);
  if (num(A.iraDeduction) > iraLimit) diag.push(`IRA deduction capped at the $${iraLimit.toLocaleString()} limit. Active-participant phase-outs not modeled — verify deductibility if covered by a workplace plan.`);
  else if (ira > 0) diag.push("IRA deduction assumes you are not covered by a workplace plan (phase-outs not modeled).");
  const magiApprox = totalIncome - se.half - hsa; // pre-SLI MAGI approximation
  const sli = studentLoanDeduction(num(A.studentLoanInterest), magiApprox, fs, year);
  if (sli.note) diag.push(sli.note);
  const seHealth = Math.min(num(A.seHealthInsurance), pos(schCNet - se.half));
  const educator = Math.min(num(A.educatorExpenses), 300 * (fs === "marriedFilingJointly" ? 2 : 1));
  const adjustments = se.half + hsa + ira + sli.amount + seHealth + educator;
  const agi = totalIncome - adjustments;

  // — Standard vs itemized —
  const SD = D.standardDeductions;
  let std = SD[fs] ?? SD.single;
  const isMarried = fs === "marriedFilingJointly" || fs === "marriedFilingSeparately";
  const perBonus = isMarried ? (SD.over65BonusMarriedPerSpouse || SD.over65Bonus) : SD.over65Bonus;
  const bonusCount = (H.taxpayer65 ? 1 : 0) + (H.taxpayerBlind ? 1 : 0) + (fs === "marriedFilingJointly" ? ((H.spouse65 ? 1 : 0) + (H.spouseBlind ? 1 : 0)) : 0);
  std += bonusCount * perBonus;

  const saltDeductible = saltAllowed(num(DED.saltPaid), agi, fs, D);
  if (num(DED.saltPaid) > saltDeductible) diag.push(`SALT limited to $${saltDeductible.toLocaleString()} (OBBBA cap${agi > (D.saltCap.phaseoutMAGI || 500000) ? " with high-income phasedown" : ""}).`);
  const medical = pos(num(DED.medicalExpenses) - 0.075 * agi);
  let charitable = pos(num(DED.charitable));
  const charitableCap = 0.60 * agi;
  if (charitable > charitableCap) { charitable = charitableCap; diag.push("Charitable deduction limited to 60% of AGI (cash limit; carryforward available)."); }
  if (year >= 2026 && charitable > 0) {
    const floor = 0.005 * agi;
    charitable = pos(charitable - floor);
    diag.push(`OBBBA 0.5%-of-AGI floor applied to itemized charitable ($${r0(floor).toLocaleString()} disallowed).`);
  }
  const mortgage = pos(num(DED.mortgageInterest));
  if (mortgage > 0) diag.push("Mortgage interest taken as entered — $750K acquisition-debt limit not tested.");
  const itemizedTotal = r0(saltDeductible + medical + charitable + mortgage);

  let useItemized = DED.forceItemize === true || (DED.forceItemize !== false && itemizedTotal > std);
  let deduction = useItemized ? itemizedTotal : std;
  if (!useItemized && itemizedTotal > 0 && itemizedTotal <= std) diag.push(`Standard deduction ($${std.toLocaleString()}) beats itemized ($${itemizedTotal.toLocaleString()}).`);

  // Non-itemizer charitable (OBBBA, 2026+)
  let nonItemizerCharity = 0;
  if (!useItemized && year >= 2026 && num(DED.charitable) > 0) {
    nonItemizerCharity = Math.min(num(DED.charitable), fs === "marriedFilingJointly" ? 2000 : 1000);
    diag.push(`$${nonItemizerCharity.toLocaleString()} above-the-line charitable deduction applied (OBBBA non-itemizer rule).`);
  }

  // OBBBA below-the-line deductions (2025–2028)
  const obD = D.credits.obbbaDeductions || {};
  const phaseDown = (amt, magi, thr) => pos(amt - pos(magi - thr) * 0.10); // statutory $100 per $1,000 over
  let tipsDed = 0, otDed = 0, carDed = 0;
  if (num(OB.tips) > 0 && obD.tips) {
    tipsDed = phaseDown(Math.min(num(OB.tips), obD.tips.max), agi, fs === "marriedFilingJointly" ? obD.tips.phaseoutMFJ : obD.tips.phaseoutSingle);
    diag.push("Tips deduction: assumes qualified tips in a listed occupation, reported on W-2/1099.");
  }
  if (num(OB.overtimePremium) > 0 && obD.overtime) {
    otDed = phaseDown(Math.min(num(OB.overtimePremium), fs === "marriedFilingJointly" ? obD.overtime.maxMFJ : obD.overtime.maxSingle), agi, fs === "marriedFilingJointly" ? obD.overtime.phaseoutMFJ : obD.overtime.phaseoutSingle);
    diag.push("Overtime deduction applies to the premium (half-time) portion only.");
  }
  if (num(OB.carLoanInterest) > 0 && obD.carLoanInterest) {
    carDed = phaseDown(Math.min(num(OB.carLoanInterest), obD.carLoanInterest.max), agi, fs === "marriedFilingJointly" ? obD.carLoanInterest.phaseoutMFJ : obD.carLoanInterest.phaseoutSingle);
    diag.push("Car-loan interest deduction: new, U.S.-assembled, personal-use vehicles only.");
  }
  // Senior bonus deduction (2025–2028)
  let seniorDed = 0;
  if (SD.seniorBonus && (H.taxpayer65 || H.spouse65)) {
    const eligible = (H.taxpayer65 ? 1 : 0) + (fs === "marriedFilingJointly" && H.spouse65 ? 1 : 0);
    const thr = fs === "marriedFilingJointly" ? SD.seniorBonus.phaseoutMFJ : SD.seniorBonus.phaseoutSingle;
    seniorDed = pos(eligible * SD.seniorBonus.amount - pos(agi - thr) * (SD.seniorBonus.phaseoutRate || 0.06));
    if (seniorDed > 0) diag.push(`$${r0(seniorDed).toLocaleString()} OBBBA senior deduction applied.`);
  }
  const extraDeductions = r0(tipsDed + otDed + carDed + seniorDed + nonItemizerCharity);

  // — QBI —
  const tiBeforeQBI = pos(agi - deduction - extraDeductions);
  const prefIncome = pos(ltcgForRates) + qualDiv;
  const qbiBase = pos(schCNet - se.half - seHealth) + pos(k1Nonpassive) + pos(rental && I.rentalIsQBI ? rental : 0);
  const qbi = qbiDeduction(qbiBase, tiBeforeQBI, prefIncome, fs, !!I.sstb, num(I.w2WagesPaid), D);
  qbi.notes.forEach((n) => diag.push(n));

  const taxableIncome = pos(tiBeforeQBI - qbi.amount);

  // — Tax (ordinary + preferential stacking) —
  const prefInTI = Math.min(prefIncome, taxableIncome);
  const ordinaryTI = pos(taxableIncome - prefInTI);
  const ord = ordinaryTax(ordinaryTI, brackets);
  const cg = capGainsTax(ordinaryTI, prefInTI, fs, D);
  const taxBeforeCredits = r0(ord.tax + cg.tax);

  // — AMT screen —
  const amt = amtScreen(taxableIncome, useItemized ? saltDeductible : 0, prefInTI, taxBeforeCredits, fs, D);
  if (amt.applies) diag.push(`⚠ AMT screen suggests ~$${amt.amount.toLocaleString()} of tentative minimum tax over regular tax. ${amt.note}`);

  // — Credits —
  const earnedIncome = wages + pos(schCNet - se.half);
  const ctc = childTaxCredit(num(H.childrenUnder17), num(H.otherDependents), agi, taxBeforeCredits + (amt.applies ? amt.amount : 0), earnedIncome, fs, D);
  const edu = educationCredits(num(CR.aotcExpenses), num(CR.llcExpenses), agi, fs, D);
  edu.notes.forEach((n) => diag.push(n));
  let cdcc = 0;
  if (num(CR.childCareExpenses) > 0) {
    const kids = Math.max(1, num(H.childrenUnder17));
    const capped = Math.min(num(CR.childCareExpenses), kids >= 2 ? 6000 : 3000, earnedIncome);
    const rate = agi <= 15000 ? 0.35 : agi >= 43000 ? 0.20 : 0.35 - Math.ceil((agi - 15000) / 2000) * 0.01;
    cdcc = r0(capped * Math.max(0.20, rate));
  }
  const foreignTaxCredit = Math.min(num(CR.foreignTaxPaid), 600); // de minimis no-limitation zone approximation
  if (num(CR.foreignTaxPaid) > 600) diag.push("Foreign tax credit capped at $600 here — amounts above the election threshold require Form 1116 (§904 limitation not modeled).");

  const nonrefundableCredits = Math.min(taxBeforeCredits + (amt.applies ? amt.amount : 0), ctc.nonrefundable + edu.aotcNonref + edu.llc + cdcc + foreignTaxCredit + num(CR.otherNonrefundable));
  const taxAfterCredits = pos(taxBeforeCredits + (amt.applies ? amt.amount : 0) - nonrefundableCredits);

  // — Other taxes (Schedule 2) —
  const addlMedicare = additionalMedicare(wages, se.netSE, fs, D);
  const nii = pos(interest + ordDiv + capGainLine7 + pos(rental) + pos(k1Passive));
  const niitTax = niit(nii, agi, fs, D);
  if (niitTax > 0) diag.push(`Net investment income tax applies: $${niitTax.toLocaleString()} (3.8% NIIT).`);
  const otherTaxes = r0(se.tax) + addlMedicare + niitTax;

  const totalTax = r0(taxAfterCredits + otherTaxes);

  // — Payments & balance —
  const withholding = num(P.withholding);
  const estimates = num(P.estimatedPayments);
  const refundableCredits = ctc.refundable + edu.aotcRefundable;
  const totalPayments = r0(withholding + estimates + refundableCredits + num(P.extensionPayment));
  const balance = totalTax - totalPayments;

  // — Safe harbor —
  let safeHarbor = null;
  if (num(P.priorYearTax) > 0) {
    const pyPct = num(P.priorYearAGI) > 150000 ? 1.10 : 1.00;
    const required = Math.min(0.90 * totalTax, pyPct * num(P.priorYearTax));
    safeHarbor = {
      required: r0(required),
      paidTowardSafeHarbor: r0(withholding + estimates),
      met: withholding + estimates >= required - 1,
      basis: pyPct === 1.10 ? "110% of prior-year tax (AGI > $150K)" : "lesser of 90% current-year / 100% prior-year",
    };
    if (!safeHarbor.met) diag.push(`Estimated-tax safe harbor NOT met — pay at least $${r0(required - withholding - estimates).toLocaleString()} more via withholding/estimates to avoid §6654 penalty exposure.`);
  }

  const effectiveRate = totalIncome > 0 ? Math.round((totalTax / totalIncome) * 10000) / 100 : 0;

  // — Line-mapped draft 1040 —
  const lines = [
    { line: "1a", label: "Wages (W-2 box 1)", amount: r0(wages) },
    { line: "2a/2b", label: "Tax-exempt / taxable interest", amount: r0(interest), memo: taxExemptInterest ? `tax-exempt: $${r0(taxExemptInterest).toLocaleString()}` : null },
    { line: "3a/3b", label: "Qualified / ordinary dividends", amount: r0(ordDiv), memo: qualDiv ? `qualified: $${r0(qualDiv).toLocaleString()}` : null },
    { line: "4b", label: "IRA distributions (taxable)", amount: r0(iraDist) },
    { line: "5b", label: "Pensions & annuities (taxable)", amount: r0(pensions) },
    { line: "6b", label: "Social Security (taxable portion)", amount: taxableSS },
    { line: "7", label: "Capital gain or (loss)", amount: r0(capGainLine7) },
    { line: "8", label: "Additional income (Schedule 1)", amount: r0(schCNet + rental + k1Passive + k1Nonpassive + unemployment + otherIncome) },
    { line: "9", label: "Total income", amount: r0(totalIncome), strong: true },
    { line: "10", label: "Adjustments to income (Schedule 1)", amount: r0(adjustments) },
    { line: "11", label: "Adjusted gross income", amount: r0(agi), strong: true },
    { line: "12", label: useItemized ? "Itemized deductions (Schedule A)" : "Standard deduction", amount: r0(deduction) },
    { line: "12+", label: "OBBBA additional deductions (senior / tips / OT / auto / charity)", amount: extraDeductions, hide: extraDeductions === 0 },
    { line: "13", label: "QBI deduction (§199A)", amount: qbi.amount, hide: qbi.amount === 0 },
    { line: "15", label: "Taxable income", amount: r0(taxableIncome), strong: true },
    { line: "16", label: "Tax (brackets + capital-gains rates)", amount: taxBeforeCredits },
    { line: "17", label: "AMT (screening estimate)", amount: amt.applies ? amt.amount : 0, hide: !amt.applies },
    { line: "19", label: "Child tax credit / other dependents", amount: ctc.nonrefundable, hide: ctc.nonrefundable === 0 },
    { line: "20", label: "Other credits (education, care, FTC)", amount: r0(edu.aotcNonref + edu.llc + cdcc + foreignTaxCredit + num(CR.otherNonrefundable)), hide: edu.aotcNonref + edu.llc + cdcc + foreignTaxCredit + num(CR.otherNonrefundable) === 0 },
    { line: "22", label: "Tax after credits", amount: r0(taxAfterCredits) },
    { line: "23", label: "Other taxes (SE, Add'l Medicare, NIIT)", amount: otherTaxes, hide: otherTaxes === 0 },
    { line: "24", label: "TOTAL TAX", amount: totalTax, strong: true },
    { line: "25", label: "Federal withholding", amount: r0(withholding) },
    { line: "26", label: "Estimated payments", amount: r0(estimates), hide: estimates === 0 },
    { line: "28", label: "Refundable CTC (ACTC)", amount: ctc.refundable, hide: ctc.refundable === 0 },
    { line: "29", label: "Refundable AOTC", amount: edu.aotcRefundable, hide: edu.aotcRefundable === 0 },
    { line: "33", label: "Total payments", amount: totalPayments, strong: true },
    balance <= 0
      ? { line: "34", label: "REFUND", amount: r0(Math.abs(balance)), strong: true, good: true }
      : { line: "37", label: "AMOUNT YOU OWE", amount: r0(balance), strong: true, bad: true },
  ].filter((l) => !l.hide);

  diag.push("Educational draft only — not filing software and not tax advice. State tax, §469 passive limits, UBIA, Form 1116 FTC limits, and credit interactions are simplified or omitted.");

  return {
    taxYear: year,
    filingStatus: fs,
    lines,
    summary: {
      totalIncome: r0(totalIncome), agi: r0(agi), deduction: r0(deduction), taxableIncome: r0(taxableIncome),
      totalTax, totalPayments, balance: r0(balance), refund: balance <= 0 ? r0(Math.abs(balance)) : 0, owed: balance > 0 ? r0(balance) : 0,
      effectiveRate, marginalRate: Math.round(marginalRate(ordinaryTI, brackets) * 100),
      seTax: r0(se.tax), niit: niitTax, additionalMedicare: addlMedicare, amtEstimate: amt.applies ? amt.amount : 0,
      capitalGainsTiers: cg.tiers, bracketBreakdown: ord.breakdown, lossCarryover,
    },
    credits: { ctc, education: edu, childCare: cdcc },
    itemization: { used: useItemized ? "itemized" : "standard", standard: r0(std), itemized: itemizedTotal, salt: saltDeductible, medical: r0(medical), charitable: r0(charitable), mortgage: r0(mortgage) },
    qbi: { amount: qbi.amount },
    safeHarbor,
    diagnostics: diag,
  };
}

// Legacy-compatible simple calculator (kept for /api/calculate-tax)
function simpleTax(year, income, filingStatus, itemizedDeductions, options = {}) {
  return draftReturn({
    year,
    filingStatus,
    income: { wages: income, longTermGain: options.longTermCapGains || 0, scheduleCGross: options.selfEmployed ? options.selfEmploymentIncome || 0 : 0 },
    deductions: itemizedDeductions ? { forceItemize: true, saltPaid: 0, mortgageInterest: itemizedDeductions } : {},
    payments: {},
    household: {},
  });
}

module.exports = { init, draftReturn, simpleTax, ordinaryTax, saltAllowed };
