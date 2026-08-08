"use client";

import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type DocumentSnapshot,
  type FirestoreError,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "./firebase";

export const USER_DATA_KEYS = {
  MY_LIST: "my-list",
  CONTINUE_WATCHING: "continue-watching",
  PROFILES: "profiles",
} as const;

export type UserDataKey =
  (typeof USER_DATA_KEYS)[keyof typeof USER_DATA_KEYS];

export type UserDataDecoder<T> = (
  value: unknown
) => T | null;

export type UserDataListener<T> = (
  value: T | null
) => void;

export type UserDataErrorListener = (
  error: FirestoreError
) => void;

const USER_DATA_SCHEMA_VERSION = 1;

type StoredUserData = {
  schemaVersion?: unknown;
  value?: unknown;
};

function normalizeUserId(userId: string): string {
  const normalizedUserId = userId.trim();

  if (
    normalizedUserId.length === 0 ||
    normalizedUserId.includes("/")
  ) {
    throw new Error(
      "A valid Firebase user ID is required."
    );
  }

  return normalizedUserId;
}

function getUserDataDocument(
  userId: string,
  key: UserDataKey
) {
  return doc(
    db,
    "users",
    normalizeUserId(userId),
    "data",
    key
  );
}

function decodeStoredData<T>(
  data: DocumentData,
  decoder: UserDataDecoder<T>
): T | null {
  const storedData = data as StoredUserData;

  if (
    storedData.schemaVersion !==
      USER_DATA_SCHEMA_VERSION ||
    !Object.prototype.hasOwnProperty.call(
      storedData,
      "value"
    )
  ) {
    return null;
  }

  return decoder(storedData.value);
}

function toJsonSafeValue(value: unknown): unknown {
  let serializedValue: string | undefined;

  try {
    serializedValue = JSON.stringify(value);
  } catch {
    throw new Error(
      "Aurora user data must be JSON serializable."
    );
  }

  if (serializedValue === undefined) {
    throw new Error(
      "Aurora user data cannot be undefined."
    );
  }

  return JSON.parse(serializedValue) as unknown;
}

export async function readUserData<T>(
  userId: string,
  key: UserDataKey,
  decoder: UserDataDecoder<T>
): Promise<T | null> {
  const snapshot = await getDoc(
    getUserDataDocument(userId, key)
  );

  if (!snapshot.exists()) {
    return null;
  }

  return decodeStoredData(
    snapshot.data(),
    decoder
  );
}

export async function writeUserData(
  userId: string,
  key: UserDataKey,
  value: unknown
): Promise<void> {
  const jsonSafeValue = toJsonSafeValue(value);

  await setDoc(
    getUserDataDocument(userId, key),
    {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      value: jsonSafeValue,
      updatedAt: serverTimestamp(),
    }
  );
}

export function subscribeToUserData<T>(
  userId: string,
  key: UserDataKey,
  decoder: UserDataDecoder<T>,
  onValue: UserDataListener<T>,
  onError?: UserDataErrorListener
): Unsubscribe {
  const reference = getUserDataDocument(
    userId,
    key
  );

  const handleSnapshot = (
    snapshot: DocumentSnapshot<DocumentData>
  ) => {
    if (!snapshot.exists()) {
      onValue(null);
      return;
    }

    onValue(
      decodeStoredData(
        snapshot.data(),
        decoder
      )
    );
  };

  if (onError) {
    return onSnapshot(
      reference,
      handleSnapshot,
      onError
    );
  }

  return onSnapshot(
    reference,
    handleSnapshot
  );
}