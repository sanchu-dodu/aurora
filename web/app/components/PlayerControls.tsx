"use client";

import { useEffect, useState } from "react";

type PlayerControlsProps = {
  muted: boolean;
  cinemaMode: boolean;
  playing: boolean;

  progress: number;
  duration: number;

  onToggleMute: () => void;
  onToggleCinema: () => void;
  onTogglePlay: () => void;

  onSeekBackward: () => void;
  onSeekForward: () => void;

  onSeek?: (time: number) => void;
};

export default function PlayerControls({
  muted,
  cinemaMode,
  playing,
  progress,
  duration,
  onToggleMute,
  onToggleCinema,
  onTogglePlay,
  onSeekBackward,
  onSeekForward,
  onSeek,
}: PlayerControlsProps) {
  const [visible, setVisible] = useState(true);
  const controlsVisible = !cinemaMode || visible;

  useEffect(() => {
    if (!cinemaMode || !visible) return;

    const timer = window.setTimeout(() => {
      setVisible(false);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [cinemaMode, visible]);

  return (
    <div
      onMouseMove={() => setVisible(true)}
      className={`absolute bottom-8 left-8 right-8 z-40 transition-all duration-500 ${
        controlsVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Timeline */}
      <input
        type="range"
        min={0}
        max={duration}
        value={progress}
        onChange={(e) => onSeek?.(Number(e.target.value))}
        className="w-full mb-5"
      />

      <div className="flex gap-4 justify-end flex-wrap">
        <button
          onClick={onToggleMute}
          className="rounded-2xl bg-white/10 px-5 py-3 backdrop-blur-xl hover:bg-white/20"
        >
          {muted ? "🔇 Enable Sound" : "🔊 Sound On"}
        </button>

        <button
          onClick={onSeekBackward}
          className="rounded-2xl bg-white/10 px-5 py-3 backdrop-blur-xl hover:bg-white/20"
        >
          ⏪ 10s
        </button>

        <button
          onClick={onTogglePlay}
          className="rounded-2xl bg-blue-600 px-6 py-3 hover:bg-blue-500"
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>

        <button
          onClick={onSeekForward}
          className="rounded-2xl bg-white/10 px-5 py-3 backdrop-blur-xl hover:bg-white/20"
        >
          10s ⏩
        </button>

        <button
          onClick={onToggleCinema}
          className="rounded-2xl bg-white/10 px-5 py-3 backdrop-blur-xl hover:bg-white/20"
        >
          {cinemaMode ? "❌ Exit Cinema" : "⛶ Cinema"}
        </button>
      </div>
    </div>
  );
}