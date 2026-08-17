/**
 * Exact composer icons exported from the Figma redesign (file D8otVY8ZvWYoZGShPoYxHl).
 * These glyphs have no faithful lucide equivalent: the waveform is 5 bars
 * (lucide AudioLines has 6) and the server has left-aligned indicator dots.
 * Strokes scale with the 17px viewBox; color follows currentColor.
 */
import React from 'react';

type IconProps = { size?: number; className?: string };

export function WaveformIcon({ size = 17, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2.83337 7.08333V9.91667M5.66671 4.60417V12.3958M8.50004 6.375V10.625M11.3334 3.1875V13.8125M14.1667 7.08333V9.91667"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ServerIcon({ size = 17, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M13.4583 2.125H3.54167C2.75926 2.125 2.125 2.75926 2.125 3.54167V5.66667C2.125 6.44907 2.75926 7.08333 3.54167 7.08333H13.4583C14.2407 7.08333 14.875 6.44907 14.875 5.66667V3.54167C14.875 2.75926 14.2407 2.125 13.4583 2.125Z"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.4583 9.91669H3.54167C2.75926 9.91669 2.125 10.551 2.125 11.3334V13.4584C2.125 14.2408 2.75926 14.875 3.54167 14.875H13.4583C14.2407 14.875 14.875 14.2408 14.875 13.4584V11.3334C14.875 10.551 14.2407 9.91669 13.4583 9.91669Z"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.95833 5.31248C5.34953 5.31248 5.66667 4.99535 5.66667 4.60415C5.66667 4.21294 5.34953 3.89581 4.95833 3.89581C4.56713 3.89581 4.25 4.21294 4.25 4.60415C4.25 4.99535 4.56713 5.31248 4.95833 5.31248Z"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.95833 13.1042C5.34953 13.1042 5.66667 12.787 5.66667 12.3958C5.66667 12.0046 5.34953 11.6875 4.95833 11.6875C4.56713 11.6875 4.25 12.0046 4.25 12.3958C4.25 12.787 4.56713 13.1042 4.95833 13.1042Z"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
