"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FirebaseError } from "firebase/app";
import { createUserWithEmailAndPassword } from "firebase/auth";

import { auth } from "../lib/firebase";

function getSignupError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/email-already-in-use":
        return "An Aurora account already uses this email.";

      case "auth/invalid-email":
        return "Enter a valid email address.";

      case "auth/weak-password":
        return "Use a stronger password with at least six characters.";

      case "auth/too-many-requests":
        return "Too many attempts. Please wait before trying again.";

      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";

      default:
        return "Unable to create the account. Please try again.";
    }
  }

  return "Unable to create the account. Please try again.";
}

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignup(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    if (password.length < 6) {
      setError(
        "Use a password with at least six characters."
      );
      return;
    }

    setLoading(true);

    try {
      await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      router.replace("/profiles");
    } catch (signupError: unknown) {
      setError(getSignupError(signupError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B14] px-6 text-white">
      <form
        onSubmit={handleSignup}
        className="w-full max-w-md rounded-2xl bg-white/5 p-10"
      >
        <h1 className="mb-8 text-center text-4xl font-black">
          Create Account
        </h1>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-lg bg-red-600/20 p-3 text-red-300"
          >
            {error}
          </div>
        )}

        <div className="mb-5">
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
            placeholder="Email"
            className="w-full rounded-xl bg-white/10 p-4 outline-none transition focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="mb-8">
          <label
            htmlFor="password"
            className="mb-2 block text-sm text-gray-300"
          >
            Password
          </label>

          <input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least six characters"
            minLength={6}
            className="w-full rounded-xl bg-white/10 p-4 outline-none transition focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-4 font-bold transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading
            ? "Creating Account..."
            : "Create Account"}
        </button>

        <p className="mt-6 text-center text-gray-400">
          Already have an account?{" "}
          <Link
            href="/signin"
            className="text-blue-400 hover:underline"
          >
            Sign In
          </Link>
        </p>
      </form>
    </main>
  );
}