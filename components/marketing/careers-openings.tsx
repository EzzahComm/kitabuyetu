'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { IconArrowUpRight } from '@tabler/icons-react';
import type { Job } from '@/lib/cms/sanity';

const DEPARTMENT_LABEL: Record<string, string> = {
  'product-and-engineering': 'Product and engineering',
  'community-and-operations': 'Community and operations',
  partnerships: 'Partnerships',
  'customer-experience': 'Customer experience',
};

const EMPLOYMENT_LABEL: Record<Job['employmentType'], string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

/**
 * Filters client-side rather than via searchParams round-trips — careers
 * listings are small (a handful of roles at most), so instant filtering
 * reads better here than a page navigation per keystroke/select change.
 */
export function CareersOpenings({ jobs }: { jobs: Job[] }) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [location, setLocation] = useState('all');

  const departments = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.department))),
    [jobs],
  );
  const locations = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.location))),
    [jobs],
  );

  const filtered = jobs.filter((job) => {
    const matchesSearch = search.trim().length === 0
      || job.title.toLowerCase().includes(search.trim().toLowerCase());
    const matchesDepartment = department === 'all' || job.department === department;
    const matchesLocation = location === 'all' || job.location === location;
    return matchesSearch && matchesDepartment && matchesLocation;
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-trueGray-700 dark:bg-trueGray-900">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Search jobs
          <input
            aria-label="Search jobs"
            type="search"
            placeholder="Search roles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-2 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-trueGray-600"
          />
        </label>
        <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Department
          <select
            aria-label="Filter by department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="mt-2 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-trueGray-600"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{DEPARTMENT_LABEL[d] ?? d}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Location
          <select
            aria-label="Filter by location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="mt-2 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-trueGray-600"
          >
            <option value="all">All locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length > 0 ? (
        <ul className="mt-8 divide-y divide-gray-200 border-t border-gray-200 dark:divide-trueGray-700 dark:border-trueGray-700">
          {filtered.map((job) => (
            <li key={job.slug}>
              <Link
                href={`/careers/${job.slug}`}
                className="group flex flex-col gap-1 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <span className="block text-base font-bold text-gray-800 group-hover:text-indigo-600 dark:text-white">
                    {job.title}
                  </span>
                  <span className="mt-1 block text-sm text-gray-500 dark:text-gray-300">
                    {DEPARTMENT_LABEL[job.department] ?? job.department} · {job.location} ·{' '}
                    {EMPLOYMENT_LABEL[job.employmentType]}
                  </span>
                </span>
                <IconArrowUpRight
                  aria-hidden="true"
                  className="mt-2 h-5 w-5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-indigo-600 sm:mt-0"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8 border-t border-gray-200 pt-8 text-center dark:border-trueGray-700">
          <h3 className="text-xl font-bold text-gray-800 dark:text-white">
            {jobs.length === 0 ? 'No open roles right now' : 'No roles match these filters'}
          </h3>
          <p className="mx-auto mt-3 max-w-md leading-7 text-gray-500 dark:text-gray-300">
            {jobs.length === 0
              ? 'We do not have a published vacancy today. We would still like to hear from people who understand this work.'
              : 'Try a different search, department or location.'}
          </p>
          {jobs.length === 0 && (
            <a
              href="mailto:careers@kitabuyetu.co.ke"
              className="mt-5 inline-flex items-center gap-2 font-semibold text-indigo-600 hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Introduce yourself <IconArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
