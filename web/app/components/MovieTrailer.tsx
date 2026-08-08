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

async function runOnAttachedPlayer(
  player: YouTubePlayer,
  action: (
    player: YouTubePlayer
  ) => void | Promise<void>
): Promise<void> {
  try {
    const iframe = await player.getIframe();

    if (!iframe?.isConnected) {
      return;
    }

    await action(player);
  } catch {
    /*
     * react-youtube can briefly retain a player object after
     * its iframe has been detached during a React lifecycle
     * transition. Player commands are therefore best-effort.
     */
  }
}

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

    void runOnAttachedPlayer(
      player,
      async (attachedPlayer) => {
        if (playing) {
          await attachedPlayer.playVideo();
        } else {
          await attachedPlayer.pauseVideo();
        }
      }
    );
  }, [playing, player]);

  useEffect(() => {
    if (!player) return;

    void runOnAttachedPlayer(
      player,
      async (attachedPlayer) => {
        if (muted) {
          await attachedPlayer.mute();
          return;
        }

        await attachedPlayer.unMute();
        await attachedPlayer.setVolume(100);
      }
    );
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

          void runOnAttachedPlayer(
            event.target,
            (attachedPlayer) =>
              attachedPlayer.mute()
          );
        }}
        className="absolute inset-0 h-full w-full scale-125"
      />
    </div>
  );
}