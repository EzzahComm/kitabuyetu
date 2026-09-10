"use client";

import { useState } from "react";
import { IconPlus, IconTrendingDown, IconAlertCircle, IconEdit, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  PageHeader,
  KPICard,
  AdvancedDataTable,
  EmptyState,
  DeleteConfirmationDialog,
} from "@/components/dashboard";
import { EditLoanModal, type LoanFormData } from "@/components/dashboard/modals/EditLoanModal";

export default function LoansPage() {
  const [activeTab, setActiveTab] = useState<"active" | "pending" | "defaulted">(
    "active"
  );
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<any>(null);

  // Mock data
  const allLoans = [
    {
      id: "L001",
      memberName: "John Doe",
      amount: "50,000",
      issueDate: "2026-06-15",
      dueDate: "2026-09-15",
      balance: "35,000",
      interestRate: "12%",
      status: "Active",
    },
    {
      id: "L002",
      memberName: "Jane Smith",
      amount: "75,000",
      issueDate: "2026-05-20",
      dueDate: "2026-08-20",
      balance: "45,000",
      interestRate: "12%",
      status: "Active",
    },
    {
      id: "L003",
      memberName: "Peter Johnson",
      amount: "40,000",
      issueDate: "2026-08-01",
      dueDate: "2026-11-01",
      balance: "40,000",
      interestRate: "12%",
      status: "Pending",
    },
    {
      id: "L004",
      memberName: "David Brown",
      amount: "100,000",
      issueDate: "2026-04-10",
      dueDate: "2026-07-10",
      balance: "25,000",
      interestRate: "12%",
      status: "Defaulted",
    },
  ];

  const filteredLoans = allLoans.filter((loan) => {
    if (activeTab === "active") return loan.status === "Active";
    if (activeTab === "pending") return loan.status === "Pending";
    if (activeTab === "defaulted") return loan.status === "Defaulted";
    return true;
  });

  const totalLoaned = allLoans.reduce(
    (sum, loan) => sum + parseInt(loan.amount.replace(/,/g, "")),
    0
  );
  const totalOutstanding = allLoans.reduce(
    (sum, loan) => sum + parseInt(loan.balance.replace(/,/g, "")),
    0
  );
  const defaultRate = (
    (allLoans.filter((l) => l.status === "Defaulted").length /
      allLoans.length) *
    100
  ).toFixed(1);

  const handleEditLoan = (loanData: LoanFormData) => {
    console.log("Updating loan:", loanData);
    alert(`Loan updated for ${loanData.memberName}!`);
    setIsEditModalOpen(false);
  };

  const handleDeleteLoan = () => {
    console.log("Deleting loan:", selectedLoan.id);
    alert(`Loan ${selectedLoan.id} deleted!`);
    setIsDeleteDialogOpen(false);
  };

  const columns = [
    { key: "memberName", header: "Member Name", className: "font-medium", sortable: true },
    { key: "amount", header: "Original Amount (KES)", className: "text-right", sortable: true },
    { key: "balance", header: "Outstanding (KES)", className: "text-right", sortable: true },
    {
      key: "interestRate",
      header: "Rate",
      className: "text-center",
    },
    {
      key: "dueDate",
      header: "Due Date",
      sortable: true,
    },
    {
      key: "status",
      header: "Status",
      render: (status: string) => (
        <Badge
          variant={
            status === "Active"
              ? "primary"
              : status === "Pending"
                ? "warning"
                : "error"
          }
          size="sm"
        >
          {status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (_value: unknown, row: any) => (
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSelectedLoan(row);
              setIsEditModalOpen(true);
            }}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-600 dark:text-gray-400"
            aria-label="Edit"
          >
            <IconEdit size={18} />
          </button>
          <button
            onClick={() => {
              setSelectedLoan(row);
              setIsDeleteDialogOpen(true);
            }}
            className="p-1.5 hover:bg-error-100 dark:hover:bg-error-900/30 rounded transition-colors text-error-600 dark:text-error-400"
            aria-label="Delete"
          >
            <IconTrash size={18} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Modals and Dialogs */}
      <EditLoanModal
        isOpen={isEditModalOpen}
        loanId={selectedLoan?.id}
        initialData={selectedLoan ? {
          memberName: selectedLoan.memberName,
          originalAmount: selectedLoan.amount.replace(/,/g, ""),
          interestRate: selectedLoan.interestRate.replace("%", ""),
          status: selectedLoan.status.toLowerCase(),
          dueDate: selectedLoan.dueDate,
          notes: "",
        } : undefined}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={handleEditLoan}
      />

      <DeleteConfirmationDialog
        isOpen={isDeleteDialogOpen}
        title="Delete Loan"
        message="Are you sure you want to delete this loan? This action cannot be undone."
        itemName={selectedLoan ? `Loan ${selectedLoan.id} - ${selectedLoan.memberName}` : undefined}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteLoan}
      />

      {/* Page Header */}
      <PageHeader
        title="Loans"
        description="Manage group loans and repayments"
        actions={
          <Button variant="primary" size="md" className="flex items-center gap-2">
            <IconPlus size={18} />
            Issue Loan
          </Button>
        }
      />

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <KPICard
          title="Total Loaned"
          value={(totalLoaned / 1000).toFixed(0)}
          unit="K KES"
          color="primary"
        />
        <KPICard
          title="Outstanding"
          value={(totalOutstanding / 1000).toFixed(0)}
          unit="K KES"
          color="warning"
          trend={{ value: 5, direction: "down" }}
        />
        <KPICard
          title="Default Rate"
          value={defaultRate}
          unit="%"
          color={parseFloat(defaultRate) > 5 ? "error" : "success"}
        />
      </div>

      {/* Alerts */}
      {allLoans.some((l) => l.status === "Defaulted") && (
        <Card className="mb-8 border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/20">
          <div className="flex gap-4">
            <IconAlertCircle
              size={24}
              className="flex-shrink-0 text-error-600 dark:text-error-400"
            />
            <div>
              <h3 className="font-semibold text-error-900 dark:text-error-100 mb-1">
                Defaulted Loans Alert
              </h3>
              <p className="text-error-800 dark:text-error-300 text-sm">
                {allLoans.filter((l) => l.status === "Defaulted").length} loan(s)
                are in default. Follow up with members for repayment.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {(["active", "pending", "defaulted"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary-500 text-primary-600 dark:text-primary-400"
                : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            {tab === "active" && `Active (${allLoans.filter((l) => l.status === "Active").length})`}
            {tab === "pending" && `Pending (${allLoans.filter((l) => l.status === "Pending").length})`}
            {tab === "defaulted" && `Defaulted (${allLoans.filter((l) => l.status === "Defaulted").length})`}
          </button>
        ))}
      </div>

      {/* Loans Table */}
      <Card>
        <Card.Content>
          {filteredLoans.length > 0 ? (
            <AdvancedDataTable
              columns={columns}
              data={filteredLoans}
              pageSize={10}
            />
          ) : (
            <EmptyState
              title="No loans in this category"
              description="All loans have been repaid or there are no loans to show."
            />
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
