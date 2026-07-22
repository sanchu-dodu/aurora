"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

export type Profile = {
  id: number;
  name: string;
  color: string;
};

type ProfileContextType = {
  profile: Profile | null;
  profiles: Profile[];
  setProfile: (profile: Profile) => void;
  addProfile: (profile: Profile) => void;
  deleteProfile: (id: number) => void;
};

const ProfileContext = createContext<ProfileContextType>({
  profile: null,
  profiles: [],
  setProfile: () => {},
  addProfile: () => {},
  deleteProfile: () => {},
});

const defaultProfiles: Profile[] = [
  {
    id: 1,
    name: "Alex",
    color: "bg-blue-600",
  },
  {
    id: 2,
    name: "Guest",
    color: "bg-red-600",
  },
];

export function ProfileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, setCurrentProfile] =
    useState<Profile | null>(null);

  const [profiles, setProfiles] =
    useState<Profile[]>(defaultProfiles);

  useEffect(() => {
    const savedProfiles = localStorage.getItem(
      "aurora-profiles"
    );

    if (savedProfiles) {
      setProfiles(JSON.parse(savedProfiles));
    }

    const savedProfile = localStorage.getItem(
      "aurora-profile"
    );

    if (savedProfile) {
      setCurrentProfile(JSON.parse(savedProfile));
    }
  }, []);

  function saveProfiles(updated: Profile[]) {
    setProfiles(updated);

    localStorage.setItem(
      "aurora-profiles",
      JSON.stringify(updated)
    );
  }

  function setProfile(profile: Profile) {
    setCurrentProfile(profile);

    localStorage.setItem(
      "aurora-profile",
      JSON.stringify(profile)
    );
  }

  function addProfile(profile: Profile) {
    const updated = [...profiles, profile];

    saveProfiles(updated);
  }

  function deleteProfile(id: number) {
    const updated = profiles.filter(
      (profile) => profile.id !== id
    );

    saveProfiles(updated);

    if (profile?.id === id) {
      setCurrentProfile(null);
      localStorage.removeItem("aurora-profile");
    }
  }

  return (
    <ProfileContext.Provider
      value={{
        profile,
        profiles,
        setProfile,
        addProfile,
        deleteProfile,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}