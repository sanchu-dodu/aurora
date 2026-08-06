"use client";

import type { Unsubscribe } from "firebase/firestore";

import type {
  ContinueWatchingMovie,
  TmdbMovie,
} from "../types/media";

import {
  USER_DATA_KEYS,
  readUserData,
  subscribeToUserData,
  writeUserData,
  type UserDataErrorListener,
  type UserDataListener,
} from "./firestoreUserData";

import {
  decodeContinueWatchingData,
  decodeMyListData,
  decodeProfilesData,
  type FirestoreProfilesData,
} from "./firestoreUserDataModels";

export function readMyList(
  userId: string
): Promise<TmdbMovie[] | null> {
  return readUserData(
    userId,
    USER_DATA_KEYS.MY_LIST,
    decodeMyListData
  );
}

export function writeMyList(
  userId: string,
  movies: TmdbMovie[]
): Promise<void> {
  return writeUserData(
    userId,
    USER_DATA_KEYS.MY_LIST,
    movies
  );
}

export function subscribeToMyList(
  userId: string,
  onValue: UserDataListener<TmdbMovie[]>,
  onError?: UserDataErrorListener
): Unsubscribe {
  return subscribeToUserData(
    userId,
    USER_DATA_KEYS.MY_LIST,
    decodeMyListData,
    onValue,
    onError
  );
}

export function readContinueWatching(
  userId: string
): Promise<ContinueWatchingMovie[] | null> {
  return readUserData(
    userId,
    USER_DATA_KEYS.CONTINUE_WATCHING,
    decodeContinueWatchingData
  );
}

export function writeContinueWatching(
  userId: string,
  movies: ContinueWatchingMovie[]
): Promise<void> {
  return writeUserData(
    userId,
    USER_DATA_KEYS.CONTINUE_WATCHING,
    movies
  );
}

export function subscribeToContinueWatching(
  userId: string,
  onValue:
    UserDataListener<ContinueWatchingMovie[]>,
  onError?: UserDataErrorListener
): Unsubscribe {
  return subscribeToUserData(
    userId,
    USER_DATA_KEYS.CONTINUE_WATCHING,
    decodeContinueWatchingData,
    onValue,
    onError
  );
}

export function readProfiles(
  userId: string
): Promise<FirestoreProfilesData | null> {
  return readUserData(
    userId,
    USER_DATA_KEYS.PROFILES,
    decodeProfilesData
  );
}

export function writeProfiles(
  userId: string,
  profilesData: FirestoreProfilesData
): Promise<void> {
  return writeUserData(
    userId,
    USER_DATA_KEYS.PROFILES,
    profilesData
  );
}

export function subscribeToProfiles(
  userId: string,
  onValue:
    UserDataListener<FirestoreProfilesData>,
  onError?: UserDataErrorListener
): Unsubscribe {
  return subscribeToUserData(
    userId,
    USER_DATA_KEYS.PROFILES,
    decodeProfilesData,
    onValue,
    onError
  );
}