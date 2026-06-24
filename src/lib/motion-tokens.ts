export const motionTokens = {
  duration: {
    instant: 120,
    fast: 180,
    base: 240,
    layout: 360,
    entrance: 560,
    normal: 240,
    slow: 360,
  },
  distance: {
    tiny: 2,
    small: 4,
    medium: 8,
  },
  easing: {
    enter: "cubic-bezier(0.16, 1, 0.3, 1)",
    exit: "cubic-bezier(0.7, 0, 0.84, 0)",
    toggle: "cubic-bezier(0.65, 0, 0.35, 1)",
  },
} as const;

export const reducedMotionQuery = "(prefers-reduced-motion: reduce)" as const;
