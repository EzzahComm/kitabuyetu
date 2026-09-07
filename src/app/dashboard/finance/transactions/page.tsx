"use client";

import { useState } from "react";
import { IconFilter, IconSearch, IconDownload } from "@tabler/icons-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader, DataTable } from "@/components/dashboard";

export default function TransactionsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");

  // Mock data
  const allTransactions = [
    {
      date: "2026-09-05",
      type: "Contribution",
      member: "John Doe",
      description: "Monthly contribution",
      amount: "5,000",
      direction: "in",
      method: "M-Pesa",
      reference: "M123456",
    },
    {
      date: "2026-09-05",
      type: "Loan Disbursement",
      member: "Peter Johnson",
      description: "Loan L003 issued",
      amount: "40,000",
      direction: "out",
      method: "Bank Transfer",
      reference: "L003",
    },
    {
      date: "2026-09-04",
      type: "Loan Repayment",
      member: "Jane Smith",
      description: "Loan L002 repayment",
      amount: "15,000",
      direction: "in",
      method: "M-Pesa",
      reference: "R002-1",
    },
    {
      date: "2026-09-04",
      type: "Interest Distribution",
      member: "System",
      description: "Monthly interest distribution",
      amount: "5,250",
      direction: "out",
      method: "System",
      reference: "INT-2026-09",
    },
    {
      date: "2026-09-03",
      type: "Contribution",
      member: "Mary Williams",
      description: "Monthly contribution",
      amount: "3,500",
      direction: "in",
      method: "Cash",
      reference: "CASH-001",
    },
  ];

  const filteredTransactions = allTransactions.filter((tx) => {
    const matchesSearch =
      tx.member.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter =
      filterType === "all" ||
      (filterType === "in" && tx.direction === "in") ||
      (filterType === "out" && tx.direction === "out");
    return matchesSearch && matchesFilter;
  });

  const totalIn = allTransactions
    .filter((tx) => tx.direction === "in")
    .reduce((sum, tx) => sum + parseInt(tx.amount.replace(/,/g, "")), 0);
  const totalOut = allTransactions
    .filter((tx) => tx.direction === "out")
    .reduce((sum, tx) => sum + parseInt(tx.amount.replace(/,/g, "")), 0);

  const columns = [
    { key: "date", header: "Date", className: "font-medium" },
    { key: "type", header: "Type" },
    { key: "member", header: "Member/Recipient" },
    { key: "description", header: "Description" },
    {
      key: "amount",
      header: "Amount (KES)",
      className: "text-right font-semibold",
      render: (amount: string, row: any) => (
        <span
          className={
            row.direction === "in"
              ? "text-success-600 dark:text-success-400"
              : "text-error-600 dark:text-error-400"
          }
        >
          {row.direction === "in" ? "+" : "-"} {amount}
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        title="Transactions"
        description="View all group financial transactions"
        actions={
          <Button variant="outline" size="md" className="flex items-center gap-2">
            <IconDownload size={18} />
            Export
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <Card>
          <Card.Content>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Inflows
            </p>
            <p className="text-2xl font-bold text-success-600 dark:text-success-400">
              +{(totalIn / 1000).toFixed(1)}K
            </p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Outflows
            </p>
            <p className="text-2xl font-bold text-error-600 dark:text-error-400">
              -{(totalOut / 1000).toFixed(1)}K
            </p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              Net Flow
            </p>
            <p
              className={`text-2xl font-bold ${
                totalIn - totalOut >= 0
                  ? "text-success-600 dark:text-success-400"
                  : "text-error-600 dark:text-error-400"
              }`}
            >
              {((totalIn - totalOut) / 1000).toFixed(1)}K
            </p>
          </Card.Content>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card className="mb-8">
        <Card.Content className="space-y-4">
          <Input
            label=""
            placeholder="Search by member or description..."
            icon={<IconSearch size={18} />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="flex gap-2 flex-wrap">
            {["all", "in", "out"].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  filterType === type
                    ? "bg-primary-500 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {type === "all" && "All Transactions"}
                {type === "in" && "Inflows Only"}
                {type === "out" && "Outflows Only"}
              </button>
            ))}
          </div>
        </Card.Content>
      </Card>

      {/* Transactions Table */}
      <Card>
        <Card.Content>
          <DataTable columns={columns} data={filteredTransactions} />
        </Card.Content>
      </Card>

      {/* Footer */}
      <div className="mt-6 text-sm text-gray-600 dark:text-gray-400 text-center">
        Showing {filteredTransactions.length} of {allTransactions.length} transactions
      </div>
    </div>
  );
}
