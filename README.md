# TaxClarity — Taxes, Finally Made Clear

Tax education platform for Tax Year 2025 (OBBB applied). Includes interactive calculators, AI-powered research agent, downloadable professional templates, and comprehensive guides for individuals, businesses, and international students.

## Architecture

```
taxclarity/
├── server.js              # Express backend (API + Anthropic proxy)
├── data/
│   └── tax-2025.json      # ← SINGLE SOURCE OF TRUTH for all tax data
├── public/
│   ├── index.html          # Full SPA frontend
│   ├── robots.txt          # Allows crawling
│   ├── sitemap.xml         # SEO sitemap
│   ├── css/                # (future: extracted CSS)
│   ├── js/                 # (future: extracted JS)
│   └── downloads/          # Downloadable templates
│       ├── Partnership_Basis_Worksheet_Template.xlsx
│       ├── ASC740_Tax_Provision_Template.xlsx
│       ├── Tax_Research_Memo_Template.docx
│       ├── IRS_Audit_Response_Template.docx
│       └── Penalty_Abatement_Template.docx
├── package.json
├── Procfile                # Render deployment
├── .env.example
└── .gitignore
```

## Key Features

- **Data-driven**: All tax numbers in `data/tax-2025.json` — update one file for new tax year
- **4 calculators**: Federal tax, self-employment, withholding check, capital gains (with NIIT)
- **AI Research Agent**: Server-side Anthropic proxy (API key never exposed to browser)
- **5 downloadable templates**: Partnership basis (1,460 formulas), ASC 740 provision, tax research memo, IRS audit response, penalty abatement
- **Sheet protection**: Excel templates protected with password (basis / asc740)
- **Responsive**: Mobile-first with hamburger nav

## Deployment (Render)

1. Push to GitHub
2. Create new Web Service on Render → link repo
3. Build: `npm install` | Start: `node server.js`
4. Add env var: `ANTHROPIC_API_KEY`

## Updating for New Tax Year

1. Edit `data/tax-2025.json` → change brackets, deductions, credits, deadlines
2. Copy to `data/tax-2026.json` and update `server.js` path
3. Update HTML content sections that reference specific numbers
4. Rebuild Excel templates if needed

## Password for Protected Sheets

- Partnership Basis: `basis`
- ASC 740 Provision: `asc740`
