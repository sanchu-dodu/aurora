"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FirebaseError } from "firebase/app";
import { signInWithEmailAndPassword } from "firebase/auth";

import { auth } from "../lib/firebase";

function getSignInError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/invalid-email":
      case "auth/user-not-found":
      case "auth/wrong-password":
        return "The email or password is incorrect.";

      case "auth/user-disabled":
        return "This Aurora account has been disabled.";

      case "auth/too-many-requests":
        return "Too many attempts. Please wait before trying again.";

      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";

      default:
        return "Unable to sign in. Please try again.";
    }
  }

  return "Unable to sign in. Please try again.";
}

export default function SignInPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      router.replace("/profiles");
    } catch (signInError: unknown) {
      setError(getSignInError(signInError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B14] px-6 text-white">
      <form
        onSubmit={handleSignIn}
        className="w-full max-w-md rounded-2xl bg-white/5 p-10"
      >
        <h1 className="mb-8 text-center text-4xl font-black">
          Welcome Back
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

        <div className="mb-3">
          <label
            htmlFor="password"
            className="mb-2 block text-sm text-gray-300"
          >
            Password
          </label>

          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            className="w-full rounded-xl bg-white/10 p-4 outline-none transition focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="mb-8 text-right">
          <Link
            href="/forgot-password"
            className="text-sm text-blue-400 hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-4 font-bold transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Signing In..." : "Sign In"}
        </button>

        <p className="mt-6 text-center text-gray-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-blue-400 hover:underline"
          >
            Create one
          </Link>
        </p>
      </form>
    </main>
  );
}