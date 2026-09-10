"use client";

import { useState } from "react";
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconSearch,
  IconDownload,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { PageHeader, DataTable } from "@/components/dashboard";
import { AddMemberModal, type MemberFormData } from "@/components/dashboard/modals/AddMemberModal";

export default function MembersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Mock data
  const allMembers = [
    {
      id: 1,
      name: "John Doe",
      email: "john@example.com",
      phone: "+254712345678",
      joinDate: "2026-01-15",
      status: "Active",
      savings: "25,000",
    },
    {
      id: 2,
      name: "Jane Smith",
      email: "jane@example.com",
      phone: "+254723456789",
      joinDate: "2026-02-20",
      status: "Active",
      savings: "18,500",
    },
    {
      id: 3,
      name: "Peter Johnson",
      email: "peter@example.com",
      phone: "+254734567890",
      joinDate: "2026-03-10",
      status: "Active",
      savings: "22,000",
    },
    {
      id: 4,
      name: "Mary Williams",
      email: "mary@example.com",
      phone: "+254745678901",
      joinDate: "2026-04-05",
      status: "Inactive",
      savings: "15,000",
    },
    {
      id: 5,
      name: "David Brown",
      email: "david@example.com",
      phone: "+254756789012",
      joinDate: "2026-05-12",
      status: "Active",
      savings: "30,000",
    },
  ];

  // Filter members based on search
  const filteredMembers = allMembers.filter(
    (member) =>
      member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddMember = (data: MemberFormData) => {
    console.log("Adding member:", data);
    // TODO: Call API to add member
    alert(`Member ${data.firstName} ${data.lastName} added successfully!`);
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      className: "font-medium",
    },
    {
      key: "email",
      header: "Email",
    },
    {
      key: "phone",
      header: "Phone",
    },
    {
      key: "joinDate",
      header: "Joined",
    },
    {
      key: "savings",
      header: "Savings (KES)",
      className: "text-right",
    },
    {
      key: "status",
      header: "Status",
      render: (status: string) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            status === "Active"
              ? "bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-300"
              : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300"
          }`}
        >
          {status}
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
            aria-label="Edit"
          >
            <IconEdit size={18} />
          </button>
          <button
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
      {/* Add Member Modal */}
      <AddMemberModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddMember}
      />

      {/* Page Header */}
      <PageHeader
        title="Members"
        description="Manage group members and their information"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="md" className="flex items-center gap-2">
              <IconDownload size={18} />
              Export
            </Button>
            <Button
              variant="primary"
              size="md"
              className="flex items-center gap-2"
              onClick={() => setIsAddModalOpen(true)}
            >
              <IconPlus size={18} />
              Add Member
            </Button>
          </div>
        }
      />

      {/* Search and Stats */}
      <div className="mb-8 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <Input
            label=""
            placeholder="Search by name or email..."
            icon={<IconSearch size={18} />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Members</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {allMembers.length}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">Active</p>
            <p className="text-2xl font-bold text-success-600 dark:text-success-400">
              {allMembers.filter((m) => m.status === "Active").length}
            </p>
          </div>
        </div>
      </div>

      {/* Members Table */}
      <Card>
        <Card.Content>
          <DataTable columns={columns} data={filteredMembers} />
        </Card.Content>
      </Card>

      {/* Table Footer */}
      <div className="mt-6 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <p>Showing {filteredMembers.length} of {allMembers.length} members</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
          <Button variant="outline" size="sm">
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
