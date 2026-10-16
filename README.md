# PreBind Center

A pre-bind underwriting workbench for **Cyber Liability**, **Commercial Property** and **General Liability**, modeled on the Guidewire PolicyCenter submission workflow. It covers everything up to bind:

**Submission intake → Clearance → Risk entry → CRP scan → UW review → Pricing → Quote document**

> Independent implementation inspired by PolicyCenter's workflow, screen layout and terminology (Account → Submission job → Versions, wizard steps, UW issues with authority levels, Close Options, Edit Quote). It contains no Guidewire code, assets or branding and is not affiliated with Guidewire Software.

## Quick start

Requires Node.js 22.5+ (uses the built-in `node:sqlite`).

```bash
npm install
npm run build        # build the web UI
npm start            # API + UI on http://localhost:3001 (auto-seeds sample data on first run)
```

Development (hot reload, UI on http://localhost:5173 proxying to the API on :3001):

```bash
npm run dev
```

Other scripts:

| Command | Purpose |
|---|---|
| `npm run seed` | Reset the database and reload sample data |
| `npm test` | Server unit + API workflow tests (vitest) |
| `npm run typecheck` | Type-check server and web |

Switch users with the selector at the top right to exercise authority levels:

| User | Role | Authority |
|---|---|---|
| Sam Patel | Intake Specialist | 0 - create submissions, run clearance |
| Jordan Lee | Underwriter | 1 - decline, approve level-1 issues |
| Priya Shah | Senior Underwriter | 2 - clear referrals, level-2 issues, reopen |
| Morgan Chen | Underwriting Manager | 3 - override clearance declines, level-3 issues |

## Workflow

| Stage | PolicyCenter equivalent | What happens here |
|---|---|---|
| **Intake** | New Submission screen | Search or create the account (with fuzzy duplicate-account matching), choose producer, dates, source and priority, select one or more products (one submission per product), and attach broker documents. A broker portal / ACORD-style JSON API (`POST /api/intake`) creates submissions programmatically and matches accounts by FEIN or name. Underwriters are auto-assigned by workload. |
| **Clearance** | Clearance / duplicate check | Runs automatically at intake: sanctions (OFAC-style) screening, duplicate and broker-of-record conflict search (same account, FEIN, fuzzy name, address within 120 days), appetite and eligibility (NAICS, state, revenue, years in business), producer licensing, and submission completeness. **Pass** → Draft; **Refer** → Clearance Referral plus an activity for the UW; **Decline** → auto-declined. Senior UWs can override referrals, and managers can override declines, with a recorded justification. |
| **Risk entry** | Job wizard steps | **Cyber**: qualification questionnaire (17 security-control questions), revenue, records (PII/PHI/PCI) and domains, coverages (aggregate, retention, ransomware sublimit/coinsurance, social engineering, dependent BI, media, regulatory, PCI). **Property**: locations (protection class) and buildings (ISO construction, occupancy, year, sprinklers, alarm, occupancy %, Building/BPP/BI limits), coverage terms (cause of loss, valuation, coinsurance, AOP and wind/hail deductibles, earthquake, equipment breakdown, TRIA). **GL**: locations, class-code exposures (sales/payroll/area), limits, deductibles and endorsements. Every product also has 5-year loss history and schedule rating. |
| **CRP scan** | Risk Analysis | A Comprehensive Risk Profile scan. **Cyber**: outside-in attack surface (exposed RDP/SMB/DBs, CISA KEV vulnerabilities, EOL software, TLS, SPF/DMARC/DKIM, leaked credentials, lookalike domains, patch cadence). **Property**: per-location hazards (wind tier, hail, FEMA flood zone, seismic, wildfire, crime). **GL**: operations hazard, OSHA citations, recalls, lawsuits, litigation venue. Each scan yields a 300–950 score with an A–F grade. The cyber score is a rating factor. |
| **UW review** | Underwriter Issues | About 50 rules raise issues with a blocking point (Quote / Bind / Informational), a required authority level, and an optional subjectivity. Underwriters approve or reject within their authority, or refer upward, which creates an approval activity. An approval sticks until the underlying value changes. |
| **Pricing** | Quote / rating worksheet | Product rating engines produce a full, line-by-line rating worksheet, premium by coverage, minimum premium, policy fee and state surcharges. Supports up to 5 **versions** (alternative limits or retentions) that are rated and compared side by side. |
| **Quote** | Quote, quote documents | Issuing a quote requires the version to be rated, with no open or rejected Quote-blocking issues. It generates a quote number, a 30-day validity window, and a **PDF quote proposal** (coverage schedule, premium summary, subjectivities, forms schedule, terms). **Edit Quote** supersedes the active quote. Decline, Withdraw and Reopen are available as close options. |

**Bind is intentionally out of scope.** The Bind Options button is present but disabled, and quoted submissions stay in **Quoted** status for hand-off.

Tools on every submission: Documents (upload/download), Notes, Activities, and a full History audit trail. The Desktop shows My Summary (pipeline counts), My Activities, My Submissions, the Clearance Queue and Active Quotes. Search covers submissions and accounts. Administration shows users and authority, producers, appetite, rating tables and the sanctions list.

## Sample data

`npm run seed` loads submissions at every stage:

- **CY-20001** Northwind Health (Cyber): scanned, two versions ($3M/$25K and $5M/$50K), issues approved, **quoted** with PDF
- **CP-20002** Bayside Logistics (Property, Tampa FL): three buildings, **rated**, with open TIV / Tier-1 wind / roof issues
- **GL-20003** Copperline Roofing (GL): **clearance referral** (roofing appetite)
- **CY-20004** Brightpath Software (Cyber): **draft**, questionnaire partly complete
- **GL-20005 / CP-20006** Maple Street Bistro: multi-product **drafts**
- **CY-20007** Volkov Maritime: **auto-declined**, sanctions hit
- **CY-20008** Northwind Health via a second broker: **broker-of-record conflict** referral

## Architecture

```
server/                 Node + Express + TypeScript (run with tsx), SQLite via node:sqlite
  src/products/         Product definitions: questions, coverage options, class codes, forms, appetite
  src/services/
    clearance.ts        Sanctions, duplicate/BOR, appetite, licensing, completeness checks
    scan/crp.ts         CRP scan providers (pluggable ScanProvider interface; deterministic simulator)
    uwRules.ts          Underwriting rules -> UW issues
    validation.ts       Pre-rating data validation
    rating/             Cyber, Property, GL rating engines with rating worksheets
    quoteDoc.ts         PDF quote proposal (pdfkit)
    workflow.ts         Status machine and orchestration
  src/app.ts            REST API
  test/                 vitest unit + end-to-end API tests
web/                    React + TypeScript + Vite, PolicyCenter-style UI
```

Environment variables: `PORT` (default 3001), `DB_PATH` (default `server/data/prebind.db`), `UPLOAD_DIR`, `CARRIER_NAME` (quote letterhead, default "Summit Ridge Insurance Company"), `CRP_PROVIDER`.

## Assumptions and simulated components

- **"CRP scanning"** is implemented as a *Comprehensive Risk Profile* scan: a cyber security-posture scan for Cyber, and hazard/exposure scans for Property and GL. If "CRP" means something specific in your process, the scan lives behind the `ScanProvider` interface in `server/src/services/scan/crp.ts` and can be swapped out.
- The CRP scan, the sanctions list, the hazard data and all rates and factors are **illustrative simulations**. They are deterministic, so the same input gives the same result. They are not filed rates or real vendor data. To go to production, replace them with real feeds (for example a security-ratings vendor, CAT models, OFAC SDN, ISO loss costs).
- Authentication is a user switcher (`X-User-Id` header) for demonstration. Production use needs real SSO/RBAC.
