"use client";

import { useEffect, useState } from "react";
import YouTube from "react-youtube";
import PlayerLoader from "./PlayerLoader";

type MovieTrailerProps = {
  videoKey: string;
  muted: boolean;
  playing: boolean;
  onPlayerReady: (player: any) => void;
};

export default function MovieTrailer({
  videoKey,
  muted,
  playing,
  onPlayerReady,
}: MovieTrailerProps) {
  const [loading, setLoading] = useState(true);
  const [player, setPlayer] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
  }, [videoKey]);

  useEffect(() => {
    if (!player) return;

    if (playing) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }
  }, [playing, player]);

  useEffect(() => {
    if (!player) return;

    if (muted) {
      player.mute();
    } else {
      player.unMute();
      player.setVolume(100);
    }
  }, [muted, player]);

  return (
    <div className="relative w-full h-full overflow-hidden">

      <PlayerLoader loading={loading} />

      <YouTube
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
          onPlayerReady(event.target);

          event.target.mute();
          setLoading(false);
        }}
        className="absolute inset-0 w-full h-full scale-125"
      />

    </div>
  );
}