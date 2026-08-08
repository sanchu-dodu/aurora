"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAuth } from "../components/AuthProvider";
import type { ContinueWatchingMovie } from "../types/media";

import {
  updateContinueWatching as updateLocalContinueWatching,
  useContinueWatching,
} from "./continueWatchingStore";

import {
  subscribeToContinueWatching,
  writeContinueWatching,
} from "./firestoreUserDataService";

const REMOTE_WRITE_INTERVAL_MS = 5000;

export type UserContinueWatchingState = {
  movies: ContinueWatchingMovie[];
  loading: boolean;
  error: Error | null;
  updateMovie: (
    movie: ContinueWatchingMovie
  ) => Promise<void>;
};

type RemoteContinueWatchingState = {
  userId: string;
  movies: ContinueWatchingMovie[];
  error: Error | null;
};

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(
    "Aurora could not synchronize Continue Watching."
  );
}

export function useUserContinueWatching():
  UserContinueWatchingState {
  const localMovies = useContinueWatching();

  const {
    user,
    loading: authLoading,
  } = useAuth();

  const userId = user?.uid ?? null;

  const [
    remoteState,
    setRemoteState,
  ] = useState<RemoteContinueWatchingState | null>(
    null
  );

  const remoteMoviesRef =
    useRef<ContinueWatchingMovie[]>([]);

  const remoteReadyRef = useRef(false);
  const remoteWriteInFlightRef = useRef(false);
  const lastRemoteWriteAtRef = useRef(0);

  /*
   * Remote refs are shared by this hook instance.
   * Bind them to an auth session so an async write
   * from a previous user cannot mutate the next
   * user's Continue Watching state after sign-out
   * or account switching.
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

    remoteMoviesRef.current = [];
    remoteReadyRef.current = false;
    remoteWriteInFlightRef.current = false;
    lastRemoteWriteAtRef.current = 0;

    if (
      authLoading ||
      userId === null
    ) {
      return;
    }

    let active = true;

    const unsubscribe =
      subscribeToContinueWatching(
        userId,
        (movies) => {
          if (
            !active ||
            remoteGenerationRef.current !==
              generation ||
            remoteUserIdRef.current !== userId
          ) {
            return;
          }

          const nextMovies = movies ?? [];

          remoteMoviesRef.current =
            nextMovies;

          remoteReadyRef.current = true;

          setRemoteState({
            userId,
            movies: nextMovies,
            error: null,
          });
        },
        (error) => {
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

  const updateMovie = useCallback(
    async (
      movie: ContinueWatchingMovie
    ): Promise<void> => {
      if (authLoading) {
        return;
      }

      if (userId === null) {
        updateLocalContinueWatching(movie);
        return;
      }

      if (
        !remoteReadyRef.current ||
        remoteUserIdRef.current !== userId
      ) {
        return;
      }

      const generation =
        remoteGenerationRef.current;

      const now = Date.now();

      if (
        remoteWriteInFlightRef.current ||
        now - lastRemoteWriteAtRef.current <
          REMOTE_WRITE_INTERVAL_MS
      ) {
        return;
      }

      const updated = [
        movie,
        ...remoteMoviesRef.current.filter(
          (item) => item.id !== movie.id
        ),
      ].slice(0, 10);

      remoteWriteInFlightRef.current = true;
      lastRemoteWriteAtRef.current = now;

      try {
        await writeContinueWatching(
          userId,
          updated
        );

        if (
          remoteGenerationRef.current !==
            generation ||
          remoteUserIdRef.current !== userId
        ) {
          return;
        }

        remoteMoviesRef.current = updated;

        setRemoteState({
          userId,
          movies: updated,
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

        lastRemoteWriteAtRef.current = 0;

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
            movies:
              remoteMoviesRef.current,
            error,
          };
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
        }
      }
    },
    [
      authLoading,
      userId,
    ]
  );

  const currentRemoteState =
    remoteState?.userId === userId
      ? remoteState
      : null;

  if (userId === null) {
    return {
      movies: localMovies,
      loading: authLoading,
      error: null,
      updateMovie,
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
    updateMovie,
  };
}