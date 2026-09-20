import React from 'react';
import {
  IconUsers,
  IconBuildingBank,
  IconHeartHandshake,
  IconChartInfographic,
  IconBuildingCommunity,
  IconWorld,
} from '@tabler/icons-react';
import { Container } from '@/components/Container';

interface Audience {
  name: string;
  desc: string;
  icon: React.ReactNode;
}

/**
 * The real organization types this platform already serves — matches
 * groups.type (migration 001/154: chama, sacco, welfare, investment,
 * ngo_group, self_help_group, cbo, society, cooperative, faith_based,
 * other), grouped into plain-language categories rather than listing the
 * raw enum. Not a sales pitch to a category we don't actually support.
 */
const audiences: Audience[] = [
  {
    name: 'Chamas & VSLAs',
    desc: 'Table banking and village savings and loan groups that meet, contribute and lend to members on a shared cycle.',
    icon: <IconUsers size={26} />,
  },
  {
    name: 'SACCOs & cooperatives',
    desc: 'Member-owned savings and credit cooperatives that need a real ledger, not a notebook.',
    icon: <IconBuildingBank size={26} />,
  },
  {
    name: 'Welfare & self-help groups',
    desc: 'Groups organized around mutual support — funeral funds, medical welfare, and community self-help.',
    icon: <IconHeartHandshake size={26} />,
  },
  {
    name: 'Investment groups',
    desc: 'Groups pooling capital into shares, farms, rentals, shops and other income-generating activities.',
    icon: <IconChartInfographic size={26} />,
  },
  {
    name: 'CBOs & community associations',
    desc: 'Community-based organizations and associations managing member records and shared funds.',
    icon: <IconBuildingCommunity size={26} />,
  },
  {
    name: 'NGOs & organizations',
    desc: 'Organizations that support, fund or supervise multiple groups and need visibility across all of them.',
    icon: <IconWorld size={26} />,
  },
];

export const WhoItsFor = () => {
  return (
    <Container className="mb-20">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {audiences.map((audience) => (
          <div
            key={audience.name}
            className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-6 dark:border-trueGray-700 dark:bg-trueGray-800"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-trueGray-700 dark:text-brand-300">
              {audience.icon}
            </div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{audience.name}</h3>
            <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{audience.desc}</p>
          </div>
        ))}
      </div>
    </Container>
  );
};

export default WhoItsFor;
