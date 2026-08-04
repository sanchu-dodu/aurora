"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
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

type ProfileSnapshot = {
  profile: Profile | null;
  profiles: Profile[];
};

const PROFILES_KEY = "aurora-profiles";
const PROFILE_KEY = "aurora-profile";
const CHANGE_EVENT = "aurora:profile-change";

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

const serverSnapshot: ProfileSnapshot = {
  profile: null,
  profiles: defaultProfiles,
};

let cachedProfilesRaw: string | null = null;
let cachedProfileRaw: string | null = null;
let cachedSnapshot: ProfileSnapshot = serverSnapshot;

function isProfile(value: unknown): value is Profile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const profile = value as Partial<Profile>;

  return (
    typeof profile.id === "number" &&
    typeof profile.name === "string" &&
    typeof profile.color === "string"
  );
}

function parseProfiles(raw: string | null): Profile[] {
  if (!raw) {
    return defaultProfiles;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return defaultProfiles;
    }

    const profiles = parsed.filter(isProfile);

    return profiles.length > 0
      ? profiles
      : defaultProfiles;
  } catch {
    return defaultProfiles;
  }
}

function parseProfile(raw: string | null): Profile | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return isProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getSnapshot(): ProfileSnapshot {
  if (typeof window === "undefined") {
    return serverSnapshot;
  }

  const profilesRaw =
    window.localStorage.getItem(PROFILES_KEY);

  const profileRaw =
    window.localStorage.getItem(PROFILE_KEY);

  if (
    profilesRaw === cachedProfilesRaw &&
    profileRaw === cachedProfileRaw
  ) {
    return cachedSnapshot;
  }

  cachedProfilesRaw = profilesRaw;
  cachedProfileRaw = profileRaw;

  cachedSnapshot = {
    profiles: parseProfiles(profilesRaw),
    profile: parseProfile(profileRaw),
  };

  return cachedSnapshot;
}

function getServerSnapshot(): ProfileSnapshot {
  return serverSnapshot;
}

function subscribe(callback: () => void): () => void {
  function handleStorage(event: StorageEvent) {
    if (
      event.key === PROFILES_KEY ||
      event.key === PROFILE_KEY
    ) {
      callback();
    }
  }

  function handleChange() {
    callback();
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, handleChange);
  };
}

function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function saveProfiles(profiles: Profile[]) {
  const raw = JSON.stringify(profiles);

  cachedProfilesRaw = raw;
  cachedSnapshot = {
    ...cachedSnapshot,
    profiles,
  };

  window.localStorage.setItem(PROFILES_KEY, raw);
  emitChange();
}

function saveProfile(profile: Profile | null) {
  if (profile) {
    const raw = JSON.stringify(profile);

    cachedProfileRaw = raw;
    window.localStorage.setItem(PROFILE_KEY, raw);
  } else {
    cachedProfileRaw = null;
    window.localStorage.removeItem(PROFILE_KEY);
  }

  cachedSnapshot = {
    ...cachedSnapshot,
    profile,
  };

  emitChange();
}

const ProfileContext =
  createContext<ProfileContextType | null>(null);

export function ProfileProvider({
  children,
}: {
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  function setProfile(profile: Profile) {
    saveProfile(profile);
  }

  function addProfile(profile: Profile) {
    saveProfiles([
      ...snapshot.profiles,
      profile,
    ]);
  }

  function deleteProfile(id: number) {
    saveProfiles(
      snapshot.profiles.filter(
        (profile) => profile.id !== id
      )
    );

    if (snapshot.profile?.id === id) {
      saveProfile(null);
    }
  }

  return (
    <ProfileContext.Provider
      value={{
        profile: snapshot.profile,
        profiles: snapshot.profiles,
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
  const context = useContext(ProfileContext);

  if (!context) {
    throw new Error(
      "useProfile must be used inside ProfileProvider."
    );
  }

  return context;
}