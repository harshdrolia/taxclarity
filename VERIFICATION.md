# Figures for Your Professional Review (30 min, one-time)

Everything marked VERIFIED matched IRS.gov / Rev. Proc. 2025-32 / Tax Foundation during the build.
Items below are estimates or recollections — confirm before promoting the site heavily.

## TY2026 (data/tax-2026.json) — confirm against Rev. Proc. 2025-32
- [ ] HOH bracket mid-tiers (interpolated: 12% top $67,450; 32% top $256,200)
- [ ] MFS 35% top ($384,350) 
- [ ] LTCG breakpoints (est. +2.3%: 0% $49,450/$98,900; 15% $545,500/$613,700) — §4.03
- [ ] EITC sub-maximums 0/1/2 children ($664 / $4,427 / $7,316); 3+ = $8,231 VERIFIED
- [ ] SALT phasedown MAGI threshold (est. $505,000)
- [ ] Retirement (Notice 2025-67 recollection): 401(k) $24,500 / catch-up $8,000 / IRA $7,500 / IRA catch-up $1,100 / SEP $72,000
- [ ] HSA $4,400 / $8,750 (Rev. Proc. 2025-19)
- [ ] Student loan interest MFJ phaseout 2026 ($175K–$205K in engine)
- [ ] stateInfo block copied from 2025 — spot-check IN/NC rates

VERIFIED already: std deductions 16,100/32,200/24,150 · brackets single/MFJ · AMT 90,100/140,200 with $500K/$1M @50% phaseout · CTC $2,200/$1,700 · SALT $40,400 · estate $15M · gift $19K · FEIE $132,900 · SS wage base $184,500 · QBI thresholds 201,775/403,550 · senior $6K · adoption $17,670.

## Engine simplifications (disclosed in-app; confirm you're comfortable)
- §469 passive limits, §465 at-risk, §461(l): flagged, not computed
- QBI: 50%-wage limit only (no UBIA alternative, no aggregation)
- FTC capped at $600 election threshold (no Form 1116)
- AMT: screening estimate, SALT-only preference
- IRA deduction ignores active-participant phaseouts (noted to user)
- 2026 charitable: 0.5% AGI floor applied; 37%-bracket 35% benefit cap NOT modeled

## Content
- [ ] Skim guides.html — ported verbatim from v2; anything you'd now update for July 2026?
- [ ] Glossary is only 12 terms — the search index makes expansion high-value (send me 20 terms, I'll format)
- [ ] about.html LinkedIn URL — confirm handle
