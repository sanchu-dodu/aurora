"use client";

import { useSyncExternalStore } from "react";
import type { TmdbMovie } from "../types/media";

const STORAGE_KEY = "aurora-list";
const CHANGE_EVENT = "aurora:my-list-change";
const EMPTY_MOVIES: TmdbMovie[] = [];

let cachedRaw: string | null = null;
let cachedMovies: TmdbMovie[] = EMPTY_MOVIES;

function isTmdbMovie(value: unknown): value is TmdbMovie {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const movie = value as Partial<TmdbMovie>;

  return (
    typeof movie.id === "number" &&
    typeof movie.title === "string" &&
    (
      typeof movie.poster_path === "string" ||
      movie.poster_path === null
    )
  );
}

function getSnapshot(): TmdbMovie[] {
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
      ? parsed.filter(isTmdbMovie)
      : EMPTY_MOVIES;
  } catch {
    cachedMovies = EMPTY_MOVIES;
  }

  return cachedMovies;
}

function getServerSnapshot(): TmdbMovie[] {
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

export function useMyList(): TmdbMovie[] {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
}

export function setMyList(movies: TmdbMovie[]): void {
  if (typeof window === "undefined") {
    return;
  }

  const raw = JSON.stringify(movies);

  cachedRaw = raw;
  cachedMovies = movies;

  window.localStorage.setItem(STORAGE_KEY, raw);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}