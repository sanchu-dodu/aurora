"use client";

import { useEffect, useState } from "react";

export default function AuroraIntro() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-[#070B14] transition-all duration-1000 ${
        show
          ? "opacity-100"
          : "pointer-events-none opacity-0"
      }`}
    >
      <div className="text-center">

        <h1
          className="
            animate-pulse
            text-8xl
            font-black
            tracking-[0.5rem]
            text-blue-500
            drop-shadow-[0_0_40px_rgba(59,130,246,0.8)]
          "
        >
          AURORA
        </h1>

        <p className="mt-5 text-2xl text-blue-300">
          Where Stories Shine
        </p>

        <div className="mx-auto mt-10 h-1 w-80 overflow-hidden rounded-full bg-white/10">
          <div className="h-full animate-loader rounded-full bg-blue-500" />
        </div>

      </div>
    </div>
  );
}