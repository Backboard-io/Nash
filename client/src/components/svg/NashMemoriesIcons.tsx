/**
 * Exact icons for the Memories screen, exported from the Figma redesign
 * (file D8otVY8ZvWYoZGShPoYxHl, HiFi Memories Desktop canvas). Each keeps its
 * native viewBox so strokes scale exactly as designed; color follows
 * currentColor. The db/cloudOff/alert glyphs intentionally differ from their
 * closest lucide equivalents (proportions / circle-vs-triangle).
 */
import React from 'react';

type IconProps = { size?: number; className?: string };

export function DbIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M12 9C16.4183 9 20 7.65685 20 6C20 4.34315 16.4183 3 12 3C7.58172 3 4 4.34315 4 6C4 7.65685 7.58172 9 12 9Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 6V18C4 19.7 7.6 21 12 21C16.4 21 20 19.7 20 18V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12C4 13.7 7.6 15 12 15C16.4 15 20 13.7 20 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloudOffIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M1 1L23 23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.7 16.6999C17.6087 16.6529 18.4741 16.2974 19.1536 15.6923C19.8331 15.0871 20.2859 14.2683 20.4374 13.3711C20.5889 12.4739 20.4299 11.5519 19.9868 10.7572C19.5437 9.96252 18.8428 9.34265 18 8.9999H16.7C16.2161 8.02742 15.5392 7.16368 14.7107 6.4613C13.8821 5.75893 12.9192 5.23264 11.8806 4.91452C10.8421 4.59639 9.74957 4.4931 8.66978 4.61093C7.58998 4.72877 6.54549 5.06526 5.59998 5.5999" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.3 8.30005C2.14631 8.7244 1.20844 9.58966 0.692713 10.7055C0.176988 11.8213 0.125652 13.0964 0.549999 14.25C0.974345 15.4037 1.83961 16.3416 2.95546 16.8573C4.0713 17.3731 5.34631 17.4244 6.5 17H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UploadIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M15.75 11.25V14.25C15.75 14.6478 15.592 15.0294 15.3107 15.3107C15.0294 15.592 14.6478 15.75 14.25 15.75H3.75C3.35218 15.75 2.97064 15.592 2.68934 15.3107C2.40804 15.0294 2.25 14.6478 2.25 14.25V11.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.75 6L9 2.25L5.25 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 2.25V11.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EditIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M7.33337 2.66666H2.66671C2.31309 2.66666 1.97395 2.80713 1.7239 3.05718C1.47385 3.30723 1.33337 3.64637 1.33337 3.99999V13.3333C1.33337 13.6869 1.47385 14.0261 1.7239 14.2761C1.97395 14.5262 2.31309 14.6667 2.66671 14.6667H12C12.3537 14.6667 12.6928 14.5262 12.9428 14.2761C13.1929 14.0261 13.3334 13.6869 13.3334 13.3333V8.66666" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.3334 1.66665C12.5986 1.40144 12.9583 1.25244 13.3334 1.25244C13.7084 1.25244 14.0682 1.40144 14.3334 1.66665C14.5986 1.93187 14.7476 2.29158 14.7476 2.66665C14.7476 3.04173 14.5986 3.40144 14.3334 3.66665L8.00004 9.99999L5.33337 10.6667L6.00004 7.99999L12.3334 1.66665Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon2({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M2 4H14" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.6667 4V13.3333C12.6667 13.687 12.5262 14.0261 12.2762 14.2761C12.0261 14.5262 11.687 14.6667 11.3334 14.6667H4.66671C4.31309 14.6667 3.97395 14.5262 3.7239 14.2761C3.47385 14.0261 3.33337 13.687 3.33337 13.3333V4" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.33337 4.00001V2.66668C5.33337 2.31305 5.47385 1.97392 5.7239 1.72387C5.97395 1.47382 6.31309 1.33334 6.66671 1.33334H9.33337C9.687 1.33334 10.0261 1.47382 10.2762 1.72387C10.5262 1.97392 10.6667 2.31305 10.6667 2.66668V4.00001" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RefreshIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M0.625 2.5V6.25H4.375" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.375 12.5V8.75H10.625" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8062 5.62499C12.4893 4.72923 11.9505 3.92836 11.2403 3.29712C10.5301 2.66588 9.67158 2.22484 8.74482 2.01515C7.81806 1.80546 6.85328 1.83395 5.94051 2.09797C5.02773 2.36199 4.19672 2.85293 3.525 3.52499L0.625 6.24999M14.375 8.74999L11.475 11.475C10.8033 12.147 9.97227 12.638 9.05949 12.902C8.14672 13.166 7.18194 13.1945 6.25518 12.9848C5.32842 12.7751 4.46988 12.3341 3.75967 11.7028C3.04946 11.0716 2.51073 10.2707 2.19375 9.37499" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertCircleIcon({ size = 17, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M8.49999 15.5832C12.412 15.5832 15.5833 12.4119 15.5833 8.49984C15.5833 4.58782 12.412 1.4165 8.49999 1.4165C4.58797 1.4165 1.41666 4.58782 1.41666 8.49984C1.41666 12.4119 4.58797 15.5832 8.49999 15.5832Z" stroke="currentColor" strokeWidth="1.41667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 5.6665V8.49984" stroke="currentColor" strokeWidth="1.41667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 11.3335H8.50708" stroke="currentColor" strokeWidth="1.41667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function XIcon({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M9.75 3.25L3.25 9.75M3.25 3.25L9.75 9.75" stroke="currentColor" strokeWidth="1.08333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
