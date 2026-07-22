"use client";

import { useEffect, useState } from "react";


type MyListButtonProps = {
  movie: any;
};


export default function MyListButton({
  movie,
}: MyListButtonProps) {

  const [saved, setSaved] = useState(false);


  useEffect(() => {

    const list = JSON.parse(
      localStorage.getItem("aurora-list") || "[]"
    );


    const exists = list.some(
      (item: any) => item.id === movie.id
    );


    setSaved(exists);

  }, [movie.id]);



  function toggleList() {

    const list = JSON.parse(
      localStorage.getItem("aurora-list") || "[]"
    );


    if (saved) {

      const updated = list.filter(
        (item: any) => item.id !== movie.id
      );

      localStorage.setItem(
        "aurora-list",
        JSON.stringify(updated)
      );


      setSaved(false);


    } else {

      list.push(movie);


      localStorage.setItem(
        "aurora-list",
        JSON.stringify(list)
      );


      setSaved(true);

    }

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
        hover:bg-white
        hover:text-black
        transition
      "
    >

      {saved
        ? "✓ Added to My List"
        : "❤️ Add to My List"}

    </button>

  );

}