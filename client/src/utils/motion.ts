/**
 * The app's one motion vocabulary — DESIGN.md §10. Nothing declares its own
 * curve or its own popup animation; it imports from here.
 *
 * These are plain objects rather than framer-motion types so that importing
 * them costs nothing: spread them onto a `motion.*` element as
 * `{...popDialog}` and it carries initial/animate/exit/transition together,
 * which is also the point — the exit cannot be forgotten if it travels with
 * the rest.
 */

export const ease = [0.16, 1, 0.3, 1];
export const easeInOut = [0.65, 0, 0.35, 1];

export const dur = { press: 0.09, hover: 0.16, swap: 0.26, move: 0.38, page: 0.42 };

/** Composer, panels, sections, toasts. Damped to settle, never to bounce. */
export const liquid = { type: 'spring' as const, stiffness: 260, damping: 32, mass: 0.9 };
/** Sidebar width, travelling controls. */
export const liquidWide = { type: 'spring' as const, stiffness: 210, damping: 30, mass: 0.95 };

/**
 * §10 Popups. The direction of travel matches where the popup came from: a
 * menu falls from the control that opened it, a flyout slides out of the panel
 * edge, a dialog rises into the middle of the screen.
 *
 * Scale stays at .98–.99. Lower reads as zooming rather than appearing, and at
 * dialog size it distorts the text on the way in.
 */
export const popMenu = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.98 },
  transition: { duration: 0.18, ease },
};

export const popSide = {
  initial: { opacity: 0, x: -10, scale: 0.98 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: -8, scale: 0.98 },
  transition: liquid,
};

export const popDialog = {
  initial: { opacity: 0, y: 10, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.99 },
  transition: liquid,
};

/** The scrim fades and never moves — sliding it drags the eye off the thing
 *  it exists to focus on. */
export const popScrim = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.18, ease },
};
