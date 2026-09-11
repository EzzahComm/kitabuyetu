"use client";

import { useState, useEffect } from "react";
import {
  Modal,
  FormField,
  SelectField,
  FormGroup,
} from "@/components/dashboard";

interface EditLoanModalProps {
  isOpen: boolean;
  loanId?: string;
  initialData?: LoanFormData;
  onClose: () => void;
  onSubmit: (data: LoanFormData) => void;
}

export interface LoanFormData {
  memberName: string;
  originalAmount: string;
  interestRate: string;
  status: string;
  dueDate: string;
  notes: string;
}

/**
 * Edit Loan Modal
 * Form for editing loan details
 */
export function EditLoanModal({
  isOpen,
  loanId,
  initialData,
  onClose,
  onSubmit,
}: EditLoanModalProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<LoanFormData>>({});
  const [formData, setFormData] = useState<LoanFormData>(
    initialData || {
      memberName: "",
      originalAmount: "",
      interestRate: "12",
      status: "active",
      dueDate: "",
      notes: "",
    }
  );

  useEffect(() => {
    if (isOpen && initialData) {
      setFormData(initialData);
      setErrors({});
    }
  }, [isOpen, initialData]);

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

    if (errors[name as keyof LoanFormData]) {
      setErrors((prev) => ({
        ...prev,
        [name]: undefined,
      }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<LoanFormData> = {};

    if (!formData.originalAmount.trim()) {
      newErrors.originalAmount = "Amount is required";
    } else if (isNaN(Number(formData.originalAmount))) {
      newErrors.originalAmount = "Please enter a valid amount";
    }

    if (!formData.interestRate.trim()) {
      newErrors.interestRate = "Interest rate is required";
    } else if (isNaN(Number(formData.interestRate))) {
      newErrors.interestRate = "Please enter a valid rate";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      onSubmit(formData);
      setErrors({});
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Edit Loan"
      description="Update loan details and status"
      onClose={onClose}
      size="md"
      actions={{
        primary: {
          label: "Save Changes",
          onClick: handleSubmit,
          loading,
        },
        secondary: {
          label: "Cancel",
          onClick: onClose,
        },
      }}
    >
      <FormGroup title="Loan Details">
        <FormField
          label="Member Name"
          name="memberName"
          value={formData.memberName}
          onChange={handleChange}
          disabled
          helperText="Cannot change member after creation"
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Original Amount (KES)"
            name="originalAmount"
            type="number"
            value={formData.originalAmount}
            onChange={handleChange}
            error={errors.originalAmount}
            required
          />

          <FormField
            label="Interest Rate (%)"
            name="interestRate"
            type="number"
            step="0.1"
            value={formData.interestRate}
            onChange={handleChange}
            error={errors.interestRate}
            required
          />
        </div>

        <SelectField
          label="Status"
          name="status"
          value={formData.status}
          onChange={handleChange}
          options={[
            { value: "active", label: "Active" },
            { value: "pending", label: "Pending" },
            { value: "completed", label: "Completed" },
            { value: "defaulted", label: "Defaulted" },
          ]}
        />

        <FormField
          label="Due Date"
          name="dueDate"
          type="date"
          value={formData.dueDate}
          onChange={handleChange}
        />

        <FormField
          label="Notes"
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          placeholder="Additional information about this loan..."
          rows={3}
        />
      </FormGroup>
    </Modal>
  );
}
