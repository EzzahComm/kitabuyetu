import type { FuzzyDate, DatePrecision } from '../types/index';

export function parseFuzzyDate(input: string): FuzzyDate | null {
  // Handle ISO date formats
  const isoMatch = input.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (isoMatch) {
    return {
      year: parseInt(isoMatch[1], 10),
      month: isoMatch[2] ? parseInt(isoMatch[2], 10) : undefined,
      day: isoMatch[3] ? parseInt(isoMatch[3], 10) : undefined,
      precision: isoMatch[3] ? 'day' : isoMatch[2] ? 'month' : 'year',
    };
  }

  // Handle "about YYYY" format
  const aboutMatch = input.match(/^about\s+(\d{4})$/);
  if (aboutMatch) {
    return { year: parseInt(aboutMatch[1], 10), precision: 'year' };
  }

  // Handle "Month YYYY" format
  const monthMatch = input.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i);
  if (monthMatch) {
    const months: Record<string, number> = {
      january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
      july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    };
    return { year: parseInt(monthMatch[2], 10), month: months[monthMatch[1].toLowerCase()], precision: 'month' };
  }

  return null;
}

export function validateFuzzyDate(fd: FuzzyDate): boolean {
  if (fd.year < 1800 || fd.year > new Date().getFullYear()) return false;
  if (fd.month && (fd.month < 1 || fd.month > 12)) return false;
  if (fd.day && (fd.day < 1 || fd.day > 31)) return false;
  if (fd.precision === 'month' && !fd.month) return false;
  if (fd.precision === 'day' && (!fd.month || !fd.day)) return false;
  return true;
}

export function formatFuzzyDate(fd: FuzzyDate, locale: 'en' | 'sw' = 'en'): string {
  if (fd.precision === 'year') return fd.year.toString();
  if (fd.precision === 'month') {
    const monthNames = locale === 'sw'
      ? ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[fd.month! - 1]} ${fd.year}`;
  }
  return `${fd.day}/${fd.month}/${fd.year}`;
}

export function fuzzyDateToRange(fd: FuzzyDate): { start: Date; end: Date } {
  if (fd.precision === 'year') {
    return {
      start: new Date(fd.year, 0, 1),
      end: new Date(fd.year, 11, 31),
    };
  }
  if (fd.precision === 'month') {
    return {
      start: new Date(fd.year, fd.month! - 1, 1),
      end: new Date(fd.year, fd.month!, 0),
    };
  }
  const d = new Date(fd.year, fd.month! - 1, fd.day);
  return { start: d, end: d };
}
