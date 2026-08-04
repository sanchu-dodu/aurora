"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useProfile } from "../components/ProfileProvider";

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
    setProfile,
    addProfile,
    deleteProfile,
  } = useProfile();

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(colors[0]);

  function createProfile() {
    if (!name.trim()) return;

    addProfile({
      id: Date.now(),
      name,
      color,
    });

    setName("");
    setColor(colors[0]);
    setShowModal(false);
  }

  return (
    <main className="min-h-screen bg-[#070B14] text-white flex items-center justify-center px-6">

      <div className="w-full max-w-6xl">

        <h1 className="mb-14 text-center text-5xl font-black">
          Who&apos;s Watching?
        </h1>

        <div className="flex flex-wrap justify-center gap-10">

          {profiles.map((profile) => (

            <div
              key={profile.id}
              className="group relative"
            >

              <button
                onClick={() => {
                  setProfile(profile);
                  router.push("/");
                }}
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
                onClick={() => deleteProfile(profile.id)}
                className="absolute -right-3 -top-3 rounded-full bg-red-600 p-2 opacity-0 transition group-hover:opacity-100"
              >
                <Trash2 size={18} />
              </button>

            </div>

          ))}

          <button
            onClick={() => setShowModal(true)}
            className="group"
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
              onChange={(e) => setName(e.target.value)}
              placeholder="Profile Name"
              className="mb-6 w-full rounded-xl bg-[#1f2937] px-5 py-4 outline-none"
            />

            <div className="mb-8 flex gap-3">

              {colors.map((c) => (

                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-12 w-12 rounded-full ${c} ${
                    color === c
                      ? "ring-4 ring-white"
                      : ""
                  }`}
                />

              ))}

            </div>

            <div className="flex gap-4">

              <button
                onClick={() => setShowModal(false)}
                className="flex-1 rounded-xl bg-gray-700 py-3"
              >
                Cancel
              </button>

              <button
                onClick={createProfile}
                className="flex-1 rounded-xl bg-blue-600 py-3 hover:bg-blue-500"
              >
                Create
              </button>

            </div>

          </div>

        </div>

      )}

    </main>
  );
}