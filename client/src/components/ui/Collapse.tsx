import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '~/utils';
import { liquid, ease } from '~/utils/motion';

/**
 * Every disclosure in the app opens the same way: height travels to the
 * content's own size and eases closed again.
 *
 * A spring rather than a fixed duration, because the distance varies — a
 * folder holding two chats and one holding twenty should feel like the same
 * gesture. Damping ratio is ~1.05, so it is overdamped: it settles without a
 * bounce, honouring "no spring or overshoot" in DESIGN.md §6.
 */
export default function Collapse({
  open,
  children,
  innerClassName = 'flex flex-col gap-[2px]',
}: {
  open: boolean;
  children: React.ReactNode;
  /** Layout for the clipped content. Rows want the 2px sidebar rhythm; the
   *  composer's tool row wants none. */
  innerClassName?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapse"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={
            reduceMotion === true
              ? { duration: 0 }
              : {
                  height: liquid,
                  opacity: { duration: 0.18, ease },
                }
          }
          style={{ overflow: 'hidden' }}
        >
          <div className={cn(innerClassName)}>{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
