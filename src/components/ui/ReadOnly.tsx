import type { MouseEvent } from 'react';
import { toast } from '@/lib/toast';

// The one place "this control is inert on the public showcase" is expressed.
//
// The showcase renders the app's chrome unchanged — same ribbon, same cards,
// same buttons — so a visitor sees the real product rather than a stripped
// demo. The buttons therefore have to exist and refuse, which is a presentation
// concern only: RLS already refuses every write from the anon role, and it, not
// this file, is the security boundary (CLAUDE.md).
//
// Kept deliberately tiny so applying it is one import and one spread rather
// than a judgement call per button — a write control that forgets it still
// cannot write, it just fails silently instead of saying why.

// Exported so a control that is not a button — a calendar cell, a row — can
// raise the same notice from its own handler and the wording stays one string.
// Keep it in sync with the literal in App.astro's nav script, which cannot
// import from here.
export const READ_ONLY_NOTICE = 'Read-only showcase — sign in to try this.';

/** Swallow the interaction and say why. */
export function blockWrite(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  toast(READ_ONLY_NOTICE, 'error');
}

/**
 * Spread onto a write control to make it inert.
 *
 * `aria-disabled` rather than `disabled`: the control stays focusable and
 * reachable, so a keyboard or screen-reader visitor gets the explanation
 * instead of a dead element they cannot reach. It also works on an `<a>`, which
 * `disabled` does not.
 */
export function readOnlyProps(readOnly: boolean) {
  if (!readOnly) return {};
  return {
    'aria-disabled': true as const,
    'data-readonly': '' as const,
    title: READ_ONLY_NOTICE,
    onClick: blockWrite,
  };
}
