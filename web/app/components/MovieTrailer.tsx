"use client";

import { useEffect, useState } from "react";
import YouTube, {
  type YouTubePlayer,
} from "react-youtube";
import PlayerLoader from "./PlayerLoader";

type MovieTrailerProps = {
  videoKey: string;
  muted: boolean;
  playing: boolean;
  onPlayerReady: (player: YouTubePlayer) => void;
};

export default function MovieTrailer({
  videoKey,
  muted,
  playing,
  onPlayerReady,
}: MovieTrailerProps) {
  const [player, setPlayer] =
    useState<YouTubePlayer | null>(null);

  const [readyVideoKey, setReadyVideoKey] =
    useState<string | null>(null);

  const loading = readyVideoKey !== videoKey;

  useEffect(() => {
    if (!player) return;

    if (playing) {
      void player.playVideo();
    } else {
      void player.pauseVideo();
    }
  }, [playing, player]);

  useEffect(() => {
    if (!player) return;

    if (muted) {
      void player.mute();
    } else {
      void player.unMute();
      void player.setVolume(100);
    }
  }, [muted, player]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <PlayerLoader loading={loading} />

      <YouTube
        key={videoKey}
        videoId={videoKey}
        opts={{
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            controls: 0,
            loop: 1,
            playlist: videoKey,
            mute: 1,
          },
        }}
        onReady={(event) => {
          setPlayer(event.target);
          setReadyVideoKey(videoKey);
          onPlayerReady(event.target);

          void event.target.mute();
        }}
        className="absolute inset-0 h-full w-full scale-125"
      />
    </div>
  );
}