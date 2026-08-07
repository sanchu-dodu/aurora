"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "./AuthProvider";

type ProtectedRouteProps = {
  children: ReactNode;
};

export default function ProtectedRoute({
  children,
}: ProtectedRouteProps) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/signin");
    }
  }, [loading, router, user]);

  if (loading) {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-[#070B14] text-white"
        aria-live="polite"
      >
        <div className="text-center">
          <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-blue-500" />
          <p className="text-gray-300">
            Checking your Aurora session...
          </p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-[#070B14] text-white"
        aria-live="polite"
      >
        <p className="text-gray-300">
          Redirecting to sign in...
        </p>
      </main>
    );
  }

  return children;
}