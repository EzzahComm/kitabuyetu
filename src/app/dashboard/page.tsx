"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconUsers,
  IconCoin,
  IconPigMoney,
  IconBriefcase,
  IconArrowRight,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  PageHeader,
  KPICard,
  StatCard,
  DataTable,
} from "@/components/dashboard";
import { RecordContributionModal, type ContributionFormData } from "@/components/dashboard/modals";

export default function DashboardPage() {
  const [isContributionModalOpen, setIsContributionModalOpen] = useState(false);

  const handleRecordContribution = (data: ContributionFormData) => {
    console.log("Recording contribution:", data);
    alert(`Contribution of KES ${data.amount} recorded for ${data.memberId}!`);
  };
  // Mock data
  const kpis = [
    {
      title: "Total Members",
      value: 45,
      icon: <IconUsers size={24} className="text-primary-600 dark:text-primary-400" />,
      color: "primary" as const,
      trend: { value: 12, direction: "up" as const },
    },
    {
      title: "Total Savings",
      value: "250K",
      unit: "KES",
      icon: <IconPigMoney size={24} className="text-success-600 dark:text-success-400" />,
      color: "success" as const,
      trend: { value: 8, direction: "up" as const },
    },
    {
      title: "Active Loans",
      value: 12,
      icon: <IconBriefcase size={24} className="text-warning-600 dark:text-warning-400" />,
      color: "warning" as const,
    },
    {
      title: "This Month Contributions",
      value: "48K",
      unit: "KES",
      icon: <IconCoin size={24} className="text-slate-600 dark:text-slate-400" />,
      color: "slate" as const,
    },
  ];

  const recentContributions = [
    {
      name: "John Doe",
      amount: "5,000",
      date: "2026-09-05",
      status: "Completed",
    },
    {
      name: "Jane Smith",
      amount: "5,000",
      date: "2026-09-05",
      status: "Completed",
    },
    {
      name: "Peter Johnson",
      amount: "5,000",
      date: "2026-09-04",
      status: "Completed",
    },
    {
      name: "Mary Williams",
      amount: "3,500",
      date: "2026-09-04",
      status: "Pending",
    },
  ];

  const contributionColumns = [
    { key: "name", header: "Member Name" },
    { key: "amount", header: "Amount (KES)" },
    { key: "date", header: "Date" },
    {
      key: "status",
      header: "Status",
      render: (status: string) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            status === "Completed"
              ? "bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-300"
              : "bg-warning-100 dark:bg-warning-900/30 text-warning-800 dark:text-warning-300"
          }`}
        >
          {status}
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* Record Contribution Modal */}
      <RecordContributionModal
        isOpen={isContributionModalOpen}
        onClose={() => setIsContributionModalOpen(false)}
        onSubmit={handleRecordContribution}
      />

      {/* Page Header */}
      <PageHeader
        title="Dashboard"
        description="Overview of your group's finances and activities"
        actions={
          <div className="flex gap-2">
            <Link href="/dashboard/members">
              <Button variant="outline" size="md">
                View Members
              </Button>
            </Link>
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsContributionModalOpen(true)}
            >
              + Record Contribution
            </Button>
          </div>
        }
      />

      <div className="mb-8 flex items-start gap-3 border-l-4 border-warning-500 bg-warning-50 px-4 py-3 text-sm text-warning-800 dark:bg-warning-900/20 dark:text-warning-200" role="status">
        <IconAlertTriangle size={20} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p><span className="font-bold">Demo workspace:</span> these figures illustrate the dashboard experience. Connect your organization to load live group data.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {kpis.map((kpi) => (
          <KPICard
            key={kpi.title}
            title={kpi.title}
            value={kpi.value}
            unit={kpi.unit}
            icon={kpi.icon}
            color={kpi.color}
            trend={kpi.trend}
          />
        ))}
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card variant="outlined" className="border-warning-200 bg-warning-50 dark:border-warning-800 dark:bg-warning-900/20">
          <Card.Header>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Needs attention</h2>
          </Card.Header>
          <Card.Content className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
            <p className="flex items-center justify-between gap-4"><span>1 contribution is pending reconciliation</span><IconArrowRight size={16} aria-hidden="true" /></p>
            <p className="flex items-center justify-between gap-4"><span>3 loan applications need review</span><IconArrowRight size={16} aria-hidden="true" /></p>
            <p className="flex items-center justify-between gap-4"><span>Monthly report is ready to generate</span><IconArrowRight size={16} aria-hidden="true" /></p>
          </Card.Content>
        </Card>
        <Card variant="outlined" className="border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-900/20">
          <Card.Header>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recommended next steps</h2>
          </Card.Header>
          <Card.Content className="grid gap-2 sm:grid-cols-2">
            <Link href="/dashboard/members" className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-100 dark:bg-slate-800 dark:text-primary-300 dark:hover:bg-primary-900/30">Add your members</Link>
            <Link href="/dashboard/contributions" className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-100 dark:bg-slate-800 dark:text-primary-300 dark:hover:bg-primary-900/30">Record a contribution</Link>
            <Link href="/dashboard/finance/reports" className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-100 dark:bg-slate-800 dark:text-primary-300 dark:hover:bg-primary-900/30">Create a report</Link>
          </Card.Content>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Recent Activity */}
        <div className="lg:col-span-2">
          <Card>
            <Card.Header>
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Recent Contributions
                </h2>
                <Link
                  href="/dashboard/contributions"
                  className="text-primary-600 dark:text-primary-400 hover:underline text-sm font-medium flex items-center gap-2"
                >
                  View All
                  <IconArrowRight size={16} />
                </Link>
              </div>
            </Card.Header>
            <Card.Content>
              <DataTable columns={contributionColumns} data={recentContributions} />
            </Card.Content>
          </Card>
        </div>

        {/* Right: Sidebar Stats */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <Card>
            <Card.Header>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                At a Glance
              </h3>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                  Loan Default Rate
                </p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  2.3%
                </p>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                  Avg Savings/Member
                </p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  5.6K
                </p>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                  Meeting Attendance
                </p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  93%
                </p>
              </div>
            </Card.Content>
          </Card>

          {/* Quick Actions */}
          <Card>
            <Card.Header>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Quick Actions
              </h3>
            </Card.Header>
            <Card.Content className="space-y-2">
              <Link href="/dashboard/members">
                <Button variant="ghost" className="w-full justify-start text-left" size="md">
                  + Add Member
                </Button>
              </Link>
              <Link href="/dashboard/loans">
                <Button variant="ghost" className="w-full justify-start text-left" size="md">
                  + New Loan
                </Button>
              </Link>
              <Link href="/dashboard/finance/reports">
                <Button variant="ghost" className="w-full justify-start text-left" size="md">
                  Generate Report
                </Button>
              </Link>
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
}
