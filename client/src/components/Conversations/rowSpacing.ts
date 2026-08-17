/**
 * The gap beneath a chat row in the sidebar.
 *
 * One value, imported by both lists. A chat filed in a folder and a loose one
 * are the same row and have to sit on the same rhythm — the indent is the only
 * thing that should say which is which. They were spaced in two different
 * files and drifted apart, which shows the moment an open folder sits above
 * the dated chats.
 *
 * 4 — the smallest step on §3's scale. The rows are 32px tall with a rounded
 * fill that only appears under the pointer, so at zero two hovered rows met
 * with no seam and the list read as one block rather than a set of chats. 4
 * separates them without spacing a quiet list out into a series of objects;
 * group separation is still §14 rule 8's job, not this gap's.
 *
 * Both lists import this, so the two cannot drift — which they did the first
 * time, when this constant existed but nothing referenced it.
 */
export const CHAT_ROW_GAP = 4;
