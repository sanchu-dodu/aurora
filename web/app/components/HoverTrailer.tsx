"use client";

import { useEffect, useRef, useState } from "react";
import YouTube, { YouTubeProps } from "react-youtube";
import { Volume2, VolumeX } from "lucide-react";

type HoverTrailerProps = {
  movieId: number;
};

export default function HoverTrailer({
  movieId,
}: HoverTrailerProps) {
  const [videoKey, setVideoKey] = useState("");
  const [muted, setMuted] = useState(true);

  const playerRef = useRef<any>(null);

  useEffect(() => {
    async function loadTrailer() {
      try {
        const res = await fetch(`/api/trailer?id=${movieId}`);
        const data = await res.json();

        if (data?.key) {
          setVideoKey(data.key);
        }
      } catch (err) {
        console.error(err);
      }
    }

    loadTrailer();
  }, [movieId]);

  const onReady: YouTubeProps["onReady"] = (event) => {
    playerRef.current = event.target;
    event.target.mute();
  };

  function toggleMute(
    e: React.MouseEvent<HTMLButtonElement>
  ) {
    e.preventDefault();
    e.stopPropagation();

    if (!playerRef.current) return;

    if (muted) {
      playerRef.current.unMute();
    } else {
      playerRef.current.mute();
    }

    setMuted(!muted);
  }

  if (!videoKey) return null;

  return (
    <div className="relative h-full w-full">

      <YouTube
        videoId={videoKey}
        onReady={onReady}
        opts={{
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            controls: 0,
            mute: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
        }}
        className="absolute inset-0"
      />

      <button
        onClick={toggleMute}
        className="
          absolute
          bottom-3
          right-3
          z-50
          rounded-full
          bg-black/70
          p-3
          text-white
          backdrop-blur
          transition
          hover:bg-black
        "
      >
        {muted ? (
          <VolumeX size={18} />
        ) : (
          <Volume2 size={18} />
        )}
      </button>

    </div>
  );
}