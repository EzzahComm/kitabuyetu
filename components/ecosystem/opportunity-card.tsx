'use client';

import Link from 'next/link';
import { Opportunity } from '@/lib/services/ecosystem.service';

interface OpportunityCardProps {
  opportunity: Opportunity;
  matches?: boolean;
  failedRules?: string[];
}

export function OpportunityCard({ opportunity, matches = true, failedRules = [] }: OpportunityCardProps) {
  const typeColors: Record<string, string> = {
    grant: 'bg-green-100 text-green-800',
    loan: 'bg-blue-100 text-blue-800',
    insurance: 'bg-purple-100 text-purple-800',
    training: 'bg-yellow-100 text-yellow-800',
    service: 'bg-gray-100 text-gray-800',
  };

  const amountDisplay = opportunity.amount_min && opportunity.amount_max
    ? `${opportunity.currency} ${opportunity.amount_min.toLocaleString()}-${opportunity.amount_max.toLocaleString()}`
    : opportunity.amount_min
      ? `From ${opportunity.currency} ${opportunity.amount_min.toLocaleString()}`
      : 'Variable amount';

  return (
    <Link href={`/ecosystem/opportunities/${opportunity.id}`}>
      <div className="rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{opportunity.title}</h3>
            <p className="text-sm text-gray-600 mt-1">{opportunity.category}</p>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${typeColors[opportunity.opportunity_type]}`}>
            {opportunity.opportunity_type}
          </span>
        </div>

        <p className="text-sm text-gray-600 line-clamp-2 mb-4">{opportunity.description}</p>

        <div className="mb-4">
          <p className="text-sm font-semibold text-gray-900">{amountDisplay}</p>
          {opportunity.terms_summary && (
            <p className="text-xs text-gray-500 mt-1">{opportunity.terms_summary}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {new Date(opportunity.created_at).toLocaleDateString()}
          </span>
          {matches !== undefined && (
            <span className={`text-xs font-semibold ${matches ? 'text-green-600' : 'text-orange-600'}`}>
              {matches ? '✓ You match' : '✗ Check requirements'}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
