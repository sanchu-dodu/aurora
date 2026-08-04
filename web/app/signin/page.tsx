"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";

export default function SignInPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);
    setError("");

    try {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      router.push("/");
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to sign in. Please try again."
      );
    }

    setLoading(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#070B14] text-white">

      <form
        onSubmit={handleSignIn}
        className="w-full max-w-md rounded-2xl bg-white/5 p-10"
      >

        <h1 className="mb-8 text-center text-4xl font-black">
          Welcome Back
        </h1>

        {error && (
          <div className="mb-6 rounded-lg bg-red-600/20 p-3 text-red-300">
            {error}
          </div>
        )}

        <input
          type="email"
          placeholder="Email"
          className="mb-5 w-full rounded-xl bg-white/10 p-4 outline-none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Password"
          className="mb-8 w-full rounded-xl bg-white/10 p-4 outline-none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-4 font-bold hover:bg-blue-700 transition"
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