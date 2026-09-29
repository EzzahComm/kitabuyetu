'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Briefcase, Clock, MapPin } from 'lucide-react';
import type { Job } from '@/lib/cms/sanity';
import { departmentLabel, employmentLabel } from './careers-labels';
import { CONTACT } from './routes';

const fieldClass =
  'mt-2 w-full rounded-lg border border-brand-100 bg-white px-4 py-3 font-normal text-finanza-dark outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

/**
 * Filters client-side rather than via searchParams round-trips — careers
 * listings are small (a handful of roles at most), so instant filtering
 * reads better here than a page navigation per keystroke/select change.
 */
export function CareersOpenings({ jobs }: { jobs: Job[] }) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [location, setLocation] = useState('all');

  const departments = useMemo(() => Array.from(new Set(jobs.map((j) => j.department))), [jobs]);
  const locations = useMemo(() => Array.from(new Set(jobs.map((j) => j.location))), [jobs]);

  const filtered = jobs.filter((job) => {
    const matchesSearch = search.trim().length === 0 || job.title.toLowerCase().includes(search.trim().toLowerCase());
    const matchesDepartment = department === 'all' || job.department === department;
    const matchesLocation = location === 'all' || job.location === location;
    return matchesSearch && matchesDepartment && matchesLocation;
  });

  return (
    <div className="rounded-lg border border-brand-100 bg-white p-6 sm:p-8">
      {/* Filters only earn their space once there is more than one role to narrow down. */}
      {jobs.length > 1 && (
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium text-finanza-dark">
            Search roles
            <input
              type="search"
              placeholder="e.g. engineer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="text-sm font-medium text-finanza-dark">
            Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className={fieldClass}>
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {departmentLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-finanza-dark">
            Location
            <select value={location} onChange={(e) => setLocation(e.target.value)} className={fieldClass}>
              <option value="all">All locations</option>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {filtered.length > 0 ? (
        <ul className="space-y-4">
          {filtered.map((job) => (
            <li key={job.slug}>
              <Link
                href={`/careers/${job.slug}`}
                className="group flex flex-col gap-4 rounded-lg border border-brand-100 p-5 transition-colors duration-500 hover:border-brand-500 hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <span className="block font-display text-xl font-semibold text-finanza-dark transition-colors duration-500 group-hover:text-white">
                    {job.title}
                  </span>
                  {job.summary && (
                    <span className="mt-1 line-clamp-2 block text-finanza-text transition-colors duration-500 group-hover:text-white/90">
                      {job.summary}
                    </span>
                  )}
                  <span className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-finanza-text transition-colors duration-500 group-hover:text-white/90">
                    <span className="inline-flex items-center gap-1.5">
                      <Briefcase aria-hidden="true" className="h-4 w-4" />
                      {departmentLabel(job.department)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin aria-hidden="true" className="h-4 w-4" />
                      {job.location}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock aria-hidden="true" className="h-4 w-4" />
                      {employmentLabel(job.employmentType)}
                    </span>
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-brand-500 transition-colors duration-500 group-hover:text-white">
                  View role <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-6 text-center">
          <h3 className="font-display text-2xl font-semibold text-finanza-dark">
            {jobs.length === 0 ? 'No open roles right now' : 'No roles match these filters'}
          </h3>
          <p className="mx-auto mt-3 max-w-md leading-relaxed text-finanza-text">
            {jobs.length === 0
              ? 'We do not have a published vacancy today. We would still like to hear from people who understand this work.'
              : 'Try a different search, department or location.'}
          </p>
          {jobs.length === 0 && (
            <a
              href={`mailto:${CONTACT.careersEmail}`}
              className="mt-5 inline-flex items-center gap-1.5 font-medium text-brand-500 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Introduce yourself <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
