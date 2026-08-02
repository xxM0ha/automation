/* The "ordo" wordmark — lowercase geometric Latin with the lime accent.
   `.wordmark` (in index.css) forces LTR so it never reorders in the RTL doc. */
export const Wordmark = ({
  className = '',
  onDark = false,
}: {
  className?: string;
  onDark?: boolean;
}) => (
  <span className={`wordmark inline-flex items-baseline ${onDark ? 'text-white' : 'text-ink'} ${className}`}>
    ord<span className="text-lime">o</span>
  </span>
);
