"use client";

import { useSyncExternalStore } from "react";
import type { ContinueWatchingMovie } from "../types/media";

const STORAGE_KEY = "aurora-progress";
const CHANGE_EVENT = "aurora:continue-watching-change";
const EMPTY_MOVIES: ContinueWatchingMovie[] = [];

let cachedRaw: string | null = null;
let cachedMovies: ContinueWatchingMovie[] = EMPTY_MOVIES;

function isContinueWatchingMovie(
  value: unknown
): value is ContinueWatchingMovie {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const movie = value as Partial<ContinueWatchingMovie>;

  return (
    typeof movie.id === "number" &&
    typeof movie.title === "string" &&
    typeof movie.poster === "string" &&
    typeof movie.progress === "number" &&
    typeof movie.duration === "number"
  );
}

function getSnapshot(): ContinueWatchingMovie[] {
  if (typeof window === "undefined") {
    return EMPTY_MOVIES;
  }

  const raw =
    window.localStorage.getItem(STORAGE_KEY) ?? "[]";

  if (raw === cachedRaw) {
    return cachedMovies;
  }

  cachedRaw = raw;

  try {
    const parsed: unknown = JSON.parse(raw);

    cachedMovies = Array.isArray(parsed)
      ? parsed.filter(isContinueWatchingMovie)
      : EMPTY_MOVIES;
  } catch {
    cachedMovies = EMPTY_MOVIES;
  }

  return cachedMovies;
}

function getServerSnapshot(): ContinueWatchingMovie[] {
  return EMPTY_MOVIES;
}

function subscribe(callback: () => void): () => void {
  function handleStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY) {
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

function saveContinueWatching(
  movies: ContinueWatchingMovie[]
): void {
  if (typeof window === "undefined") {
    return;
  }

  const raw = JSON.stringify(movies);

  cachedRaw = raw;
  cachedMovies = movies;

  window.localStorage.setItem(STORAGE_KEY, raw);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useContinueWatching():
  ContinueWatchingMovie[] {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
}

export function updateContinueWatching(
  movie: ContinueWatchingMovie
): void {
  const current = getSnapshot();

  const updated = [
    movie,
    ...current.filter((item) => item.id !== movie.id),
  ].slice(0, 10);

  saveContinueWatching(updated);
}