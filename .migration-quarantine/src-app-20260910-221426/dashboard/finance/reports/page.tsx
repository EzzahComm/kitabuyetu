"use client";

import { useState } from "react";
import { IconDownload, IconEye, IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader, DataTable } from "@/components/dashboard";

export default function ReportsPage() {
  const [selectedMonth, setSelectedMonth] = useState("2026-09");

  // Mock reports data
  const reports = [
    {
      name: "Monthly Financial Summary",
      description: "Complete overview of all transactions, balances, and member activity",
      date: "2026-09-05",
      period: "September 2026",
      type: "Monthly",
      size: "2.4 MB",
      format: "PDF",
    },
    {
      name: "Member Savings Report",
      description: "Individual savings account balances and interest earned",
      date: "2026-09-05",
      period: "September 2026",
      type: "Savings",
      size: "1.8 MB",
      format: "Excel",
    },
    {
      name: "Loan Status Report",
      description: "Active loans, repayments, and defaulted accounts",
      date: "2026-09-05",
      period: "September 2026",
      type: "Loans",
      size: "1.2 MB",
      format: "PDF",
    },
    {
      name: "Cash Flow Analysis",
      description: "Inflows, outflows, and net cash position",
      date: "2026-09-01",
      period: "August 2026",
      type: "Cash Flow",
      size: "0.8 MB",
      format: "PDF",
    },
    {
      name: "Member Activity Report",
      description: "Contributions, withdrawals, and participation metrics",
      date: "2026-09-01",
      period: "August 2026",
      type: "Activity",
      size: "1.5 MB",
      format: "Excel",
    },
  ];

  const columns = [
    {
      key: "name",
      header: "Report Name",
      className: "font-medium",
    },
    {
      key: "type",
      header: "Type",
      render: (type: string) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-300">
          {type}
        </span>
      ),
    },
    {
      key: "period",
      header: "Period",
    },
    {
      key: "date",
      header: "Generated",
    },
    {
      key: "format",
      header: "Format",
      render: (format: string) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            format === "PDF"
              ? "bg-error-100 dark:bg-error-900/30 text-error-800 dark:text-error-300"
              : "bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-300"
          }`}
        >
          {format}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: () => (
        <div className="flex gap-2">
          <button
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-600 dark:text-gray-400"
            aria-label="View"
          >
            <IconEye size={18} />
          </button>
          <button
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-600 dark:text-gray-400"
            aria-label="Download"
          >
            <IconDownload size={18} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        title="Reports"
        description="Generate and download financial reports"
        actions={
          <Button variant="primary" size="md" className="flex items-center gap-2">
            <IconPlus size={18} />
            Generate Report
          </Button>
        }
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <Card>
          <Card.Content>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Reports This Year
            </p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              24
            </p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Last Generated
            </p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              5 Sep 2026
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Monthly Summary
            </p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Total Storage Used
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              48 MB
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Of 5 GB available
            </p>
          </Card.Content>
        </Card>
      </div>

      {/* Report Templates */}
      <Card className="mb-8">
        <Card.Header>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Quick Generate
          </h2>
        </Card.Header>
        <Card.Content>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              "Monthly Summary",
              "Savings Report",
              "Loan Status",
              "Cash Flow",
            ].map((template) => (
              <button
                key={template}
                className="p-4 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-medium text-gray-900 dark:text-white text-center"
              >
                {template}
              </button>
            ))}
          </div>
        </Card.Content>
      </Card>

      {/* Recent Reports */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Recent Reports
        </h2>
      </div>

      <Card>
        <Card.Content>
          <DataTable columns={columns} data={reports} />
        </Card.Content>
      </Card>
    </div>
  );
}
