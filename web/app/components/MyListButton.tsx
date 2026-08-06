"use client";

import { useState } from "react";

import type { TmdbMovie } from "../types/media";
import { useUserMyList } from "../lib/useUserMyList";

type MyListButtonProps = {
  movie: TmdbMovie;
};

export default function MyListButton({
  movie,
}: MyListButtonProps) {
  const {
    movies,
    loading,
    error,
    setMovies,
  } = useUserMyList();

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] =
    useState<string | null>(null);

  const saved = movies.some(
    (item) => item.id === movie.id
  );

  async function toggleList() {
    if (loading || saving) {
      return;
    }

    setSaving(true);
    setActionError(null);

    const updatedMovies = saved
      ? movies.filter(
          (item) => item.id !== movie.id
        )
      : [
          movie,
          ...movies.filter(
            (item) => item.id !== movie.id
          ),
        ];

    try {
      await setMovies(updatedMovies);
    } catch {
      setActionError(
        "Aurora could not update My List."
      );
    } finally {
      setSaving(false);
    }
  }

  const synchronizationError =
    actionError ??
    (error
      ? "Aurora could not synchronize My List."
      : null);

  let buttonLabel = saved
    ? "✓ Added to My List"
    : "+ Add to My List";

  if (loading) {
    buttonLabel = "Loading My List...";
  } else if (saving) {
    buttonLabel = "Saving...";
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void toggleList();
        }}
        disabled={loading || saving}
        aria-busy={loading || saving}
        aria-pressed={saved}
        className="
          rounded-xl
          border
          border-white
          px-8
          py-4
          transition
          hover:bg-white
          hover:text-black
          disabled:cursor-not-allowed
          disabled:opacity-60
        "
      >
        {buttonLabel}
      </button>

      {synchronizationError && (
        <p
          role="alert"
          className="mt-3 text-sm text-red-400"
        >
          {synchronizationError}
        </p>
      )}
    </div>
  );
}