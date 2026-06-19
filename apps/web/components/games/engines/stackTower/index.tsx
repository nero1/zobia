"use client";

/**
 * Stack Tower — a block swings left and right. Tap to drop it on the stack.
 * The overlapping portion stays; the rest falls off, shrinking the block.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 300, H = 500;
const BLOCK_H = 24;
const SPEED_MAP: Record<string, number> = { easy: 1.5, medium: 2.5, hard: 4 };
const COLORS = ["#6366f1","#8b5cf6","#a855f7","#c084fc","#e879f9","#f472b6","#fb7185","#f87171","#fbbf24","#4ade80","#34d399","#38bdf8"];

export default function StackTowerGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const SPEED = SPEED_MAP[difficulty] ?? 2.5;

    type Block = { x: number; w: number; y: number; color: string };
    const stack: Block[] = [{ x: W / 2 - 80, w: 160, y: H - BLOCK_H, color: COLORS[0] }];
    let current = { x: 0, w: stack[0].w, dir: 1, colorIdx: 1 };
    let sc = 0, over = false;

    const drop = () => {
      if (over) return;
      const top = stack[stack.length - 1];
      const overlap_start = Math.max(current.x, top.x);
      const overlap_end = Math.min(current.x + current.w, top.x + top.w);
      const overlap = overlap_end - overlap_start;
      if (overlap <= 0) {
        over = true;
        play("lose");
        onGameOver(sc);
        return;
      }
      const newY = top.y - BLOCK_H;
      stack.push({ x: overlap_start, w: overlap, y: newY, color: COLORS[current.colorIdx % COLORS.length] });
      current = { x: 0, w: overlap, dir: 1, colorIdx: current.colorIdx + 1 };
      sc++;
      setScore(sc);
      onScore?.(sc);
      play(overlap > top.w * 0.95 ? "match" : "drop");
    };

    const onKey = (e: KeyboardEvent) => { if (e.code === "Space" || e.key === " ") { drop(); e.preventDefault(); } };
    const onTouch = (e: TouchEvent) => { drop(); e.preventDefault(); };
    const onClick = () => drop();
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("touchstart", onTouch, { passive: false });
    canvas.addEventListener("click", onClick);

    let raf = 0;
    const loop = () => {
      if (paused) { raf = requestAnimationFrame(loop); return; }
      if (over) return;

      current.x += SPEED * current.dir;
      if (current.x + current.w > W || current.x < 0) current.dir *= -1;

      // Camera: shift stack down if needed
      const topY = stack[stack.length - 1].y;
      const camShift = topY < H / 3 ? (H / 3 - topY) : 0;

      ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);

      // Draw stack
      for (const b of stack) {
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y + camShift, b.w, BLOCK_H - 2);
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(b.x, b.y + camShift, b.w, 4);
      }

      // Draw current block
      ctx.fillStyle = COLORS[current.colorIdx % COLORS.length];
      const curY = stack[stack.length - 1].y - BLOCK_H + camShift;
      ctx.fillRect(current.x, curY - 30, current.w, BLOCK_H - 2);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(current.x, curY - 30, current.w, 4);

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("touchstart", onTouch);
      canvas.removeEventListener("click", onClick);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-foreground">Height: <span className="text-emerald-400">{score}</span></div>
      <canvas
        ref={canvasRef} width={W} height={H}
        className="rounded-xl border border-border touch-none max-w-full cursor-pointer"
      />
      <p className="text-xs text-muted-foreground">Tap / Space to drop the block.</p>
    </div>
  );
}
