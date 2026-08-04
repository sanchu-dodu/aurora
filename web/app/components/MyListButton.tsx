"use client";

import type { TmdbMovie } from "../types/media";
import {
  setMyList,
  useMyList,
} from "../lib/myListStore";

type MyListButtonProps = {
  movie: TmdbMovie;
};

export default function MyListButton({
  movie,
}: MyListButtonProps) {
  const list = useMyList();

  const saved = list.some(
    (item) => item.id === movie.id
  );

  function toggleList() {
    if (saved) {
      setMyList(
        list.filter((item) => item.id !== movie.id)
      );

      return;
    }

    setMyList([
      movie,
      ...list.filter((item) => item.id !== movie.id),
    ]);
  }

  return (
    <button
      onClick={toggleList}
      className="
        rounded-xl
        border
        border-white
        px-8
        py-4
        transition
        hover:bg-white
        hover:text-black
      "
    >
      {saved
        ? "✓ Added to My List"
        : "+ Add to My List"}
    </button>
  );
}