import type { Job } from '@/lib/cms/sanity';

/**
 * Display labels for the Sanity "job" type's option values (kitabuyetu-studio
 * schemaTypes/job.ts). Plain module, not the client listing, so server pages
 * can import it as values rather than client references.
 */
export const DEPARTMENT_LABEL: Record<string, string> = {
  'product-and-engineering': 'Product and engineering',
  'community-and-operations': 'Community and operations',
  partnerships: 'Partnerships',
  'customer-experience': 'Customer experience',
  marketing: 'Marketing',
};

export const EMPLOYMENT_LABEL: Record<Job['employmentType'], string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

export function departmentLabel(department: string): string {
  return DEPARTMENT_LABEL[department] ?? department;
}

export function employmentLabel(type: string): string {
  return EMPLOYMENT_LABEL[type as Job['employmentType']] ?? type;
}
