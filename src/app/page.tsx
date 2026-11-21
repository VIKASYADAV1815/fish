"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  Upload,
  Sparkles,
  ChevronDown,
  PlayCircle,
  CornerDownLeft,
  Newspaper,
  Paperclip,
  FileText,
  Video,
  LayoutGrid,
} from "lucide-react";

const PondWater = dynamic(() => import("@/components/PondWater"), {
  ssr: false,
});

const QUICK_ACTIONS = [
  {
    label: "Write a Newsletter",
    icon: Newspaper,
    prompt: "Write a weekly newsletter summarizing the key insights from this recording...",
  },
  {
    label: "Show Notes",
    icon: Paperclip,
    prompt: "Create structured podcast show notes with timestamps and highlights...",
  },
  {
    label: "Blog Post",
    icon: FileText,
    prompt: "Draft an engaging, well-structured blog post based on the main topic...",
  },
  {
    label: "Video Script",
    icon: Video,
    prompt: "Turn these ideas into a concise, high-retention short video script...",
  },
  {
    label: "LinkedIn Post",
    icon: LayoutGrid,
    prompt: "Write a thought-provoking LinkedIn post with a strong hook and takeaway...",
  },
];

function BrandGlyph({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Minimal flowing wave + zenith spark mark */}
      <path d="M3.5 14.5C6 11.5 9.5 11.5 12 14.5C14.5 17.5 18 17.5 20.5 14.5" />
      <path d="M5.5 9.5C7.8 7 10.5 7 12.8 9.5C14.8 11.7 17.2 11.7 19.2 9.5" opacity="0.65" />
      <circle cx="17.5" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

type WavePacket = {
  x: number;
  y: number;
  t0: number;
  amp: number;
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [space, setSpace] = useState("Select space");
  const navBtnRef = useRef<HTMLButtonElement>(null);

  const handleSpaceCycle = () => {
    const spaces = ["Select space", "Personal Studio", "Product Team", "Content Lab"];
    const next = spaces[(spaces.indexOf(space) + 1) % spaces.length];
    setSpace(next);
  };

  // Moves ONLY the top-right navbar button's subtle shadow (--sx, --sy) when ripples pass underneath
  useEffect(() => {
    const waves: WavePacket[] = [];
    let lastPos = { x: -999, y: -999, t: 0 };

    const spawnWave = (x: number, y: number, amp: number) => {
      const now = performance.now() / 1000;
      waves.push({ x, y, t0: now, amp });
      if (waves.length > 24) waves.shift();
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now() / 1000;
      const dx = e.clientX - lastPos.x;
      const dy = e.clientY - lastPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 14 && now - lastPos.t > 0.035) {
        const speedAmp = Math.min(dist / 60, 1.2);
        spawnWave(e.clientX, e.clientY, 0.7 + speedAmp * 0.65);
        lastPos = { x: e.clientX, y: e.clientY, t: now };
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      spawnWave(e.clientX, e.clientY, 1.6);
    };

    const onWheel = () => {
      spawnWave(
        window.innerWidth * (0.3 + Math.random() * 0.4),
        window.innerHeight * (0.3 + Math.random() * 0.4),
        1.1
      );
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });

    let reqId = 0;
    const loop = (nowMs: number) => {
      const now = nowMs / 1000;
      while (waves.length > 0 && now - waves[0].t0 > 2.4) {
        waves.shift();
      }

      const el = navBtnRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;

        let sx = 0;
        let sy = 0;

        for (let i = 0; i < waves.length; i++) {
          const w = waves[i];
          const age = now - w.t0;
          if (age < 0 || age > 2.4) continue;

          const dx = cx - w.x;
          const dy = cy - w.y;
          const dist = Math.hypot(dx, dy);
          const waveRadius = age * 330;
          const band = dist - waveRadius;
          const sigma = 110;

          if (Math.abs(band) < sigma * 2.2) {
            const env =
              Math.exp(-(band * band) / (2 * sigma * sigma)) *
              Math.exp(-age * 1.2) *
              Math.exp(-dist / 650) *
              w.amp;

            const slope = -Math.sin(band * 0.055) * env;
            const nx = dist > 1 ? dx / dist : 0;
            const ny = dist > 1 ? dy / dist : 1;

            sx += nx * slope * 3.5;
            sy += ny * slope * 3.5;
          }
        }

        sx = Math.max(-4, Math.min(4, sx));
        sy = Math.max(-4, Math.min(4, sy));

        el.style.setProperty("--sx", `${sx.toFixed(2)}px`);
        el.style.setProperty("--sy", `${sy.toFixed(2)}px`);
      }

      reqId = requestAnimationFrame(loop);
    };

    reqId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(reqId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <main className="relative w-screen h-[100dvh] overflow-hidden bg-[#F9FAF4] select-none">
      {/* Interactive Top-Shot Water + Koi Background */}
      <PondWater />

      {/* UI Overlay Layer */}
      <div className="relative z-10 flex flex-col justify-between w-full h-full pointer-events-none">
        {/* 1. Free-floating Minimal Navbar (compact on mobile, untouched on desktop) */}
        <header className="w-full px-4 pt-3.5 sm:px-12 sm:pt-6">
          <nav className="mx-auto max-w-[1220px] flex items-center justify-between">
            {/* Brand */}
            <a href="#" className="flex items-center gap-2 sm:gap-2.5 group pointer-events-auto">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-[8px] sm:rounded-[9px] bg-[#121212] text-white flex items-center justify-center transition-transform group-hover:scale-105">
                <BrandGlyph className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <span className="text-[13.5px] sm:text-[15px] font-medium tracking-[-0.025em] text-neutral-900">
                Nami
              </span>
            </a>

            {/* Minimal Center Nav Links */}
            <div className="hidden md:flex items-center gap-8 text-[13px] font-normal tracking-[-0.01em] text-neutral-600 pointer-events-auto">
              <a href="#workspace" className="text-neutral-900 transition-colors">
                Workspace
              </a>
              <a href="#recordings" className="hover:text-neutral-900 transition-colors">
                Recordings
              </a>
              <a href="#templates" className="hover:text-neutral-900 transition-colors">
                Templates
              </a>
              <a href="#pricing" className="hover:text-neutral-900 transition-colors">
                Pricing
              </a>
            </div>

            {/* Right Action (subtle shadow ONLY on the top-right corner button) */}
            <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
              <button className="inline-flex px-2 py-1 sm:px-2.5 sm:py-1.5 text-[11.5px] sm:text-[12.5px] font-normal text-neutral-600 hover:text-neutral-900 transition-colors">
                Sign in
              </button>
              <button
                ref={navBtnRef}
                className="px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-[8px] sm:rounded-[10px] bg-[#141414] hover:bg-neutral-800 text-white text-[11px] sm:text-[12px] font-medium tracking-[-0.01em] pond-shadow-nav-btn transition-all"
              >
                New Space
              </button>
            </div>
          </nav>
        </header>

        {/* 2. Light 300-Weight Minimal Hero Heading & Subheading (compact on mobile, untouched on desktop) */}
        <div className="px-4 sm:px-6 flex flex-col items-center text-center -mt-4 sm:-mt-7">
          <div className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/45 text-[9.5px] sm:text-[10.5px] font-normal tracking-[0.08em] uppercase text-neutral-600 mb-6 sm:mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-800" />
            <span>Quiet Intelligence for Creators</span>
          </div>

          <h1 className="max-w-[330px] sm:max-w-[660px] text-[25px] sm:text-[44px] md:text-[52px] leading-[1.14] sm:leading-[1.1] font-light tracking-[-0.03em] text-neutral-900">
            Where fleeting thoughts flow into timeless stories.
          </h1>

          <p className="mt-2 sm:mt-3.5 max-w-[300px] sm:max-w-[450px] text-[12px] sm:text-[14px] leading-snug sm:leading-relaxed font-light tracking-[-0.01em] text-neutral-600/90">
            Drop a voice note, recording, or raw idea into calm waters—Nami shapes it into
            polished newsletters, scripts, and essays in seconds.
          </p>
        </div>

        {/* 3. Glassmorphic AI Prompt Box at Bottom (compact on small screens, untouched on desktop) */}
        <section className="w-full px-3 pb-3 sm:px-6 sm:pb-7 flex flex-col items-center">
          <div className="w-full max-w-[540px] pointer-events-auto">
            {/* Compact Greeting Row */}
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2 pl-1">
              <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-[6px] sm:rounded-[7px] bg-[#121212] text-white flex items-center justify-center">
                <BrandGlyph className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              </div>
              <span className="text-[13px] sm:text-[15px] font-normal tracking-[-0.02em] text-neutral-900">
                Good afternoon, Blaine
              </span>
            </div>

            {/* Outer Wrapper (no outer border or shadow) */}
            <div className="relative">
              {/* Inner Frosted Glass Prompt Card */}
              <div className="rounded-[12px] sm:rounded-[14px] bg-white/45 backdrop-blur-[12px] border border-neutral-900/[0.09] shadow-[0_2px_10px_-2px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] px-2.5 pt-1.5 pb-1.5 sm:px-3 sm:pt-2 sm:pb-2">
                {/* Top Controls Toolbar */}
                <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
                  {/* Upload Recording Pill */}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-[6px] sm:rounded-[7px] bg-white/65 hover:bg-white/90 backdrop-blur-sm border border-neutral-900/[0.09] shadow-[0_1px_2px_rgba(15,23,42,0.04)] text-[10px] sm:text-[11px] font-medium tracking-[-0.01em] text-neutral-800 whitespace-nowrap transition-all"
                  >
                    <Upload className="w-2.5 h-2.5 text-neutral-700 stroke-[2]" />
                    <span>Upload Recording</span>
                  </button>

                  {/* Select space dropdown */}
                  <button
                    type="button"
                    onClick={handleSpaceCycle}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-neutral-900/[0.04] text-[10px] sm:text-[11px] font-normal tracking-[-0.01em] text-neutral-600 hover:text-neutral-900 whitespace-nowrap transition-colors"
                  >
                    <Sparkles className="w-2.5 h-2.5 text-neutral-500" />
                    <span>{space}</span>
                    <ChevronDown className="w-2.5 h-2.5 text-neutral-500" />
                  </button>

                  {/* No recording selected dropdown */}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-neutral-900/[0.04] text-[10px] sm:text-[11px] font-normal tracking-[-0.01em] text-neutral-600 hover:text-neutral-900 whitespace-nowrap transition-colors"
                  >
                    <PlayCircle className="w-2.5 h-2.5 text-neutral-600" />
                    <span>No recording selected</span>
                    <ChevronDown className="w-2.5 h-2.5 text-neutral-500" />
                  </button>
                </div>

                {/* Compact Prompt Input Area */}
                <div className="mt-1 sm:mt-1.5 mb-0.5">
                  <textarea
                    rows={1}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Type to create content ex: blog post, newsletter.."
                    className="w-full min-h-[22px] sm:min-h-[26px] bg-transparent resize-none border-0 focus:outline-none text-[12px] sm:text-[13px] leading-relaxed font-light tracking-[-0.01em] text-neutral-800 placeholder:text-neutral-500/80 select-text"
                  />
                </div>

                {/* Bottom-Right Generate Button */}
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-[7px] sm:rounded-[8px] bg-[#121212]/90 hover:bg-[#121212] active:scale-[0.98] text-white text-[10px] sm:text-[11px] font-medium tracking-[-0.01em] transition-all"
                  >
                    <CornerDownLeft className="w-2.5 h-2.5 text-white/80" />
                    <span>Generate</span>
                  </button>
                </div>
              </div>

              {/* Bottom Quick-Action Suggestion Pills Row — strictly single line on all devices */}
              <div className="mt-1 sm:mt-1.5 flex flex-nowrap items-center justify-between sm:justify-center gap-1 w-full overflow-x-auto no-scrollbar px-0.5 sm:px-1">
                {QUICK_ACTIONS.map(({ label, icon: Icon, prompt: samplePrompt }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setPrompt(samplePrompt)}
                    className="inline-flex items-center justify-center gap-0.5 sm:gap-1 px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-[6px] sm:rounded-[7px] bg-white/55 hover:bg-white/85 backdrop-blur-sm border border-neutral-900/[0.08] shadow-[0_1px_2px_rgba(15,23,42,0.03)] text-[8.5px] sm:text-[10.5px] font-normal tracking-[-0.015em] sm:tracking-[-0.01em] text-neutral-700 hover:text-neutral-950 whitespace-nowrap shrink-0 transition-all"
                  >
                    <Icon className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-neutral-500 stroke-[1.8] shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
