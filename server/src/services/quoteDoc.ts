// Quote proposal PDF generation.

import PDFDocument from 'pdfkit';
import { CONSTRUCTION_CLASSES } from '../products/property.js';
import { GL_LIMIT_OPTIONS, glClass } from '../products/gl.js';
import type { QuoteSnapshot } from '../types.js';

export type { QuoteSnapshot };


export const CARRIER_NAME = process.env.CARRIER_NAME ?? 'Summit Ridge Insurance Company';

const NAVY = '#1f3a5f';
const GREY = '#666666';
const LIGHT = '#eef2f7';
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtDate = (d: string) => new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

type Doc = PDFKit.PDFDocument;

const LEFT = 50;
const WIDTH = 512;

function ensureSpace(doc: Doc, h: number) {
  if (doc.y + h > doc.page.height - 70) doc.addPage();
}

function heading(doc: Doc, text: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.6);
  const y = doc.y;
  doc.rect(LEFT, y, WIDTH, 18).fill(NAVY);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text(text.toUpperCase(), LEFT + 6, y + 5, { width: WIDTH - 12 });
  doc.fillColor('black').font('Helvetica').fontSize(9);
  doc.y = y + 24;
}

function table(doc: Doc, cols: { header: string; width: number; align?: 'left' | 'right' | 'center' }[], rows: string[][], opts: { bold?: number[] } = {}) {
  const pad = 4;
  const drawRow = (cells: string[], header: boolean, shade: boolean, bold: boolean) => {
    const heights = cells.map((c, i) => doc.font(header || bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(c ?? '', { width: cols[i].width - pad * 2 }));
    const h = Math.max(...heights) + pad * 2;
    ensureSpace(doc, h);
    const y = doc.y;
    if (header) doc.rect(LEFT, y, WIDTH, h).fill('#d9e1ec');
    else if (shade) doc.rect(LEFT, y, WIDTH, h).fill(LIGHT);
    doc.fillColor('black');
    let x = LEFT;
    cells.forEach((c, i) => {
      doc.font(header || bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(c ?? '', x + pad, y + pad, { width: cols[i].width - pad * 2, align: cols[i].align ?? 'left' });
      x += cols[i].width;
    });
    doc.y = y + h;
  };
  drawRow(cols.map((c) => c.header), true, false, false);
  rows.forEach((r, i) => drawRow(r, false, i % 2 === 1, opts.bold?.includes(i) ?? false));
  doc.x = LEFT;
}

/** Two-column label/value grid. */
function keyValues(doc: Doc, pairs: [string, string][], colWidth = 256) {
  for (let i = 0; i < pairs.length; i += 2) {
    ensureSpace(doc, 24);
    const y = doc.y;
    let maxY = y;
    for (let col = 0; col < 2; col++) {
      const pair = pairs[i + col];
      if (!pair) continue;
      const x = LEFT + col * colWidth;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREY).text(pair[0], x, y, { width: 96 });
      maxY = Math.max(maxY, doc.y);
      doc.font('Helvetica').fillColor('black').text(pair[1] || '-', x + 100, y, { width: colWidth - 104 });
      maxY = Math.max(maxY, doc.y);
    }
    doc.y = maxY + 2;
  }
  doc.x = LEFT;
}

function coverageSchedule(doc: Doc, s: QuoteSnapshot) {
  const r = s.risk;
  if (r.product === 'CYBER') {
    const c = r.coverages;
    const rw = c.ransomwareSublimitPct === 100 ? money(c.aggregateLimit) : money((c.aggregateLimit * c.ransomwareSublimitPct) / 100);
    table(doc, [{ header: 'Insuring Agreement', width: 300 }, { header: 'Limit', width: 106, align: 'right' }, { header: 'Retention', width: 106, align: 'right' }], [
      ['Policy Aggregate Limit of Liability', money(c.aggregateLimit), money(c.retention)],
      ['Privacy & Network Security Liability', money(c.aggregateLimit), money(c.retention)],
      ['Regulatory Proceedings, Fines & Penalties', c.regulatoryFines ? money(c.aggregateLimit) : 'Not Covered', money(c.retention)],
      ['Breach Response Costs', money(c.aggregateLimit), money(c.retention)],
      [`Business Interruption (${c.biWaitingHours}-hour waiting period)`, money(c.aggregateLimit), `${c.biWaitingHours} hours`],
      ['Data Restoration', money(c.aggregateLimit), money(c.retention)],
      [`Cyber Extortion / Ransomware${c.ransomwareCoinsurancePct ? ` (${c.ransomwareCoinsurancePct}% coinsurance)` : ''}`, rw, money(c.retention)],
      ['Social Engineering Fraud', c.socialEngineeringLimit ? money(c.socialEngineeringLimit) : 'Not Covered', c.socialEngineeringLimit ? money(c.retention) : '-'],
      ['Dependent Business Interruption', c.dependentBI ? money(c.aggregateLimit) : 'Not Covered', c.dependentBI ? `${c.biWaitingHours} hours` : '-'],
      ['Media Liability', c.mediaLiability ? money(c.aggregateLimit) : 'Not Covered', c.mediaLiability ? money(c.retention) : '-'],
      ['PCI Fines & Assessments', c.pciFines ? money(Math.min(c.aggregateLimit, 500_000)) : 'Not Covered', c.pciFines ? money(c.retention) : '-'],
    ]);
  } else if (r.product === 'PROPERTY') {
    const c = r.coverages;
    keyValues(doc, [
      ['Cause of Loss', c.causeOfLoss], ['Valuation', c.valuation === 'RC' ? 'Replacement Cost' : 'Actual Cash Value'],
      ['Coinsurance', `${c.coinsurance}%`], ['AOP Deductible', money(c.aopDeductible)],
      ['Wind/Hail Deductible', c.windHailDeductiblePct ? `${c.windHailDeductiblePct}% of TIV per building` : 'AOP deductible applies'],
      ['Earthquake', c.earthquake ? 'Included' : 'Excluded'], ['Equipment Breakdown', c.equipmentBreakdown ? 'Included' : 'Excluded'],
      ['Terrorism (TRIA)', c.terrorism ? 'Included' : 'Rejected'],
    ]);
    doc.moveDown(0.5);
    table(doc, [
      { header: 'Loc/Bldg', width: 50 }, { header: 'Address / Description', width: 170 }, { header: 'Construction', width: 82 },
      { header: 'Building', width: 70, align: 'right' }, { header: 'BPP', width: 70, align: 'right' }, { header: 'BI/EE', width: 70, align: 'right' },
    ], r.buildings.map((b) => {
      const loc = r.locations.find((l) => l.id === b.locationId);
      return [`${loc?.number ?? '?'} / ${b.number}`, `${loc?.address1 ?? ''}, ${loc?.city ?? ''} ${loc?.state ?? ''}\n${b.description || b.occupancy}`, CONSTRUCTION_CLASSES[b.constructionClass]?.name ?? '', money(b.buildingValue), money(b.bppValue), money(b.biValue)];
    }));
  } else {
    const c = r.coverages;
    const lim = GL_LIMIT_OPTIONS[c.limitOption];
    table(doc, [{ header: 'Coverage', width: 380 }, { header: 'Limit', width: 132, align: 'right' }], [
      ['Each Occurrence', money(lim.occurrence)],
      ['General Aggregate (per location)', money(lim.aggregate)],
      ['Products-Completed Operations Aggregate', money(lim.productsAggregate)],
      ['Personal & Advertising Injury', money(c.personalAdvInjury)],
      ['Damage to Premises Rented to You', money(c.damageToRented)],
      ['Medical Expense (any one person)', c.medPay ? money(c.medPay) : 'Excluded'],
      ['BI/PD Deductible (per occurrence)', c.deductible ? money(c.deductible) : 'None'],
      ['Hired & Non-Owned Auto Liability', c.hiredNonOwnedAuto ? money(lim.occurrence) : 'Not Covered'],
    ]);
    doc.moveDown(0.5);
    table(doc, [{ header: 'Loc', width: 40 }, { header: 'Class', width: 50 }, { header: 'Description', width: 250 }, { header: 'Basis', width: 60 }, { header: 'Exposure', width: 112, align: 'right' }],
      r.exposures.map((e) => {
        const cls = glClass(e.classCode);
        const loc = r.locations.find((l) => l.id === e.locationId);
        return [String(loc?.number ?? '?'), e.classCode, cls?.description ?? '', cls?.basis ?? '', cls?.basis === 'Area' ? `${Number(e.exposure).toLocaleString()} sq ft` : money(e.exposure)];
      }));
  }
}

export function renderQuotePdf(s: QuoteSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: LEFT, right: 50 }, bufferPages: true, info: { Title: `Quote Proposal ${s.quoteNumber}`, Author: CARRIER_NAME } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill(NAVY);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(18).text(CARRIER_NAME, LEFT, 22);
    doc.font('Helvetica').fontSize(10).text(`${s.productName} - Quote Proposal`, LEFT, 46);
    doc.font('Helvetica-Bold').fontSize(10).text(s.quoteNumber, LEFT, 22, { width: WIDTH, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).text(`Issued ${fmtDate(s.issuedAt)}\nValid until ${fmtDate(s.validUntil)}`, LEFT, 38, { width: WIDTH, align: 'right' });
    doc.fillColor('black');
    doc.y = 95;

    doc.font('Helvetica-Oblique').fontSize(8).fillColor(GREY)
      .text('THIS IS A QUOTATION ONLY. IT IS NOT A BINDER, POLICY OR CERTIFICATE OF INSURANCE. COVERAGE IS NOT IN FORCE UNTIL BOUND IN WRITING BY THE COMPANY AND ALL SUBJECTIVITIES ARE SATISFIED.', LEFT, doc.y, { width: WIDTH, align: 'center' });
    doc.fillColor('black').font('Helvetica');

    heading(doc, 'Quote Information');
    const a = s.account;
    keyValues(doc, [
      ['Named Insured', a.name + (a.dba ? ` dba ${a.dba}` : '')], ['Submission #', s.jobNumber],
      ['Mailing Address', `${a.address1}, ${a.city}, ${a.state} ${a.zip}`], ['Account #', a.accountNumber],
      ['Policy Period', `${fmtDate(s.effectiveDate)} to ${fmtDate(s.expirationDate)} (12:01 AM standard time)`], ['Option', s.versionName],
      ['Producer', `${s.producer.name} (${s.producer.code})`], ['Underwriter', s.underwriter ? `${s.underwriter.name} - ${s.underwriter.email}` : '-'],
      ['Business', a.industry || a.naics], ['Annual Revenue', money(a.annualRevenue)],
    ]);
    if (s.scan) {
      doc.moveDown(0.3);
      doc.fontSize(8.5).font('Helvetica-Bold').text('CRP Risk Score: ', LEFT, doc.y, { continued: true }).font('Helvetica').text(`${s.scan.compositeScore} (Grade ${s.scan.grade}) - ${s.scan.provider}`);
    }

    heading(doc, 'Coverage Schedule');
    coverageSchedule(doc, s);

    heading(doc, 'Premium Summary');
    const p = s.pricing;
    const rows = p.lines.map((l) => [l.coverage, money(l.premium)]);
    rows.push(['Total Premium', money(p.premium)]);
    for (const t of p.taxesAndFees) rows.push([t.label, money(t.amount)]);
    rows.push(['TOTAL COST', money(p.totalCost)]);
    table(doc, [{ header: 'Coverage', width: 380 }, { header: 'Premium', width: 132, align: 'right' }], rows, { bold: [p.lines.length, rows.length - 1] });
    doc.moveDown(0.3).fontSize(8).fillColor(GREY).text(`Premium is ${p.minimumPremiumApplied ? 'subject to the policy minimum premium and is ' : ''}100% earned upon binding for any audit or cancellation below the minimum. Producer commission: ${s.producer.commissionPct}%.`, LEFT, doc.y, { width: WIDTH });
    doc.fillColor('black');

    heading(doc, 'Subjectivities (to be received prior to binding unless otherwise stated)');
    s.subjectivities.forEach((x, i) => {
      ensureSpace(doc, 14);
      doc.fontSize(8.5).text(`${i + 1}. ${x}`, LEFT + 4, doc.y, { width: WIDTH - 8 });
    });

    heading(doc, 'Forms & Endorsements');
    table(doc, [{ header: 'Form Number', width: 120 }, { header: 'Title', width: 392 }], s.forms.map((f) => [f.number, f.title]));

    heading(doc, 'Terms & Conditions');
    doc.fontSize(8).text(
      [
        `This quotation is valid until ${fmtDate(s.validUntil)} and is based on the information provided in the application and supplemental materials. Any material change in the risk prior to binding may result in a revised quotation or withdrawal of this offer.`,
        'Coverage will be provided solely in accordance with the terms, conditions, limitations and exclusions of the policy forms listed above. In the event of a conflict between this proposal and the policy, the policy will govern.',
        'Binding instructions must be received in writing from the producer of record. This proposal does not constitute a binder of coverage.',
      ].join('\n\n'),
      LEFT, doc.y, { width: WIDTH, align: 'justify' },
    );

    // Footer on each page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would otherwise trigger an automatic page break.
      doc.page.margins.bottom = 0;
      doc.fontSize(7).fillColor(GREY).text(`${CARRIER_NAME}  |  ${s.quoteNumber}  |  Page ${i + 1} of ${range.count}`, LEFT, doc.page.height - 35, { width: WIDTH, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
