// Shared reference data: states, industries, sanctions list.

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export interface IndustryDef {
  naics: string;
  description: string;
  /** Cyber industry hazard factor. */
  cyberFactor: number;
}

/** Representative NAICS codes used for intake, appetite and rating. */
export const INDUSTRIES: IndustryDef[] = [
  { naics: '236220', description: 'Commercial Building Construction', cyberFactor: 0.85 },
  { naics: '238160', description: 'Roofing Contractors', cyberFactor: 0.85 },
  { naics: '238220', description: 'Plumbing, Heating & Air-Conditioning Contractors', cyberFactor: 0.85 },
  { naics: '311812', description: 'Commercial Bakeries', cyberFactor: 1.05 },
  { naics: '325920', description: 'Explosives Manufacturing', cyberFactor: 1.1 },
  { naics: '332710', description: 'Machine Shops', cyberFactor: 1.1 },
  { naics: '333249', description: 'Industrial Machinery Manufacturing', cyberFactor: 1.1 },
  { naics: '423430', description: 'Computer Equipment Wholesalers', cyberFactor: 0.95 },
  { naics: '424410', description: 'General Line Grocery Wholesalers', cyberFactor: 0.95 },
  { naics: '445110', description: 'Supermarkets and Grocery Stores', cyberFactor: 1.25 },
  { naics: '452319', description: 'General Merchandise Stores', cyberFactor: 1.25 },
  { naics: '484121', description: 'General Freight Trucking, Long-Distance', cyberFactor: 1.05 },
  { naics: '493110', description: 'General Warehousing and Storage', cyberFactor: 1.0 },
  { naics: '511210', description: 'Software Publishers', cyberFactor: 1.2 },
  { naics: '518210', description: 'Data Processing, Hosting and Related Services', cyberFactor: 1.3 },
  { naics: '522110', description: 'Commercial Banking', cyberFactor: 1.35 },
  { naics: '523999', description: 'Cryptocurrency Exchanges & Misc. Financial Investment', cyberFactor: 2.0 },
  { naics: '524210', description: 'Insurance Agencies and Brokerages', cyberFactor: 1.2 },
  { naics: '531120', description: 'Lessors of Nonresidential Buildings', cyberFactor: 0.9 },
  { naics: '541110', description: 'Offices of Lawyers', cyberFactor: 1.15 },
  { naics: '541211', description: 'Offices of Certified Public Accountants', cyberFactor: 1.15 },
  { naics: '541330', description: 'Engineering Services', cyberFactor: 1.0 },
  { naics: '541511', description: 'Custom Computer Programming Services', cyberFactor: 1.2 },
  { naics: '541611', description: 'Management Consulting Services', cyberFactor: 1.0 },
  { naics: '611310', description: 'Colleges and Universities', cyberFactor: 1.4 },
  { naics: '621111', description: 'Offices of Physicians', cyberFactor: 1.45 },
  { naics: '622110', description: 'General Medical and Surgical Hospitals', cyberFactor: 1.6 },
  { naics: '713210', description: 'Casinos (except Casino Hotels)', cyberFactor: 1.5 },
  { naics: '721110', description: 'Hotels and Motels', cyberFactor: 1.15 },
  { naics: '722511', description: 'Full-Service Restaurants', cyberFactor: 1.1 },
  { naics: '921110', description: 'Executive Offices (Public Administration)', cyberFactor: 1.5 },
];

export function industryFor(naics: string): IndustryDef | undefined {
  return INDUSTRIES.find((i) => i.naics === naics);
}

/** Simulated restricted-party (OFAC SDN style) list used by sanctions screening. */
export const SANCTIONS_LIST: { name: string; program: string; country: string }[] = [
  { name: 'Volkov Maritime Trading', program: 'RUSSIA-EO14024', country: 'RU' },
  { name: 'Orinoco Petro Holdings', program: 'VENEZUELA-EO13850', country: 'VE' },
  { name: 'Golden Crescent Exchange', program: 'SDGT', country: 'AE' },
  { name: 'Pyongyang Unified Industries', program: 'DPRK3', country: 'KP' },
  { name: 'Lazarus Digital Assets', program: 'CYBER2', country: 'KP' },
  { name: 'Tehran Polymer Industries', program: 'IRAN', country: 'IR' },
];

export const ENTITY_TYPES = ['Corporation', 'LLC', 'Partnership', 'Sole Proprietor', 'Non-Profit', 'Public Entity'];

export const SUBMISSION_SOURCES = ['Broker Email', 'Broker Portal', 'ACORD Upload', 'Phone', 'API'];

/** Litigation environment by state (casualty severity). */
export const LITIGATION_ENVIRONMENT: Record<string, 'Severe' | 'Elevated' | 'Moderate'> = {
  CA: 'Severe', NY: 'Severe', IL: 'Severe', FL: 'Severe', PA: 'Elevated', GA: 'Elevated',
  LA: 'Severe', TX: 'Elevated', NJ: 'Elevated', MO: 'Elevated', SC: 'Elevated', NV: 'Elevated',
};
