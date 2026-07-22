"use client";

type PlayerLoaderProps = {
  loading: boolean;
};

export default function PlayerLoader({
  loading,
}: PlayerLoaderProps) {
  if (!loading) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#070B14]">

      <div className="h-20 w-20 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />

      <h1 className="mt-10 text-5xl font-black tracking-[0.3rem]">
        AURORA
      </h1>

      <p className="mt-4 text-blue-400 text-xl">
        Preparing Your Cinema...
      </p>

    </div>
  );
}