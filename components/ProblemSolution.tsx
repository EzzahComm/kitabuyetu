import React from 'react';
import { IconX, IconCheck } from '@tabler/icons-react';
import { Container } from '@/components/Container';

const from = [
  'Notebooks that only one person can read',
  'Spreadsheets nobody trusts after a meeting argument',
  "M-Pesa messages scattered across officials' phones",
  'Manual calculations redone at every meeting',
  'Reports that take days to put together',
  'Balances members have to take on faith',
];

const to = [
  'One organized digital record everyone in office can see',
  'Transparent finances the whole group can trust',
  'Payments matched to members automatically',
  'Calculations the system does for you',
  'Reports ready in minutes, not days',
  'Balances every member can check for themselves',
];

/**
 * The transformation Kitabu Yetu sells — the from/to pairs are intentionally
 * matched 1:1 by index so the two columns read as a direct correction, not a
 * loose list of unrelated features.
 */
export const ProblemSolution = () => {
  return (
    <Container className="mb-20">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 dark:border-trueGray-700 dark:bg-trueGray-800">
          <p className="text-sm font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Today</p>
          <ul className="mt-5 space-y-4">
            {from.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <IconX size={18} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
                <span className="text-gray-600 dark:text-gray-300">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-brand-200 bg-brand-50 p-8 dark:border-brand-800 dark:bg-trueGray-800">
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">
            With Kitabu Yetu
          </p>
          <ul className="mt-5 space-y-4">
            {to.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <IconCheck
                  size={18}
                  className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400"
                  aria-hidden="true"
                />
                <span className="font-medium text-gray-800 dark:text-gray-100">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Container>
  );
};

export default ProblemSolution;
