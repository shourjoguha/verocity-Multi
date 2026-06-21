import {
  animate,
  motion,
  MotionConfig,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Variants,
} from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

// Shared Motion helpers for the React islands. The editorial easing curve from
// the design spec drives entrance/stagger/scroll-reveal motion. MotionConfig
// reducedMotion="user" means every descendant honors prefers-reduced-motion.

export const EASE: [number, number, number, number] = [0.77, 0, 0.175, 1];

export const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

// Screen-entrance stagger — runs on mount.
export function PageStagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div className={className} initial="hidden" animate="show" variants={containerVariants}>
        {children}
      </motion.div>
    </MotionConfig>
  );
}

// Scroll-triggered group reveal — runs once when it enters the viewport.
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className={className}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-8% 0px' }}
        variants={containerVariants}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}

// Staggered child — fades + rises in sequence inside a PageStagger/Reveal.
export function Item({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}

// Count-up numeral — rolls from 0 to `value` once it scrolls into view, on the
// editorial easing, with tabular figures so the width never jitters. Honors
// reduced-motion (snaps straight to the value). The delight vocabulary the data
// surfaces reuse (StatCard, Stats, etc.).
export function AnimatedNumber({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 0.9,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-8% 0px' });
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (n) => format(n));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    if (!inView) return;
    const controls = animate(mv, value, { duration, ease: EASE });
    return () => controls.stop();
  }, [inView, value, reduce, duration, mv]);

  return (
    <motion.span ref={ref} className="tabular-nums">
      {text}
    </motion.span>
  );
}
