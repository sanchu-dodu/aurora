"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      router.push("/");
    } catch (err: any) {
      setError(err.message);
    }

    setLoading(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#070B14] text-white">

      <form
        onSubmit={handleSignup}
        className="w-full max-w-md rounded-2xl bg-white/5 p-10"
      >

        <h1 className="mb-8 text-center text-4xl font-black">
          Create Account
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
          {loading ? "Creating Account..." : "Create Account"}
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