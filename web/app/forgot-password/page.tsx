"use client";

import { useState } from "react";
import Link from "next/link";
import { FirebaseError } from "firebase/app";
import { sendPasswordResetEmail } from "firebase/auth";

import { auth } from "../lib/firebase";

function getResetError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-email":
        return "Enter a valid email address.";

      case "auth/too-many-requests":
        return "Too many attempts. Please wait before trying again.";

      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";

      default:
        return "Unable to send the reset email. Please try again.";
    }
  }

  return "Unable to send the reset email. Please try again.";
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handlePasswordReset(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setSuccess("");
    setLoading(true);

    try {
      await sendPasswordResetEmail(
        auth,
        email.trim()
      );

      setSuccess(
        "If an Aurora account uses this email, a password-reset link has been sent."
      );
    } catch (resetError: unknown) {
      setError(getResetError(resetError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B14] px-6">
      <div className="w-full max-w-md rounded-2xl bg-[#0E1423] p-8 shadow-2xl">
        <h1 className="text-center text-4xl font-black text-blue-500">
          Reset Password
        </h1>

        <p className="mb-8 mt-3 text-center text-gray-400">
          Enter your email and we&apos;ll send you a reset link.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl bg-red-600/20 p-4 text-red-300"
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            className="mb-5 rounded-xl bg-green-600/20 p-4 text-green-300"
          >
            {success}
          </div>
        )}

        <form
          onSubmit={handlePasswordReset}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm text-gray-300"
            >
              Email Address
            </label>

            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="Enter your email"
              className="w-full rounded-xl border border-gray-700 bg-[#161F33] px-4 py-3 text-white outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Sending Reset Link..."
              : "Send Reset Link"}
          </button>
        </form>

        <p className="mt-8 text-center text-gray-400">
          Remember your password?{" "}
          <Link
            href="/signin"
            className="text-blue-400 hover:underline"
          >
            Sign In
          </Link>
        </p>
      </div>
    </main>
  );
}