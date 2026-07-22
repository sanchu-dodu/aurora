"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { useAuth } from "./AuthProvider";
import { useProfile } from "./ProfileProvider";

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const { profile } = useProfile();

  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#070B14]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between px-4 py-5 sm:px-6 lg:px-10">

        {/* Logo */}
        <Link
          href="/"
          className="text-2xl font-black tracking-wider text-blue-500 sm:text-3xl"
        >
          AURORA
        </Link>

        {/* Desktop Navigation */}
        <ul className="hidden gap-8 text-gray-300 lg:flex">
          <li>
            <Link href="/" className="hover:text-white transition">
              Home
            </Link>
          </li>

          <li>
            <Link href="/movies" className="hover:text-white transition">
              Movies
            </Link>
          </li>

          <li>
            <Link href="/tv-shows" className="hover:text-white transition">
              TV Shows
            </Link>
          </li>

          <li>
            <Link href="/search" className="hover:text-white transition">
              Search
            </Link>
          </li>

          <li>
            <Link href="/ai" className="hover:text-white transition">
              Aurora AI
            </Link>
          </li>

          <li>
            <Link href="/my-list" className="hover:text-white transition">
              My List
            </Link>
          </li>
        </ul>

        {/* Desktop User */}
        <div className="hidden lg:block">
          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : user ? (
            <div className="flex items-center gap-4">

              <Link
                href="/profiles"
                className="flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 transition hover:bg-white/20"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full font-bold text-white ${
                    profile?.color || "bg-blue-600"
                  }`}
                >
                  {profile?.name?.charAt(0) ||
                    user.email?.charAt(0).toUpperCase()}
                </div>

                <div className="hidden xl:block">
                  <p className="font-semibold">
                    {profile?.name || "Profile"}
                  </p>

                  <p className="text-xs text-gray-400">
                    {user.email}
                  </p>
                </div>
              </Link>

              <Link
                href="/profiles"
                className="rounded-lg border border-blue-500 px-5 py-2 transition hover:bg-blue-600"
              >
                Switch Profile
              </Link>

              <button
                onClick={handleLogout}
                className="rounded-lg bg-red-600 px-5 py-2 transition hover:bg-red-700"
              >
                Logout
              </button>

            </div>
          ) : (
            <div className="flex gap-3">

              <Link
                href="/signin"
                className="rounded-lg border border-gray-600 px-5 py-2 transition hover:bg-gray-800"
              >
                Sign In
              </Link>

              <Link
                href="/signup"
                className="rounded-lg bg-blue-600 px-5 py-2 transition hover:bg-blue-700"
              >
                Sign Up
              </Link>

            </div>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="lg:hidden"
        >
          {menuOpen ? <X size={30} /> : <Menu size={30} />}
        </button>

      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="border-t border-white/10 bg-[#070B14] lg:hidden">

          <div className="flex flex-col space-y-5 p-6">

            <Link href="/" onClick={() => setMenuOpen(false)}>
              Home
            </Link>

            <Link href="/movies" onClick={() => setMenuOpen(false)}>
              Movies
            </Link>

            <Link href="/tv-shows" onClick={() => setMenuOpen(false)}>
              TV Shows
            </Link>

            <Link href="/search" onClick={() => setMenuOpen(false)}>
              Search
            </Link>

            <Link href="/ai" onClick={() => setMenuOpen(false)}>
              Aurora AI
            </Link>

            <Link href="/my-list" onClick={() => setMenuOpen(false)}>
              My List
            </Link>

            <hr className="border-white/10" />

            {loading ? (
              <p>Loading...</p>
            ) : user ? (
              <>
                <div className="flex items-center gap-3">

                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full font-bold text-white ${
                      profile?.color || "bg-blue-600"
                    }`}
                  >
                    {profile?.name?.charAt(0) ||
                      user.email?.charAt(0).toUpperCase()}
                  </div>

                  <div>
                    <p>{profile?.name || "Profile"}</p>
                    <p className="text-sm text-gray-400">
                      {user.email}
                    </p>
                  </div>

                </div>

                <Link
                  href="/profiles"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg border border-blue-500 py-3 text-center"
                >
                  Switch Profile
                </Link>

                <button
                  onClick={handleLogout}
                  className="rounded-lg bg-red-600 py-3"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link href="/signin">
                  Sign In
                </Link>

                <Link
                  href="/signup"
                  className="rounded-lg bg-blue-600 py-3 text-center"
                >
                  Sign Up
                </Link>
              </>
            )}

          </div>

        </div>
      )}
    </nav>
  );
}