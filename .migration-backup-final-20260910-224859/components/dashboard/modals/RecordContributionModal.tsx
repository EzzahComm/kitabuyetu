"use client";

import { useState } from "react";
import {
  Modal,
  FormField,
  SelectField,
  FormGroup,
} from "@/components/dashboard";

interface RecordContributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ContributionFormData) => void;
  members?: string[];
}

export interface ContributionFormData {
  memberId: string;
  amount: string;
  paymentMethod: string;
  reference: string;
  notes: string;
}

/**
 * Record Contribution Modal
 * Form for recording a new member contribution
 */
export function RecordContributionModal({
  isOpen,
  onClose,
  onSubmit,
  members = [
    "John Doe",
    "Jane Smith",
    "Peter Johnson",
    "David Brown",
    "Mary Williams",
  ],
}: RecordContributionModalProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<ContributionFormData>>({});
  const [formData, setFormData] = useState<ContributionFormData>({
    memberId: "",
    amount: "",
    paymentMethod: "mpesa",
    reference: "",
    notes: "",
  });

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Clear error for this field
    if (errors[name as keyof ContributionFormData]) {
      setErrors((prev) => ({
        ...prev,
        [name]: undefined,
      }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<ContributionFormData> = {};

    if (!formData.memberId.trim()) {
      newErrors.memberId = "Please select a member";
    }
    if (!formData.amount.trim()) {
      newErrors.amount = "Amount is required";
    } else if (isNaN(Number(formData.amount))) {
      newErrors.amount = "Please enter a valid amount";
    } else if (Number(formData.amount) <= 0) {
      newErrors.amount = "Amount must be greater than 0";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 800));
      onSubmit(formData);
      // Reset form
      setFormData({
        memberId: "",
        amount: "",
        paymentMethod: "mpesa",
        reference: "",
        notes: "",
      });
      setErrors({});
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Record Contribution"
      description="Add a new contribution for a group member"
      onClose={onClose}
      size="md"
      actions={{
        primary: {
          label: "Record Contribution",
          onClick: handleSubmit,
          loading,
        },
        secondary: {
          label: "Cancel",
          onClick: onClose,
        },
      }}
    >
      <FormGroup>
        <SelectField
          label="Member"
          name="memberId"
          value={formData.memberId}
          onChange={handleChange}
          options={members.map((member) => ({
            value: member,
            label: member,
          }))}
          placeholder="Select a member"
          error={errors.memberId}
          required
        />

        <FormField
          label="Amount (KES)"
          name="amount"
          type="number"
          value={formData.amount}
          onChange={handleChange}
          placeholder="5000"
          error={errors.amount}
          required
        />

        <SelectField
          label="Payment Method"
          name="paymentMethod"
          value={formData.paymentMethod}
          onChange={handleChange}
          options={[
            { value: "mpesa", label: "M-Pesa" },
            { value: "bank", label: "Bank Transfer" },
            { value: "cash", label: "Cash" },
            { value: "check", label: "Check" },
          ]}
        />

        <FormField
          label="Transaction Reference"
          name="reference"
          value={formData.reference}
          onChange={handleChange}
          placeholder="M-Pesa ref, bank confirmation, etc."
          helperText="Optional: Reference number for tracking"
        />

        <FormField
          label="Notes"
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          placeholder="Any additional notes..."
          helperText="Optional: Additional information about this contribution"
          rows={3}
        />
      </FormGroup>
    </Modal>
  );
}
