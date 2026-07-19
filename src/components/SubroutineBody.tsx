import { safeHref } from '@/lib/subroutine';

// Read-only body of a subroutine item: the description as italic subtext, plus a
// trailing clickable "Link" when a valid http(s) URL is present. Shared by every
// surface that renders items (Logger, quick view, day preview, plan/share grids).
export function SubroutineBody({
  description,
  url,
  className = '',
}: {
  description?: string;
  url?: string;
  className?: string;
}) {
  const href = safeHref(url);
  if (!description?.trim() && !href) return null;
  return (
    <p className={`text-sm italic text-muted ${className}`}>
      {description?.trim()}
      {href ? (
        <>
          {description?.trim() ? ' ' : ''}
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="not-italic text-fg underline underline-offset-2 hover:text-accent"
          >
            Link
          </a>
        </>
      ) : null}
    </p>
  );
}
