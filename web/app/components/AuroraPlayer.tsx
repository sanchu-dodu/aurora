"use client";

import { useEffect, useState } from "react";
import type { YouTubePlayer } from "react-youtube";
import MovieTrailer from "./MovieTrailer";
import AuroraIntro from "./AuroraIntro";
import PlayerControls from "./PlayerControls";
import { useUserContinueWatching } from "../lib/useUserContinueWatching";

type AuroraPlayerProps = {
  videoKey: string;
  title: string;
  movieId: number;
  poster: string;
};

export default function AuroraPlayer({
  videoKey,
  title,
  movieId,
  poster,
}: AuroraPlayerProps) {
  const {
    updateMovie: updateContinueWatching,
  } = useUserContinueWatching();

  const [muted, setMuted] = useState(true);
  const [cinemaMode, setCinemaMode] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [player, setPlayer] =
    useState<YouTubePlayer | null>(null);

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!player) return;

    let cancelled = false;

    async function updateProgress() {
      try {
        const [current, total] = await Promise.all([
          player.getCurrentTime(),
          player.getDuration(),
        ]);

        if (cancelled) return;

        setProgress(current);
        setDuration(total);

        if (total <= 0) return;

        await updateContinueWatching({
          id: movieId,
          title,
          poster,
          progress: current,
          duration: total,
        });
      } catch (error) {
        if (!cancelled) {
          console.error(
            "Unable to update playback progress.",
            error
          );
        }
      }
    }

    void updateProgress();

    const interval = window.setInterval(() => {
      void updateProgress();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    player,
    movieId,
    title,
    poster,
    updateContinueWatching,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCinemaMode(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, []);

  return (
    <div
      className={`relative overflow-hidden bg-black transition-all duration-700 ${
        cinemaMode
          ? "fixed inset-0 z-[9999] h-screen w-screen"
          : "h-full w-full"
      }`}
    >
      <MovieTrailer
        videoKey={videoKey}
        muted={muted}
        playing={playing}
        onPlayerReady={(ytPlayer) => {
          setPlayer(ytPlayer);
          void ytPlayer.mute();
        }}
      />

      <div className="absolute inset-0 z-10 bg-gradient-to-r from-blue-600/10 via-transparent to-cyan-500/10" />

      <div className="absolute inset-0 z-10 bg-gradient-to-b from-transparent via-transparent to-[#070B14]" />

      <AuroraIntro />

      <div
        className={`absolute inset-0 transition-all duration-700 ${
          cinemaMode
            ? "bg-black/60"
            : "bg-gradient-to-t from-[#070B14] via-black/20 to-transparent"
        }`}
      />

      <div className="absolute left-8 top-8 z-20">
        <h1 className="text-4xl font-black tracking-widest text-white">
          AURORA
        </h1>

        <p className="text-blue-400">
          Where Stories Shine
        </p>
      </div>

      <div className="absolute bottom-20 left-10 z-20 max-w-4xl">
        <h2 className="text-6xl font-black drop-shadow-lg">
          {title}
        </h2>
      </div>

      <PlayerControls
        key={cinemaMode ? "cinema" : "standard"}
        muted={muted}
        cinemaMode={cinemaMode}
        playing={playing}
        progress={progress}
        duration={duration}
        onToggleMute={() => {
          if (!player) return;

          if (muted) {
            void player.unMute();
            void player.setVolume(100);
          } else {
            void player.mute();
          }

          setMuted((current) => !current);
        }}
        onToggleCinema={() => {
          setCinemaMode((current) => !current);
        }}
        onTogglePlay={() => {
          if (!player) return;

          if (playing) {
            void player.pauseVideo();
          } else {
            void player.playVideo();
          }

          setPlaying((current) => !current);
        }}
        onSeekBackward={async () => {
          if (!player) return;

          const current =
            await player.getCurrentTime();

          await player.seekTo(
            Math.max(current - 10, 0),
            true
          );
        }}
        onSeekForward={async () => {
          if (!player) return;

          const current =
            await player.getCurrentTime();

          await player.seekTo(
            current + 10,
            true
          );
        }}
        onSeek={(time) => {
          if (!player) return;

          void player.seekTo(time, true);
          setProgress(time);
        }}
      />
    </div>
  );
}