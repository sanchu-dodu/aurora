"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "../components/AuthProvider";

export default function ProfilePage() {
  const { user, logout, loading } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#070B14] text-white">
        Loading...
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#070B14] text-white">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">
            You're not signed in
          </h1>

          <button
            onClick={() => router.push("/signin")}
            className="rounded-xl bg-blue-600 px-8 py-4 hover:bg-blue-700 transition"
          >
            Sign In
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#070B14] text-white flex justify-center items-center p-10">
      <div className="w-full max-w-xl rounded-3xl bg-white/5 p-10 border border-white/10">

        <div className="flex justify-center mb-8">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-blue-600 text-5xl font-bold">
            {user.email?.charAt(0).toUpperCase()}
          </div>
        </div>

        <h1 className="text-center text-4xl font-black mb-8">
          My Profile
        </h1>

        <div className="space-y-6">

          <div>
            <p className="text-gray-400">Email</p>
            <p className="text-xl">{user.email}</p>
          </div>

          <div>
            <p className="text-gray-400">User ID</p>
            <p className="break-all text-sm text-gray-300">
              {user.uid}
            </p>
          </div>

          <div>
            <p className="text-gray-400">Email Verified</p>
            <p>
              {user.emailVerified ? "✅ Yes" : "❌ No"}
            </p>
          </div>

        </div>

        <button
          onClick={handleLogout}
          className="mt-10 w-full rounded-xl bg-red-600 py-4 font-bold hover:bg-red-700 transition"
        >
          Logout
        </button>

      </div>
    </main>
  );
}