import { motion, MotionConfig, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

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
