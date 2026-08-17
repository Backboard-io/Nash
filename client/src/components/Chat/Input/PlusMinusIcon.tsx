import { cn } from '~/utils';

export default function PlusMinusIcon({ open, size = 17 }: { open: boolean; size?: number }) {
  const bar = 'absolute rounded-full bg-current';
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span className={bar} style={{ width: size, height: 1.6 }} />
      <span
        className={cn(bar, 'origin-center')}
        style={{
          width: size,
          height: 1.6,
          rotate: open ? '0deg' : '90deg',
          opacity: open ? 0 : 1,
          transition:
            'rotate 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms cubic-bezier(0.16, 1, 0.3, 1) 60ms',
        }}
      />
    </span>
  );
}
