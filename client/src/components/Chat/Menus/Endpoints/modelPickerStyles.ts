import type { Endpoint } from '~/common';
import { formatModelName } from '~/utils/modelDisplay';

/**
 * The two things the desktop and mobile model pickers must say identically.
 * They were written once each and had already drifted — mobile had no section
 * headings at all, so its list ran as one undifferentiated stream while the
 * desktop grouped the same data under Pinned / Providers.
 */

/**
 * A group heading inside the picker.
 *
 * --t3, which this app spells `text-secondary-alt`; `text-tertiary` is --t4 and
 * left these labels fainter than the meta lines beneath them.
 */
export const sectionLabel =
  'px-1 text-[10.5px] font-medium uppercase leading-[16px] tracking-[0.07em] text-text-secondary-alt';

/** A provider row's second line: the first few models it offers. */
export const modelNames = (endpoint: Endpoint) =>
  (endpoint.models ?? [])
    .slice(0, 3)
    .map((m: unknown) => formatModelName(String((m as { name?: string })?.name ?? m)))
    .join(', ');
