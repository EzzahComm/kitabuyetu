"use client";

import { useState } from "react";
import {
  Modal,
  FormField,
  SelectField,
  CheckboxField,
  FormGroup,
} from "@/components/dashboard";

interface AddMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: MemberFormData) => void;
}

export interface MemberFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  occupation: string;
  membershipType: string;
  receiveNotifications: boolean;
}

/**
 * Add Member Modal
 * Form for creating a new group member
 */
export function AddMemberModal({
  isOpen,
  onClose,
  onSubmit,
}: AddMemberModalProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<MemberFormData>>({});
  const [formData, setFormData] = useState<MemberFormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    occupation: "",
    membershipType: "regular",
    receiveNotifications: true,
  });

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const { name, type, value } = e.target as HTMLInputElement;

    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({
        ...prev,
        [name]: checked,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }

    // Clear error for this field
    if (errors[name as keyof MemberFormData]) {
      setErrors((prev) => ({
        ...prev,
        [name]: undefined,
      }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<MemberFormData> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = "First name is required";
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = "Last name is required";
    }
    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!formData.email.includes("@")) {
      newErrors.email = "Please enter a valid email";
    }
    if (!formData.phone.trim()) {
      newErrors.phone = "Phone number is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      onSubmit(formData);
      // Reset form
      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        dateOfBirth: "",
        occupation: "",
        membershipType: "regular",
        receiveNotifications: true,
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
      title="Add New Member"
      description="Fill in the member's information to add them to the group"
      onClose={onClose}
      size="lg"
      actions={{
        primary: {
          label: "Add Member",
          onClick: handleSubmit,
          loading,
        },
        secondary: {
          label: "Cancel",
          onClick: onClose,
        },
      }}
    >
      <FormGroup title="Basic Information" description="Member's personal details">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="First Name"
            name="firstName"
            value={formData.firstName}
            onChange={handleChange}
            placeholder="John"
            error={errors.firstName}
            required
          />
          <FormField
            label="Last Name"
            name="lastName"
            value={formData.lastName}
            onChange={handleChange}
            placeholder="Doe"
            error={errors.lastName}
            required
          />
        </div>

        <FormField
          label="Email Address"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="john@example.com"
          error={errors.email}
          helperText="We'll use this to send member communications"
          required
        />

        <FormField
          label="Phone Number"
          name="phone"
          type="tel"
          value={formData.phone}
          onChange={handleChange}
          placeholder="+254712345678"
          error={errors.phone}
          helperText="Include country code for SMS communications"
          required
        />

        <FormField
          label="Date of Birth"
          name="dateOfBirth"
          type="date"
          value={formData.dateOfBirth}
          onChange={handleChange}
        />
      </FormGroup>

      <FormGroup title="Employment & Membership">
        <FormField
          label="Occupation"
          name="occupation"
          value={formData.occupation}
          onChange={handleChange}
          placeholder="Software Engineer, Teacher, Farmer, etc."
        />

        <SelectField
          label="Membership Type"
          name="membershipType"
          value={formData.membershipType}
          onChange={handleChange}
          options={[
            { value: "regular", label: "Regular Member" },
            { value: "premium", label: "Premium Member" },
            { value: "founder", label: "Founder Member" },
            { value: "associate", label: "Associate Member" },
          ]}
          helperText="Membership type determines access level and benefits"
        />
      </FormGroup>

      <FormGroup title="Preferences">
        <CheckboxField
          label="Receive Notifications"
          name="receiveNotifications"
          checked={formData.receiveNotifications}
          onChange={handleChange}
          helperText="Member will receive SMS and email updates"
        />
      </FormGroup>
    </Modal>
  );
}
