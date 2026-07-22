"use client";

import { useEffect, useState } from "react";
import YouTube from "react-youtube";
import { Volume2, VolumeX } from "lucide-react";

type Props = {
  movieId: number;
};

export default function HeroTrailer({ movieId }: Props) {
  const [videoKey, setVideoKey] = useState("");
  const [muted, setMuted] = useState(true);
  const [player, setPlayer] = useState<any>(null);

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

  if (!videoKey) return null;

  return (
    <>
      <div className="absolute inset-0 animate-fadeIn">
        <YouTube
          videoId={videoKey}
          onReady={(event) => {
            setPlayer(event.target);

            if (muted) {
              event.target.mute();
            }
          }}
          opts={{
            width: "100%",
            height: "100%",
            playerVars: {
              autoplay: 1,
              controls: 0,
              mute: 1,
              loop: 1,
              playlist: videoKey,
              rel: 0,
              modestbranding: 1,
            },
          }}
          className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 scale-[1.6] pointer-events-none"
        />
      </div>

      <button
        onClick={() => {
          if (!player) return;

          if (muted) {
            player.unMute();
          } else {
            player.mute();
          }

          setMuted(!muted);
        }}
        className="
          absolute
          bottom-8
          right-8
          z-50
          rounded-full
          bg-black/60
          p-4
          backdrop-blur
          transition
          hover:bg-black
        "
      >
        {muted ? (
          <VolumeX size={22} />
        ) : (
          <Volume2 size={22} />
        )}
      </button>
    </>
  );
}