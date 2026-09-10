"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/dashboard";

export default function SettingsPage() {
  const [formData, setFormData] = useState({
    groupName: "Nairobi Savers Group",
    email: "contact@nairobi-savers.com",
    phone: "+254712345678",
    maxLoanAmount: "500000",
    loanInterestRate: "12",
  });

  const [saved, setSaved] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        title="Settings"
        description="Manage your group's settings and preferences"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2">
          {/* Group Information */}
          <Card className="mb-8">
            <Card.Header>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Group Information
              </h2>
            </Card.Header>
            <Card.Content className="space-y-6">
              <Input
                label="Group Name"
                name="groupName"
                value={formData.groupName}
                onChange={handleChange}
              />
              <Input
                label="Email Address"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
              />
              <Input
                label="Phone Number"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description
                </label>
                <textarea
                  rows={4}
                  placeholder="Brief description of your group..."
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </Card.Content>
          </Card>

          {/* Loan Settings */}
          <Card>
            <Card.Header>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Loan Settings
              </h2>
            </Card.Header>
            <Card.Content className="space-y-6">
              <Input
                label="Maximum Loan Amount (KES)"
                name="maxLoanAmount"
                type="number"
                value={formData.maxLoanAmount}
                onChange={handleChange}
              />
              <Input
                label="Loan Interest Rate (%)"
                name="loanInterestRate"
                type="number"
                step="0.1"
                value={formData.loanInterestRate}
                onChange={handleChange}
              />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                These settings apply to all new loans in your group.
              </p>
              <Button variant="primary" size="md" onClick={handleSave}>
                Save Changes
              </Button>
              {saved && (
                <div className="p-4 bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 rounded-lg">
                  <p className="text-sm text-success-800 dark:text-success-300">
                    ✓ Settings saved successfully
                  </p>
                </div>
              )}
            </Card.Content>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Account */}
          <Card>
            <Card.Header>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Account
              </h3>
            </Card.Header>
            <Card.Content className="space-y-3">
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
                  Account Type
                </p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  Bookkeeper
                </p>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <p className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
                  Status
                </p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  Active
                </p>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <p className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
                  Created
                </p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  January 15, 2026
                </p>
              </div>
            </Card.Content>
          </Card>

          {/* Danger Zone */}
          <Card className="border-error-200 dark:border-error-800">
            <Card.Header>
              <h3 className="text-lg font-bold text-error-600 dark:text-error-400">
                Danger Zone
              </h3>
            </Card.Header>
            <Card.Content className="space-y-3">
              <Button
                variant="destructive"
                size="md"
                className="w-full"
              >
                Delete Group
              </Button>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Permanently delete this group and all associated data.
              </p>
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
}
