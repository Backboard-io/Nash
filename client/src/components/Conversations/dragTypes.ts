/**
 * A chat being dragged onto a folder.
 *
 * A custom MIME type rather than text/plain: the file drop zone accepts
 * NativeTypes.FILE only, and a private type keeps a row drag from being
 * mistaken for anything else on the page.
 */
export const CONVO_DRAG_TYPE = 'application/x-nash-conversation';

/** The folder the chat started in ('' when it was loose), so a drop that
 *  changes nothing can be skipped. */
export const CONVO_DRAG_FROM = 'application/x-nash-conversation-from';

/**
 * Whether a folder row accepted the drag.
 *
 * `dragend` cannot tell "dropped on nothing" from "cancelled" — both report a
 * dropEffect of 'none' — so the folder row raises this flag when it takes the
 * drop, and the row reads it afterwards. Module state rather than React state:
 * it is written and read inside one gesture, and a re-render in between would
 * lose it.
 */
export const convoDrag = { handled: false };
