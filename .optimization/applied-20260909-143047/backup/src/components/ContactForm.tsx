"use client";
import React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";

/**
 * The full on-page contact form for /contact. Same field pattern and Web3Forms
 * submission target as PopupWidget's chat form (name, email, message, honeypot),
 * plus a newsletter opt-in and a required terms acceptance the popup doesn't need.
 */
export function ContactForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitSuccessful, isSubmitting },
  } = useForm({ mode: "onTouched" });

  const [isSuccess, setIsSuccess] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const onSubmit = async (data: any) => {
    await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data, null, 2),
    })
      .then(async (response) => {
        const json = await response.json();
        if (json.success) {
          setIsSuccess(true);
          setMessage(json.message);
          reset();
        } else {
          setIsSuccess(false);
          setMessage(json.message);
        }
      })
      .catch((error) => {
        setIsSuccess(false);
        setMessage("Client error. Please check the console for more info.");
        console.log(error);
      });
  };

  const inputClass = (hasError: boolean) =>
    `w-full px-3 py-2 text-gray-600 placeholder-gray-300 bg-white border rounded-md focus:outline-none focus:ring dark:bg-trueGray-800 dark:text-gray-300 dark:placeholder-gray-500 ${
      hasError
        ? "border-red-600 focus:border-red-600 ring-red-100"
        : "border-gray-300 dark:border-trueGray-700 focus:border-brand-600 ring-brand-100"}`;


  if (isSubmitSuccessful && isSuccess) {
    return (
      <div className="max-w-xl mx-auto text-center">
        <h3 className="text-xl font-medium text-indigo-600">Message sent</h3>
        <p className="mt-2 text-gray-500 dark:text-gray-400">{message}</p>
        <button
          type="button"
          onClick={() => setIsSuccess(false)}
          className="mt-6 text-indigo-600 rounded focus:outline-none focus-visible:ring focus-visible:ring-indigo-100 focus-visible:ring-opacity-75"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      {isSubmitSuccessful && !isSuccess && (
        <p className="mb-4 text-sm text-center text-red-500" role="alert">
          {message || "Something went wrong. Please try again, or reach us directly above."}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <input
          type="hidden"
          value={process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY ?? ""}
          {...register("apikey")}
        />
        <input type="hidden" value="A group reached out from the Kitabu Yetu contact page" {...register("subject")} />
        <input type="hidden" value="Kitabu Yetu" {...register("from_name")} />
        <input
          type="checkbox"
          className="hidden"
          style={{ display: "none" }}
          tabIndex={-1}
          autoComplete="off"
          {...register("botcheck")}
        />

        <div className="mb-4">
          <label htmlFor="contact_name" className="block mb-2 text-sm text-gray-600 dark:text-gray-400">
            Full Name
          </label>
          <input
            type="text"
            id="contact_name"
            placeholder="Your name"
            {...register("name", { required: "Your name is required", maxLength: 80 })}
            className={inputClass(!!errors.name)}
          />
          {errors.name && (
            <div className="mt-1 text-sm text-red-600" role="alert">{errors.name.message as string}</div>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="contact_email" className="block mb-2 text-sm text-gray-600 dark:text-gray-400">
            Email Address
          </label>
          <input
            type="email"
            id="contact_email"
            placeholder="you@example.com"
            {...register("email", {
              required: "Enter your email",
              pattern: { value: /^\S+@\S+$/i, message: "Enter a valid email" },
            })}
            className={inputClass(!!errors.email)}
          />
          {errors.email && (
            <div className="mt-1 text-sm text-red-600" role="alert">{errors.email.message as string}</div>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="contact_message" className="block mb-2 text-sm text-gray-600 dark:text-gray-400">
            Tell us about your group
          </label>
          <textarea
            rows={4}
            id="contact_message"
            placeholder="How many members, and where you are today — paper, spreadsheet, or another system"
            {...register("message", { required: "Let us know what you need" })}
            className={`${inputClass(!!errors.message)} h-28`}
          />
          {errors.message && (
            <div className="mt-1 text-sm text-red-600" role="alert">{errors.message.message as string}</div>
          )}
        </div>

        <div className="mb-4">
          <label className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              {...register("newsletter_optin")}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-brand-600 focus:ring-brand-300"
            />
            Send me occasional updates about Kitabu Yetu
          </label>
        </div>

        <div className="mb-4">
          <label className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              {...register("terms_accepted", { required: "You need to accept the Terms & Conditions to continue" })}
              className={`mt-0.5 h-4 w-4 rounded accent-brand-600 focus:ring-brand-300 ${
                errors.terms_accepted ? "border-red-600" : "border-gray-300"
              }`}
            />
            <span>
              I agree to the{" "}
              <Link
                href="/legal#terms"
                className="text-indigo-600 underline hover:text-indigo-500 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                Terms &amp; Conditions
              </Link>
            </span>
          </label>
          {errors.terms_accepted && (
            <div className="mt-1 text-sm text-red-600" role="alert">
              {errors.terms_accepted.message as string}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-12 w-full rounded-md bg-brand-600 px-6 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Sending…" : "Send Message"}
        </button>
      </form>
    </div>
  );
}

export default ContactForm;
