"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { useProfile } from "../components/ProfileProvider";
import ProtectedRoute from "../components/ProtectedRoute";

const colors = [
  "bg-blue-600",
  "bg-red-600",
  "bg-green-600",
  "bg-purple-600",
  "bg-pink-600",
  "bg-orange-600",
];

export default function ProfilesPage() {
  const router = useRouter();

  const {
    profiles,
    loading,
    ready,
    saving,
    error,
    setProfile,
    addProfile,
    deleteProfile,
  } = useProfile();

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(colors[0]);

  const actionsDisabled =
    !ready || saving;

  async function createProfile() {
    if (
      !name.trim() ||
      actionsDisabled
    ) {
      return;
    }

    try {
      await addProfile({
        id: Date.now(),
        name,
        color,
      });

      setName("");
      setColor(colors[0]);
      setShowModal(false);
    } catch {
      // Provider exposes the persistence error.
    }
  }

  async function selectProfile(
    profile: (typeof profiles)[number]
  ) {
    if (actionsDisabled) {
      return;
    }

    try {
      await setProfile(profile);
      router.push("/");
    } catch {
      // Stay on this page when persistence fails.
    }
  }

  async function removeProfile(id: number) {
    if (actionsDisabled) {
      return;
    }

    try {
      await deleteProfile(id);
    } catch {
      // Provider exposes the persistence error.
    }
  }

  if (loading) {
    return (
      <ProtectedRoute>
        <main className="flex min-h-screen items-center justify-center bg-[#070B14] px-6 text-white">
          <p className="text-lg text-gray-300">
            Loading profiles...
          </p>
        </main>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <main className="flex min-h-screen items-center justify-center bg-[#070B14] px-6 text-white">
        <div className="w-full max-w-6xl">
          <h1 className="mb-6 text-center text-5xl font-black">
            Who&apos;s Watching?
          </h1>

          {error && (
            <p
              role="alert"
              className="mb-8 text-center text-red-400"
            >
              We couldn&apos;t sync your profiles.
              Please try again.
            </p>
          )}

          <div className="flex flex-wrap justify-center gap-10">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="group relative"
              >
                <button
                  disabled={actionsDisabled}
                  onClick={() => {
                    void selectProfile(profile);
                  }}
                  className="disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div
                    className={`flex h-40 w-40 items-center justify-center rounded-3xl text-6xl font-black text-white transition duration-300 group-hover:scale-110 ${profile.color}`}
                  >
                    {profile.name.charAt(0)}
                  </div>

                  <p className="mt-5 text-center text-xl">
                    {profile.name}
                  </p>
                </button>

                <button
                  disabled={actionsDisabled}
                  onClick={() => {
                    void removeProfile(profile.id);
                  }}
                  className="absolute -right-3 -top-3 rounded-full bg-red-600 p-2 opacity-0 transition group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Delete ${profile.name} profile`}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}

            <button
              disabled={actionsDisabled}
              onClick={() => setShowModal(true)}
              className="group disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex h-40 w-40 items-center justify-center rounded-3xl border-2 border-dashed border-gray-500 transition group-hover:border-blue-500">
                <Plus size={60} />
              </div>

              <p className="mt-5 text-xl">
                Add Profile
              </p>
            </button>
          </div>
        </div>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="w-full max-w-md rounded-3xl bg-[#111827] p-8">
              <h2 className="mb-8 text-3xl font-bold">
                Create Profile
              </h2>

              <input
                value={name}
                disabled={saving}
                onChange={(event) =>
                  setName(event.target.value)
                }
                placeholder="Profile Name"
                className="mb-6 w-full rounded-xl bg-[#1f2937] px-5 py-4 outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />

              <div className="mb-8 flex gap-3">
                {colors.map((profileColor) => (
                  <button
                    key={profileColor}
                    disabled={saving}
                    onClick={() =>
                      setColor(profileColor)
                    }
                    className={`h-12 w-12 rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${profileColor} ${
                      color === profileColor
                        ? "ring-4 ring-white"
                        : ""
                    }`}
                    aria-label={`Use ${profileColor} profile color`}
                  />
                ))}
              </div>

              {error && (
                <p
                  role="alert"
                  className="mb-6 text-sm text-red-400"
                >
                  We couldn&apos;t save the profile.
                  Please try again.
                </p>
              )}

              <div className="flex gap-4">
                <button
                  disabled={saving}
                  onClick={() =>
                    setShowModal(false)
                  }
                  className="flex-1 rounded-xl bg-gray-700 py-3 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  disabled={
                    actionsDisabled ||
                    !name.trim()
                  }
                  onClick={() => {
                    void createProfile();
                  }}
                  className="flex-1 rounded-xl bg-blue-600 py-3 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </ProtectedRoute>
  );
}