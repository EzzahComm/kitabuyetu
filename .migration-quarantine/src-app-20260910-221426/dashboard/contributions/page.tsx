"use client";

import { useState } from "react";
import { IconPlus, IconFilter } from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader, DataTable, StatCard } from "@/components/dashboard";

export default function ContributionsPage() {
  const [selectedMonth, setSelectedMonth] = useState("2026-09");

  // Mock data
  const contributions = [
    {
      date: "2026-09-05",
      memberName: "John Doe",
      amount: "5,000",
      method: "M-Pesa",
      status: "Completed",
    },
    {
      date: "2026-09-05",
      memberName: "Jane Smith",
      amount: "5,000",
      method: "Bank Transfer",
      status: "Completed",
    },
    {
      date: "2026-09-05",
      memberName: "Peter Johnson",
      amount: "5,000",
      method: "M-Pesa",
      status: "Completed",
    },
    {
      date: "2026-09-04",
      memberName: "Mary Williams",
      amount: "3,500",
      method: "Cash",
      status: "Pending",
    },
    {
      date: "2026-09-03",
      memberName: "David Brown",
      amount: "5,000",
      method: "M-Pesa",
      status: "Completed",
    },
  ];

  const columns = [
    { key: "date", header: "Date" },
    { key: "memberName", header: "Member" },
    { key: "amount", header: "Amount (KES)", className: "text-right font-semibold" },
    { key: "method", header: "Payment Method" },
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

  const totalContributions = contributions
    .filter((c) => c.status === "Completed")
    .reduce((sum, c) => sum + parseInt(c.amount.replace(",", "")), 0);

  const averageContribution = Math.round(
    totalContributions / contributions.filter((c) => c.status === "Completed").length
  );

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        title="Contributions"
        description="Track all member contributions to the group"
        actions={
          <Button variant="primary" size="md" className="flex items-center gap-2">
            <IconPlus size={18} />
            Record Contribution
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Total Contributions"
          value={`${(totalContributions / 1000).toFixed(1)}K`}
          description="This month (completed)"
        />
        <StatCard
          title="Average Per Member"
          value={`${averageContribution.toLocaleString()}`}
          description="KES this month"
        />
        <StatCard
          title="Members Contributed"
          value={contributions.filter((c) => c.status === "Completed").length}
          description="Out of 45 members"
        />
      </div>

      {/* Filters */}
      <Card className="mb-8">
        <Card.Content className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Filter by Month
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" size="md" className="flex items-center gap-2">
              <IconFilter size={18} />
              More Filters
            </Button>
          </div>
        </Card.Content>
      </Card>

      {/* Contributions Table */}
      <Card>
        <Card.Content>
          <DataTable columns={columns} data={contributions} />
        </Card.Content>
      </Card>
    </div>
  );
}
