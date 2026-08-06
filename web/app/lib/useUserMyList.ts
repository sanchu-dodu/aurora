"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { useAuth } from "../components/AuthProvider";
import type { TmdbMovie } from "../types/media";

import {
  setMyList,
  useMyList,
} from "./myListStore";

import {
  subscribeToMyList,
  writeMyList,
} from "./firestoreUserDataService";

export type UserMyListState = {
  movies: TmdbMovie[];
  loading: boolean;
  error: Error | null;
  setMovies: (
    movies: TmdbMovie[]
  ) => Promise<void>;
};

type RemoteMyListState = {
  userId: string;
  movies: TmdbMovie[];
  error: Error | null;
};

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(
    "Aurora could not synchronize My List."
  );
}

export function useUserMyList():
  UserMyListState {
  const localMovies = useMyList();
  const {
    user,
    loading: authLoading,
  } = useAuth();

  const userId = user?.uid ?? null;

  const [
    remoteState,
    setRemoteState,
  ] = useState<RemoteMyListState | null>(
    null
  );

  useEffect(() => {
    if (
      authLoading ||
      userId === null
    ) {
      return;
    }

    let active = true;

    const unsubscribe = subscribeToMyList(
      userId,
      (movies) => {
        if (!active) {
          return;
        }

        setRemoteState({
          userId,
          movies: movies ?? [],
          error: null,
        });
      },
      (error) => {
        if (!active) {
          return;
        }

        setRemoteState({
          userId,
          movies: [],
          error,
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

  const currentRemoteState =
    remoteState?.userId === userId
      ? remoteState
      : null;

  const saveMovies = useCallback(
    async (
      movies: TmdbMovie[]
    ): Promise<void> => {
      if (authLoading) {
        throw new Error(
          "Authentication is still loading."
        );
      }

      if (userId === null) {
        setMyList(movies);
        return;
      }

      try {
        await writeMyList(
          userId,
          movies
        );

        setRemoteState({
          userId,
          movies,
          error: null,
        });
      } catch (value) {
        const error = toError(value);

        setRemoteState((currentState) => {
          if (
            currentState?.userId === userId
          ) {
            return {
              ...currentState,
              error,
            };
          }

          return {
            userId,
            movies: [],
            error,
          };
        });

        throw error;
      }
    },
    [
      authLoading,
      userId,
    ]
  );

  if (userId === null) {
    return {
      movies: localMovies,
      loading: authLoading,
      error: null,
      setMovies: saveMovies,
    };
  }

  return {
    movies:
      currentRemoteState?.movies ?? [],
    loading:
      authLoading ||
      currentRemoteState === null,
    error:
      currentRemoteState?.error ?? null,
    setMovies: saveMovies,
  };
}