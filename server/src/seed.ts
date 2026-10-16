// Sample data: users, producers, accounts and submissions at every workflow stage.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, initDb, repo } from './db.js';
import type { CyberRisk, GLRisk, PropertyRisk } from './types.js';
import * as wf from './services/workflow.js';

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const GOOD_CYBER_ANSWERS: Record<string, string> = {
  MFA_REMOTE: 'Yes', MFA_EMAIL: 'Yes', MFA_PRIVILEGED: 'Yes', EDR: 'Yes', MDR_SOC: 'Yes', BACKUPS_OFFLINE: 'Yes', BACKUP_TESTED: 'Yes',
  PATCH_CADENCE: 'Within 30 days', EOL_SOFTWARE: 'No', ENCRYPTION: 'Yes', PCI_COMPLIANT: 'N/A - no card payments', TRAINING: 'Yes',
  WIRE_VERIFY: 'Yes', IR_PLAN: 'Yes', VENDOR_MGMT: 'Yes', PRIOR_INCIDENTS: '0', PENDING_CLAIMS: 'No',
};

export function seed() {
  const d = getDb();
  const users: [string, string, string, number, string][] = [
    ['spatel', 'Sam Patel', 'Intake Specialist', 0, 'sam.patel@example.com'],
    ['jlee', 'Jordan Lee', 'Underwriter', 1, 'jordan.lee@example.com'],
    ['pshah', 'Priya Shah', 'Senior Underwriter', 2, 'priya.shah@example.com'],
    ['mchen', 'Morgan Chen', 'Underwriting Manager', 3, 'morgan.chen@example.com'],
    ['admin', 'Avery Admin', 'Administrator', 3, 'admin@example.com'],
  ];
  for (const u of users) d.prepare('INSERT INTO users(username, name, role, authority_level, email) VALUES(?,?,?,?,?)').run(...u);

  const all = ['AL','AZ','CA','CO','CT','DE','FL','GA','IL','IN','KY','LA','MA','MD','MI','MN','MO','NC','NJ','NV','NY','OH','OK','OR','PA','SC','TN','TX','VA','WA','WI'];
  const producers: [string, string, string, string, string, string, string, string[], number, number][] = [
    ['P1001', 'Atlantic Risk Partners', 'Dana Whitfield', 'dana@atlanticrisk.example', '212-555-0101', 'New York', 'NY', all, 15, 1],
    ['P1002', 'Harborview Insurance Brokers', 'Luis Ortega', 'luis@harborview.example', '415-555-0144', 'San Francisco', 'CA', ['CA', 'OR', 'WA', 'NV', 'AZ', 'NY'], 12.5, 1],
    ['P1003', 'Lone Star Commercial Agency', 'Kim Nguyen', 'kim@lonestarca.example', '214-555-0190', 'Dallas', 'TX', ['TX', 'OK', 'LA', 'NM'], 15, 1],
    ['P1004', 'Great Lakes Brokerage', 'Pat Kowalski', 'pat@greatlakes.example', '312-555-0123', 'Chicago', 'IL', ['IL', 'IN', 'MI', 'WI', 'OH', 'MN', 'FL'], 15, 1],
    ['P1999', 'Legacy Agency (terminated)', 'N/A', 'n/a@example.com', '000-000-0000', 'Boston', 'MA', ['MA'], 10, 0],
  ];
  for (const p of producers) d.prepare('INSERT INTO producers(code, name, contact_name, email, phone, city, state, licensed_states, commission_pct, active) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], JSON.stringify(p[7]), p[8], p[9]);

  const intake = repo.user(1)!;
  const uw = repo.user(2)!;
  const senior = repo.user(3)!;
  const mgr = repo.user(4)!;

  const acct = (a: Parameters<typeof wf.createAccount>[0]) => wf.createAccount(a, intake);
  const northwind = acct({ name: 'Northwind Health Partners LLC', fein: '13-4567890', entityType: 'LLC', naics: '621111', industry: 'Offices of Physicians', address1: '450 Park Avenue South', city: 'New York', state: 'NY', zip: '10016', website: 'northwindhealth.com', yearsInBusiness: 14, annualRevenue: 42_000_000, employeeCount: 310, contactName: 'Rachel Kim', contactEmail: 'rkim@northwindhealth.com', contactPhone: '212-555-0177' });
  const bayside = acct({ name: 'Bayside Logistics Inc', fein: '59-1234567', entityType: 'Corporation', naics: '493110', industry: 'General Warehousing and Storage', address1: '2200 Port Tampa Blvd', city: 'Tampa', state: 'FL', zip: '33605', website: 'baysidelogistics.com', yearsInBusiness: 22, annualRevenue: 18_500_000, employeeCount: 120, contactName: 'Marcus Hill', contactEmail: 'mhill@baysidelogistics.com', contactPhone: '813-555-0102' });
  const copperline = acct({ name: 'Copperline Roofing & Construction Co', fein: '75-9876543', entityType: 'Corporation', naics: '238160', industry: 'Roofing Contractors', address1: '9100 Harry Hines Blvd', city: 'Dallas', state: 'TX', zip: '75235', website: 'copperlineroofing.com', yearsInBusiness: 9, annualRevenue: 26_000_000, employeeCount: 140, contactName: 'Tom Reyes', contactEmail: 'treyes@copperline.com', contactPhone: '214-555-0166' });
  const brightpath = acct({ name: 'Brightpath Software Inc', fein: '94-3332211', entityType: 'Corporation', naics: '511210', industry: 'Software Publishers', address1: '100 Innovation Way', city: 'San Jose', state: 'CA', zip: '95134', website: 'brightpathsoftware.io', yearsInBusiness: 7, annualRevenue: 65_000_000, employeeCount: 240, contactName: 'Mei Lin', contactEmail: 'mlin@brightpath.io', contactPhone: '408-555-0133' });
  const maple = acct({ name: 'Maple Street Bistro LLC', fein: '36-5550001', entityType: 'LLC', naics: '722511', industry: 'Full-Service Restaurants', address1: '812 W Maple St', city: 'Chicago', state: 'IL', zip: '60610', website: 'maplestreetbistro.com', yearsInBusiness: 5, annualRevenue: 3_200_000, employeeCount: 45, contactName: 'Olivia Grant', contactEmail: 'olivia@maplestreetbistro.com', contactPhone: '312-555-0188' });
  const volkov = acct({ name: 'Volkov Maritime Trading LLC', fein: '98-0001111', entityType: 'LLC', naics: '424410', industry: 'General Line Grocery Wholesalers', address1: '1 World Trade Center', city: 'New York', state: 'NY', zip: '10007', website: 'volkovmaritime.example', yearsInBusiness: 3, annualRevenue: 12_000_000, employeeCount: 20 });

  const eff = daysFromNow(30);

  // 1. Northwind cyber: fully underwritten and quoted.
  const s1 = wf.createSubmission({ accountId: northwind.id, producerId: 1, product: 'CYBER', effectiveDate: eff, source: 'Broker Portal', priority: 'High', description: 'Renewal from incumbent; broker requests $3M and $5M options.' }, intake);
  {
    const v = repo.version(s1.selectedVersionId!)!;
    const risk = v.risk as CyberRisk;
    Object.assign(risk, { piiRecords: 180_000, phiRecords: 240_000, pciRecords: 0, domains: ['northwindhealth.com'], answers: { ...GOOD_CYBER_ANSWERS }, noLossesCertified: true });
    risk.coverages.aggregateLimit = 3_000_000;
    risk.coverages.retention = 25_000;
    wf.updateRisk(s1.id, v.id, risk, uw);
    wf.renameVersion(s1.id, v.id, '$3M xs $25K');
    wf.runScan(s1.id, uw);
    wf.rateSubmission(s1.id, uw);
    const v2 = wf.copyVersion(s1.id, v.id, uw);
    const r2 = v2.risk as CyberRisk;
    r2.coverages.aggregateLimit = 5_000_000;
    r2.coverages.retention = 50_000;
    wf.updateRisk(s1.id, v2.id, r2, uw);
    wf.renameVersion(s1.id, v2.id, '$5M xs $50K');
    wf.rateSubmission(s1.id, uw, v2.id);
    for (const i of repo.issues(s1.id, v.id)) if (i.status === 'Open') wf.decideIssue(i.id, 'Approve', 'Approved - strong controls and healthcare experience', mgr);
    wf.issueQuote(s1.id, senior);
    getDb().prepare('INSERT INTO notes(submission_id, account_id, topic, subject, body, author, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(s1.id, northwind.id, 'Underwriting', 'Account rationale', 'Mature security program, MDR in place, tested backups. PHI volume is the main severity driver; priced accordingly.', senior.name, new Date().toISOString());
  }

  // 2. Bayside property: rated, pending UW approval of CAT issues.
  const s2 = wf.createSubmission({ accountId: bayside.id, producerId: 4, product: 'PROPERTY', effectiveDate: eff, source: 'ACORD Upload', description: 'Two-building warehouse campus near Port Tampa.' }, intake);
  {
    const v = repo.version(s2.selectedVersionId!)!;
    const risk = v.risk as PropertyRisk;
    risk.locations[0].protectionClass = 3;
    risk.locations.push({ id: 'L2', number: 2, address1: '4800 W Gandy Blvd', city: 'Tampa', state: 'FL', zip: '33611', protectionClass: 4 });
    risk.buildings = [
      { id: 'B1', locationId: 'L1', number: 1, description: 'Main distribution warehouse', constructionClass: 4, occupancy: 'Warehouse', yearBuilt: 1998, roofYear: 2016, stories: 1, squareFeet: 120_000, sprinklerPct: 100, alarm: 'Central Station', occupiedPct: 100, buildingValue: 9_500_000, bppValue: 4_000_000, biValue: 2_500_000 },
      { id: 'B2', locationId: 'L1', number: 2, description: 'Office annex', constructionClass: 2, occupancy: 'Office', yearBuilt: 1985, roofYear: 2002, stories: 2, squareFeet: 14_000, sprinklerPct: 0, alarm: 'Local', occupiedPct: 100, buildingValue: 1_800_000, bppValue: 350_000, biValue: 0 },
      { id: 'B3', locationId: 'L2', number: 1, description: 'Cold storage facility', constructionClass: 3, occupancy: 'Warehouse', yearBuilt: 2008, roofYear: 2008, stories: 1, squareFeet: 60_000, sprinklerPct: 100, alarm: 'Central Station', occupiedPct: 100, buildingValue: 6_200_000, bppValue: 3_100_000, biValue: 1_200_000 },
    ];
    risk.coverages.windHailDeductiblePct = 2;
    risk.coverages.aopDeductible = 10_000;
    risk.losses = [{ date: daysFromNow(-800), type: 'Water Damage', description: 'Sprinkler head failure in warehouse', paid: 38_000, reserved: 0, status: 'Closed' }];
    wf.updateRisk(s2.id, v.id, risk, uw);
    wf.runScan(s2.id, uw);
    wf.rateSubmission(s2.id, uw);
  }

  // 3. Copperline GL: roofing contractor in clearance referral.
  wf.createSubmission({ accountId: copperline.id, producerId: 3, product: 'GL', effectiveDate: daysFromNow(45), source: 'Broker Email', priority: 'Normal', description: 'Commercial roofing contractor, 30% subcontracted.' }, intake);

  // 4. Brightpath cyber: draft, partially entered.
  const s4 = wf.createSubmission({ accountId: brightpath.id, producerId: 2, product: 'CYBER', effectiveDate: daysFromNow(21), source: 'Broker Portal', priority: 'Rush' }, intake);
  {
    const v = repo.version(s4.selectedVersionId!)!;
    const risk = v.risk as CyberRisk;
    risk.piiRecords = 2_400_000;
    risk.pciRecords = 50_000;
    risk.answers = { MFA_REMOTE: 'Yes', MFA_EMAIL: 'Yes', EDR: 'Yes', BACKUPS_OFFLINE: 'No', PATCH_CADENCE: '31-90 days' };
    wf.updateRisk(s4.id, v.id, risk, uw);
  }

  // 5. Maple Street Bistro: GL and Property package, draft.
  const msb = wf.createSubmission({ accountId: maple.id, producerId: 4, product: 'GL', effectiveDate: daysFromNow(60), source: 'Phone' }, intake);
  {
    const v = repo.version(msb.selectedVersionId!)!;
    const risk = v.risk as GLRisk;
    risk.exposures = [{ id: 'E1', locationId: 'L1', classCode: '16910', exposure: 3_200_000 }];
    risk.noLossesCertified = true;
    wf.updateRisk(msb.id, v.id, risk, uw);
  }
  wf.createSubmission({ accountId: maple.id, producerId: 4, product: 'PROPERTY', effectiveDate: daysFromNow(60), source: 'Phone' }, intake);

  // 6. Sanctions hit: auto-declined at clearance.
  wf.createSubmission({ accountId: volkov.id, producerId: 1, product: 'CYBER', effectiveDate: daysFromNow(15), source: 'Broker Email' }, intake);

  // 7. Broker-of-record conflict: Northwind cyber submitted by a second broker.
  wf.createSubmission({ accountId: northwind.id, producerId: 2, product: 'CYBER', effectiveDate: daysFromNow(35), source: 'Broker Email', description: 'Second broker submission - BOR letter pending.' }, intake);

  return { users: users.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.env.DB_PATH ?? path.resolve('data', 'prebind.db');
  if (process.argv.includes('--reset')) for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  initDb(file);
  seed();
  console.log(`Seeded ${file}`);
}

