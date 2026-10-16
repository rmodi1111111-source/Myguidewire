import type { Account, Product, RiskData } from '../types.js';
import { CYBER_FORMS, CYBER_LIMITS, CYBER_QUESTIONS, CYBER_RETENTIONS, CYBER_SE_LIMITS, defaultCyberRisk } from './cyber.js';
import { AOP_DEDUCTIBLES, CONSTRUCTION_CLASSES, OCCUPANCIES, PROPERTY_FORMS, WIND_HAIL_DEDUCTIBLES, defaultPropertyRisk } from './property.js';
import { GL_CLASSES, GL_DEDUCTIBLES, GL_FORMS, GL_LIMIT_OPTIONS, defaultGLRisk } from './gl.js';
import { ENTITY_TYPES, INDUSTRIES, LITIGATION_ENVIRONMENT, SANCTIONS_LIST, STATES, SUBMISSION_SOURCES } from './reference.js';

export interface ProductDef {
  code: Product;
  name: string;
  abbreviation: string;
  /** Wizard steps shown in the left navigation, after the common steps. */
  riskSteps: { key: string; label: string }[];
  minimumPremium: number;
  policyFee: number;
  /** Appetite rules evaluated at clearance. */
  appetite: {
    declinedNaics: Record<string, string>;
    referredNaics: Record<string, string>;
    maxRevenueRefer?: number;
    maxRevenueDecline?: number;
    excludedStates: string[];
    minYearsInBusiness?: number;
  };
}

export const PRODUCTS: Record<Product, ProductDef> = {
  CYBER: {
    code: 'CYBER',
    name: 'Cyber Liability',
    abbreviation: 'CY',
    riskSteps: [
      { key: 'qualification', label: 'Qualification' },
      { key: 'exposure', label: 'Exposure & Data' },
      { key: 'coverages', label: 'Coverages' },
    ],
    minimumPremium: 1_000,
    policyFee: 250,
    appetite: {
      declinedNaics: { '523999': 'Cryptocurrency exchanges are outside cyber appetite', '713210': 'Gaming / casino operations are outside cyber appetite' },
      referredNaics: { '622110': 'Hospitals require senior underwriter referral', '921110': 'Public entities require referral', '518210': 'Data hosting providers require referral' },
      maxRevenueRefer: 500_000_000,
      maxRevenueDecline: 1_000_000_000,
      excludedStates: [],
      minYearsInBusiness: 2,
    },
  },
  PROPERTY: {
    code: 'PROPERTY',
    name: 'Commercial Property',
    abbreviation: 'CP',
    riskSteps: [
      { key: 'locations', label: 'Locations' },
      { key: 'buildings', label: 'Buildings' },
      { key: 'coverages', label: 'Coverages' },
    ],
    minimumPremium: 750,
    policyFee: 150,
    appetite: {
      declinedNaics: { '325920': 'Explosives manufacturing is prohibited for property' },
      referredNaics: { '311812': 'Commercial bakeries (combustible dust) require referral' },
      excludedStates: ['HI', 'AK'],
    },
  },
  GL: {
    code: 'GL',
    name: 'General Liability',
    abbreviation: 'GL',
    riskSteps: [
      { key: 'locations', label: 'Locations' },
      { key: 'exposures', label: 'Exposures' },
      { key: 'coverages', label: 'Coverages' },
    ],
    minimumPremium: 500,
    policyFee: 150,
    appetite: {
      declinedNaics: { '325920': 'Explosives manufacturing is prohibited for casualty' },
      referredNaics: { '238160': 'Roofing contractors require senior underwriter referral', '713210': 'Casinos require referral' },
      excludedStates: [],
    },
  },
};

export function defaultRisk(product: Product, account: Account): RiskData {
  const addr = { address1: account.address1, city: account.city, state: account.state, zip: account.zip };
  switch (product) {
    case 'CYBER':
      return defaultCyberRisk(account.annualRevenue, account.employeeCount, account.website);
    case 'PROPERTY':
      return defaultPropertyRisk(addr);
    case 'GL':
      return defaultGLRisk(addr);
  }
}

export function formsFor(product: Product) {
  return product === 'CYBER' ? CYBER_FORMS : product === 'PROPERTY' ? PROPERTY_FORMS : GL_FORMS;
}

/** Reference data shipped to the UI in a single call. */
export function referenceData() {
  return {
    products: PRODUCTS,
    states: STATES,
    industries: INDUSTRIES,
    entityTypes: ENTITY_TYPES,
    sources: SUBMISSION_SOURCES,
    cyber: { questions: CYBER_QUESTIONS, limits: CYBER_LIMITS, retentions: CYBER_RETENTIONS, seLimits: CYBER_SE_LIMITS, forms: CYBER_FORMS },
    property: { constructionClasses: CONSTRUCTION_CLASSES, occupancies: OCCUPANCIES, aopDeductibles: AOP_DEDUCTIBLES, windHailDeductibles: WIND_HAIL_DEDUCTIBLES, forms: PROPERTY_FORMS },
    gl: { classes: GL_CLASSES, limitOptions: GL_LIMIT_OPTIONS, deductibles: GL_DEDUCTIBLES, forms: GL_FORMS },
    sanctionsList: SANCTIONS_LIST,
    litigation: LITIGATION_ENVIRONMENT,
  };
}
