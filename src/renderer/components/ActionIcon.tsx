export function ActionIcon({
  name,
  spinning = false,
}: {
  name: 'refresh' | 'cleanup' | 'rename';
  spinning?: boolean;
}) {
  return (
    <svg
      className={`action-icon${spinning ? ' spinning' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'refresh' ? (
        <>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6.2 6.2a8 8 0 0 1 13 3.3M4.8 14.5a8 8 0 0 0 13 3.3" />
        </>
      ) : name === 'rename' ? (
        <>
          <path d="m15 4 5 5M4 20l1-6L16 3l5 5-11 11-6 1Z" />
        </>
      ) : (
        <>
          <path d="m14 4 6 6M5 20l-2-2 10-10 5 5-7 7H5Z" />
          <path d="m11 10 5 5M17 3l4 4M16 20h5" />
        </>
      )}
    </svg>
  );
}
