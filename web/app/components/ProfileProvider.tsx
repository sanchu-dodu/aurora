"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useAuth } from "./AuthProvider";
import {
  subscribeToProfiles,
  writeProfiles,
} from "../lib/firestoreUserDataService";

export type Profile = {
  id: number;
  name: string;
  color: string;
};

type ProfileContextType = {
  profile: Profile | null;
  profiles: Profile[];
  loading: boolean;
  ready: boolean;
  saving: boolean;
  error: Error | null;
  setProfile: (profile: Profile) => Promise<void>;
  addProfile: (profile: Profile) => Promise<void>;
  deleteProfile: (id: number) => Promise<void>;
};

type ProfileSnapshot = {
  profile: Profile | null;
  profiles: Profile[];
};

type RemoteProfilesState = {
  userId: string;
  snapshot: ProfileSnapshot;
  status: "loading" | "ready" | "error";
  saving: boolean;
  error: Error | null;
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

function emptyProfileSnapshot(): ProfileSnapshot {
  return {
    profile: null,
    profiles: [],
  };
}

function defaultProfileSnapshot(): ProfileSnapshot {
  return {
    profile: null,
    profiles: [...defaultProfiles],
  };
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("Unable to synchronize profiles.");
}

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

function getLocalSnapshot(): ProfileSnapshot {
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

function subscribeToLocalProfiles(
  callback: () => void
): () => void {
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
    window.removeEventListener(
      "storage",
      handleStorage
    );

    window.removeEventListener(
      CHANGE_EVENT,
      handleChange
    );
  };
}

function emitLocalChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function saveLocalProfiles(profiles: Profile[]) {
  const raw = JSON.stringify(profiles);

  cachedProfilesRaw = raw;

  cachedSnapshot = {
    ...cachedSnapshot,
    profiles,
  };

  window.localStorage.setItem(
    PROFILES_KEY,
    raw
  );

  emitLocalChange();
}

function saveLocalProfile(profile: Profile | null) {
  if (profile) {
    const raw = JSON.stringify(profile);

    cachedProfileRaw = raw;

    window.localStorage.setItem(
      PROFILE_KEY,
      raw
    );
  } else {
    cachedProfileRaw = null;

    window.localStorage.removeItem(
      PROFILE_KEY
    );
  }

  cachedSnapshot = {
    ...cachedSnapshot,
    profile,
  };

  emitLocalChange();
}

const ProfileContext =
  createContext<ProfileContextType | null>(null);

export function ProfileProvider({
  children,
}: {
  children: ReactNode;
}) {
  const {
    user,
    loading: authLoading,
  } = useAuth();

  const userId = user?.uid ?? null;

  const localSnapshot = useSyncExternalStore(
    subscribeToLocalProfiles,
    getLocalSnapshot,
    getServerSnapshot
  );

  const [
    remoteState,
    setRemoteState,
  ] = useState<RemoteProfilesState | null>(
    null
  );

  const remoteSnapshotRef =
    useRef<ProfileSnapshot>(
      emptyProfileSnapshot()
    );

  const remoteReadyRef = useRef(false);
  const remoteWriteInFlightRef = useRef(false);

  /*
   * These refs bind asynchronous Firestore work to
   * the authentication session that started it.
   *
   * A callback or write from User A must never update
   * the in-memory state belonging to User B.
   */
  const remoteUserIdRef =
    useRef<string | null>(null);

  const remoteGenerationRef = useRef(0);

  useEffect(() => {
    const generation =
      remoteGenerationRef.current + 1;

    remoteGenerationRef.current = generation;

    remoteUserIdRef.current =
      authLoading ? null : userId;

    remoteSnapshotRef.current =
      emptyProfileSnapshot();

    remoteReadyRef.current = false;
    remoteWriteInFlightRef.current = false;

    if (
      authLoading ||
      userId === null
    ) {
      return;
    }

    let active = true;

    const unsubscribe = subscribeToProfiles(
      userId,
      (profilesData) => {
        if (
          !active ||
          remoteGenerationRef.current !==
            generation ||
          remoteUserIdRef.current !== userId
        ) {
          return;
        }

        /*
         * A missing document means this account has
         * never persisted profiles. Present the existing
         * defaults in memory, but do not create a remote
         * document until the user performs an explicit
         * profile mutation.
         *
         * A real remote document containing an empty
         * profiles array remains authoritative.
         */
        const nextSnapshot: ProfileSnapshot =
          profilesData ??
          defaultProfileSnapshot();

        remoteSnapshotRef.current =
          nextSnapshot;

        remoteReadyRef.current = true;

        setRemoteState({
          userId,
          snapshot: nextSnapshot,
          status: "ready",
          saving:
            remoteWriteInFlightRef.current,
          error: null,
        });
      },
      (value) => {
        if (
          !active ||
          remoteGenerationRef.current !==
            generation ||
          remoteUserIdRef.current !== userId
        ) {
          return;
        }

        remoteReadyRef.current = false;

        setRemoteState({
          userId,
          snapshot:
            remoteSnapshotRef.current,
          status: "error",
          saving:
            remoteWriteInFlightRef.current,
          error: toError(value),
        });
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    authLoading,
    userId,
  ]);

  async function writeRemoteSnapshot(
    nextSnapshot: ProfileSnapshot
  ): Promise<void> {
    if (
      authLoading ||
      userId === null
    ) {
      throw new Error(
        "Authenticated profiles are not available."
      );
    }

    if (
      !remoteReadyRef.current ||
      remoteUserIdRef.current !== userId
    ) {
      throw new Error(
        "Profiles are not ready to save."
      );
    }

    if (remoteWriteInFlightRef.current) {
      throw new Error(
        "A profile update is already in progress."
      );
    }

    const generation =
      remoteGenerationRef.current;

    const previousSnapshot =
      remoteSnapshotRef.current;

    remoteWriteInFlightRef.current = true;

    setRemoteState((currentState) => {
      if (
        currentState?.userId !== userId
      ) {
        return currentState;
      }

      return {
        ...currentState,
        saving: true,
        error: null,
      };
    });

    try {
      await writeProfiles(
        userId,
        nextSnapshot
      );

      if (
        remoteGenerationRef.current !==
          generation ||
        remoteUserIdRef.current !== userId
      ) {
        return;
      }

      remoteSnapshotRef.current =
        nextSnapshot;

      remoteReadyRef.current = true;

      setRemoteState({
        userId,
        snapshot: nextSnapshot,
        status: "ready",
        saving: false,
        error: null,
      });
    } catch (value) {
      const error = toError(value);

      if (
        remoteGenerationRef.current !==
          generation ||
        remoteUserIdRef.current !== userId
      ) {
        throw error;
      }

      remoteSnapshotRef.current =
        previousSnapshot;

      remoteReadyRef.current = true;

      setRemoteState({
        userId,
        snapshot: previousSnapshot,
        status: "ready",
        saving: false,
        error,
      });

      throw error;
    } finally {
      if (
        remoteGenerationRef.current ===
          generation &&
        remoteUserIdRef.current === userId
      ) {
        remoteWriteInFlightRef.current =
          false;

        setRemoteState((currentState) => {
          if (
            currentState?.userId !== userId
          ) {
            return currentState;
          }

          return {
            ...currentState,
            saving: false,
          };
        });
      }
    }
  }

  async function setProfile(
    profile: Profile
  ): Promise<void> {
    if (authLoading) {
      return;
    }

    if (userId === null) {
      saveLocalProfile(profile);
      return;
    }

    const currentSnapshot =
      remoteSnapshotRef.current;

    const matchingProfile =
      currentSnapshot.profiles.find(
        (candidate) =>
          candidate.id === profile.id &&
          candidate.name === profile.name &&
          candidate.color === profile.color
      );

    if (!matchingProfile) {
      throw new Error(
        "This profile is no longer available."
      );
    }

    await writeRemoteSnapshot({
      profile: matchingProfile,
      profiles: currentSnapshot.profiles,
    });
  }

  async function addProfile(
    profile: Profile
  ): Promise<void> {
    if (authLoading) {
      return;
    }

    if (userId === null) {
      saveLocalProfiles([
        ...localSnapshot.profiles,
        profile,
      ]);

      return;
    }

    if (
      !Number.isInteger(profile.id) ||
      profile.id < 0 ||
      profile.name.trim().length === 0 ||
      profile.color.trim().length === 0
    ) {
      throw new Error(
        "The new profile is invalid."
      );
    }

    const currentSnapshot =
      remoteSnapshotRef.current;

    if (
      currentSnapshot.profiles.some(
        (candidate) =>
          candidate.id === profile.id
      )
    ) {
      throw new Error(
        "A profile with this id already exists."
      );
    }

    await writeRemoteSnapshot({
      profile: currentSnapshot.profile,
      profiles: [
        ...currentSnapshot.profiles,
        profile,
      ],
    });
  }

  async function deleteProfile(
    id: number
  ): Promise<void> {
    if (authLoading) {
      return;
    }

    if (userId === null) {
      saveLocalProfiles(
        localSnapshot.profiles.filter(
          (profile) => profile.id !== id
        )
      );

      if (
        localSnapshot.profile?.id === id
      ) {
        saveLocalProfile(null);
      }

      return;
    }

    const currentSnapshot =
      remoteSnapshotRef.current;

    const remainingProfiles =
      currentSnapshot.profiles.filter(
        (profile) => profile.id !== id
      );

    if (
      remainingProfiles.length ===
      currentSnapshot.profiles.length
    ) {
      return;
    }

    const nextActiveProfile =
      currentSnapshot.profile?.id === id
        ? null
        : currentSnapshot.profile;

    /*
     * Persist the profile collection and active profile
     * together. The Firestore decoder requires an active
     * profile to exist in the same profiles array.
     */
    await writeRemoteSnapshot({
      profile: nextActiveProfile,
      profiles: remainingProfiles,
    });
  }

  let snapshot = emptyProfileSnapshot();

  /*
   * Do not synchronously reset React state inside the
   * subscription effect. Until the first callback for
   * the current authenticated UID arrives, loading is
   * derived from the absence of matching remote state.
   */
  let loading =
    authLoading ||
    (
      userId !== null &&
      remoteState?.userId !== userId
    );

  let ready = false;
  let saving = false;
  let error: Error | null = null;

  if (
    !authLoading &&
    userId === null
  ) {
    snapshot = localSnapshot;
    loading = false;
    ready = true;
  } else if (
    !authLoading &&
    userId !== null &&
    remoteState?.userId === userId
  ) {
    snapshot = remoteState.snapshot;
    loading =
      remoteState.status === "loading";
    ready =
      remoteState.status === "ready";
    saving = remoteState.saving;
    error = remoteState.error;
  }

  return (
    <ProfileContext.Provider
      value={{
        profile: snapshot.profile,
        profiles: snapshot.profiles,
        loading,
        ready,
        saving,
        error,
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