import { useLayoutEffect, useRef, type SVGProps } from "react";

/*
 * The four pieces of the nn mark as plain filled paths (no masks or clipped
 * strokes), so they render crisply at any size and under transforms.
 */
const RING =
  "M93.5 69.5C93.5 93.2482 74.2482 112.5 50.5 112.5C26.7518 112.5 7.5 93.2482 7.5 69.5C7.5 45.7518 26.7518 26.5 50.5 26.5C74.2482 26.5 93.5 45.7518 93.5 69.5Z";
const LEFT =
  "M0 159C0 137.461 17.4609 120 39 120H99V234H39C17.4609 234 0 216.539 0 195ZM84 135H39C25.745 135 15 145.745 15 159V195C15 208.255 25.745 219 39 219H84Z";
const RIGHT =
  "M162 120H252V201C252 219.225 237.225 234 219 234H191C174.984 234 162 221.016 162 205ZM177 135V205C177 212.732 183.268 219 191 219H219C228.941 219 237 210.941 237 201V135Z";
const ARCH =
  "M213 19C234.539 19 252 36.4609 252 58V120H237V58C237 44.7452 226.255 34 213 34H148C134.571 34 123.075 42.2731 118.328 54H123C151.817 54 175.36 76.5721 176.917 105H177V120H162V108C162 86.4609 144.539 69 123 69H101V66C101 40.0426 122.043 19 148 19H213Z";
/** The arch's own bottom edge, part of the same path (no seam). In the static mark the right leg's top edge draws it. */
const ARCH_BASE = "M162 120H252V135H162Z";

/** The nn mark. Drawn in currentColor, so it follows the text color (black in light, white in dark mode). */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 252 252" fill="currentColor" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg" aria-hidden {...props}>
      <path d={RING} fill="none" stroke="currentColor" strokeWidth="15" />
      <path d={LEFT} />
      <path d={RIGHT} />
      <path d={ARCH} />
    </svg>
  );
}

/*
 * The mark assembles itself: the legs rise, the arch swings in on top, the
 * ring pops in last; then the pieces leave in the same order.
 *
 * Each piece is its own HTML layer, so the browser animates it on the
 * compositor and it stays smooth while the main thread is busy (e.g. booting
 * the editor). At 98px, 1px = 3 viewBox units, so the edges land on whole
 * pixels; the padding leaves room for the ring's pop.
 */
const SIZE = 98;
const VIEWBOX = "-21 -21 294 294";

const LOADER_CSS = `
.nnd-loader { position: relative; width: ${SIZE}px; height: ${SIZE}px; }
.nnd-loader > svg { position: absolute; inset: 0; opacity: 0; will-change: transform, opacity;
  animation: 2400ms cubic-bezier(.22,1,.36,1) infinite both; }
.nnd-loader > .nnd-l { animation-name: nnd-rise; transform-origin: 24% 87%; }
.nnd-loader > .nnd-r { animation-name: nnd-rise; animation-delay: 100ms; transform-origin: 77% 87%; }
.nnd-loader > .nnd-a { animation-name: nnd-swing; animation-delay: 220ms; transform-origin: 41.5% 53%; }
.nnd-loader > .nnd-o { animation-name: nnd-pop; animation-delay: 400ms; transform-origin: 24.3% 30.8%; }
@keyframes nnd-rise {
  0% { opacity: 0; transform: translateY(15px) scaleY(.4); }
  20%, 72% { opacity: 1; transform: none; }
  88%, 100% { opacity: 0; transform: translateY(-5px) scaleY(.9); }
}
@keyframes nnd-swing {
  0% { opacity: 0; transform: rotate(-35deg) scale(.7); }
  22%, 72% { opacity: 1; transform: none; }
  88%, 100% { opacity: 0; transform: translateY(-5px) rotate(6deg); }
}
@keyframes nnd-pop {
  0% { opacity: 0; transform: scale(0); }
  14% { opacity: 1; transform: scale(1.25); }
  24%, 72% { opacity: 1; transform: scale(1); }
  88%, 100% { opacity: 0; transform: translateY(-6px) scale(.6); }
}
@media (prefers-reduced-motion: reduce) {
  .nnd-loader > svg { animation: nnd-breathe 1.6s ease-in-out infinite; transform: none; }
  @keyframes nnd-breathe { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
}
`;

function Piece({ className, d, ring }: { className: string; d: string; ring?: boolean }) {
  return (
    <svg className={className} viewBox={VIEWBOX} width={SIZE} height={SIZE} fill="currentColor" fillRule="evenodd" aria-hidden>
      {ring ? <path d={d} fill="none" stroke="currentColor" strokeWidth="15" /> : <path d={d} />}
    </svg>
  );
}

/** Animated nn mark, for loading states. */
export function LogoLoader({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Pin the animations to the page clock instead of the moment the browser
  // first styles them, so a loader that replaces another (the app's fallback,
  // then the editor's own) continues the cycle without a jump.
  useLayoutEffect(() => {
    for (const a of ref.current?.getAnimations?.({ subtree: true }) ?? []) a.startTime = 0;
  }, []);
  return (
    <>
      <style>{LOADER_CSS}</style>
      <div ref={ref} role="status" aria-label="Loading" className={["nnd-loader", className].filter(Boolean).join(" ")}>
        <Piece className="nnd-l" d={LEFT} />
        <Piece className="nnd-r" d={RIGHT} />
        <Piece className="nnd-a" d={ARCH + ARCH_BASE} />
        <Piece className="nnd-o" d={RING} ring />
      </div>
    </>
  );
}
