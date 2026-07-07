# TaxClarity v3 "Statute" — Deploy Guide

## Ship it (your usual 3 commands)
1. Extract this zip OVER your local taxclarity folder (replaces old files — v2 is preserved separately if you kept my backups).
2. `git add . && git commit -m "v3.0 Statute: redesign, dual-year engine, cited research, search" && git push`
3. Render auto-deploys (~2 min). Done.

Delete nothing manually — the zip already excludes the retired v2 files (main.css, app.js).

## Environment variables (Render → your service → Environment)
- Keep: ANTHROPIC_API_KEY
- Add for email (recommended — fixes the lost-subscriber bug):
  SMTP_USER, SMTP_PASS (Gmail App Password), NOTIFY_EMAIL
  → Newsletter signups and contact messages now land in your inbox.
- Optional: ALLOWED_ORIGINS=https://taxclarity.onrender.com (CORS lock),
  ENABLE_WEB_SEARCH=true (live-source citations, slower + costs per query).

Also set a monthly spend limit in the Anthropic Console — hard cap protects you if the endpoint is ever abused.

## After deploy — 2-minute smoke test
- /api/health → version 3.0.0, taxYears [2025, 2026], email: true
- Home search "754" → §754 links to Cornell
- Calculator: single, $100,000 wages, TY2025 → total tax $13,449
- Research page: run a sample → memo renders with linked chips

## Two decisions I recommend (not in this zip)
1. **Custom domain (~$12/yr).** onrender.com subdomains get bot-hostile treatment (my fetcher was refused despite your permissive robots.txt) and look temporary on a resume. Buy taxclarity.io or similar, add in Render → Custom Domains, then search-replace `taxclarity.onrender.com` in: public/sitemap.xml, public/robots.txt, and the assembled pages' canonical/og tags. Verify with `curl -I https://yourdomain` — no `x-robots-tag: noindex` header should appear.
2. **Kill cold starts.** Free tier sleeps after 15 min; recruiters see a blank screen. Either $7/mo Starter, or split: static front on Render Static/Cloudflare Pages (instant, free) + this Node service only for /api.

## Google Search Console (do once)
Add the site, submit /sitemap.xml. The old sitemap pointed to the dead clearfinance domain — this one is fixed, with real per-page URLs.

## What changed under the hood
- 6 real pages (was 1) — each guide area now indexable/shareable
- Draft Return Engine (lib/taxengine.js): TY2025+TY2026, verified against hand-computed vectors
- Citation linker: model cites structurally, SERVER builds links (Cornell LII / IRS.gov) — no hallucinated URLs possible
- Site search: 218-entry index (IRC/regs/forms/pubs/glossary/guides) at /api/search
- compression + cache headers, 90s AI timeout, proper 404s, form rate limits, debug-gated logging
