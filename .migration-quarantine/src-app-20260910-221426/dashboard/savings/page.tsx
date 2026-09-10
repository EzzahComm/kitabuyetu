"use client";

import { useState } from "react";
import { IconTrendingUp, IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  PageHeader,
  KPICard,
  DataTable,
} from "@/components/dashboard";

export default function SavingsPage() {
  // Mock data
  const savingsData = [
    {
      memberName: "John Doe",
      balance: "25,000",
      contributions: "5",
      lastContribution: "2026-09-05",
      interestEarned: "1,250",
    },
    {
      memberName: "Jane Smith",
      balance: "18,500",
      contributions: "4",
      lastContribution: "2026-09-05",
      interestEarned: "925",
    },
    {
      memberName: "Peter Johnson",
      balance: "22,000",
      contributions: "5",
      lastContribution: "2026-09-04",
      interestEarned: "1,100",
    },
    {
      memberName: "David Brown",
      balance: "30,000",
      contributions: "6",
      lastContribution: "2026-09-03",
      interestEarned: "1,500",
    },
    {
      memberName: "Mary Williams",
      balance: "15,000",
      contributions: "3",
      lastContribution: "2026-08-25",
      interestEarned: "750",
    },
  ];

  const totalSavings = savingsData.reduce(
    (sum, item) => sum + parseInt(item.balance.replace(/,/g, "")),
    0
  );
  const averageSavings = Math.round(totalSavings / savingsData.length);
  const totalInterest = savingsData.reduce(
    (sum, item) => sum + parseInt(item.interestEarned.replace(/,/g, "")),
    0
  );

  const columns = [
    {
      key: "memberName",
      header: "Member Name",
      className: "font-medium",
    },
    {
      key: "balance",
      header: "Current Balance (KES)",
      className: "text-right",
    },
    {
      key: "contributions",
      header: "Contributions",
      className: "text-center",
    },
    {
      key: "lastContribution",
      header: "Last Contribution",
    },
    {
      key: "interestEarned",
      header: "Interest Earned (KES)",
      className: "text-right",
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        title="Savings"
        description="Manage group savings and member accounts"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <KPICard
          title="Total Group Savings"
          value={(totalSavings / 1000).toFixed(0)}
          unit="K KES"
          color="primary"
          icon={<IconTrendingUp size={24} className="text-primary-600 dark:text-primary-400" />}
          trend={{ value: 8, direction: "up" }}
        />
        <KPICard
          title="Average Per Member"
          value={averageSavings.toLocaleString()}
          unit="KES"
          color="success"
        />
        <KPICard
          title="Interest Distributed"
          value={(totalInterest / 1000).toFixed(1)}
          unit="K KES"
          color="slate"
        />
      </div>

      {/* Info Card */}
      <Card className="mb-8 bg-info-50 dark:bg-info-900/20 border-info-200 dark:border-info-800">
        <Card.Content>
          <p className="text-sm text-info-800 dark:text-info-300">
            <strong>Interest Rate:</strong> 5% per annum, calculated monthly and distributed quarterly.
          </p>
        </Card.Content>
      </Card>

      {/* Savings Table */}
      <Card>
        <Card.Header>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Member Savings Accounts
            </h2>
            <Button variant="primary" size="md" className="flex items-center gap-2">
              <IconPlus size={18} />
              Add Savings
            </Button>
          </div>
        </Card.Header>
        <Card.Content>
          <DataTable columns={columns} data={savingsData} />
        </Card.Content>
      </Card>

      {/* Summary Card */}
      <Card className="mt-8">
        <Card.Header>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Savings Summary
          </h3>
        </Card.Header>
        <Card.Content>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                Total Accounts
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {savingsData.length}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                Highest Balance
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                30K
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                Lowest Balance
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                15K
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                Total Interest YTD
              </p>
              <p className="text-2xl font-bold text-success-600 dark:text-success-400">
                {(totalInterest / 1000).toFixed(1)}K
              </p>
            </div>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}
