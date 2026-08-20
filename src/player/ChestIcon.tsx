/** Decorative treasure chest mark used in the app badge. */
export default function ChestIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 56"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {/* lid */}
      <path d="M5 27C5 14.3 17.1 4 32 4s27 10.3 27 23z" fill="#43200a" />
      <path
        d="M11.5 24C12.8 15.6 21.4 9.5 32 9.5"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.28"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* gold band between lid and body */}
      <rect x="3" y="24" width="58" height="7" rx="3.5" fill="#f8c34a" />
      {/* body */}
      <rect x="5" y="30" width="54" height="20" rx="4" fill="#5c2a0c" />
      {/* corner rivets */}
      <circle cx="11" cy="44" r="2" fill="#f0b73f" />
      <circle cx="53" cy="44" r="2" fill="#f0b73f" />
      {/* centre strap + lock */}
      <rect x="27" y="30" width="10" height="20" fill="#f0b73f" />
      <rect x="24.5" y="25" width="15" height="14" rx="3" fill="#fbd268" />
      <circle cx="32" cy="31" r="2.4" fill="#43200a" />
      <path d="M30.6 31.5h2.8l-.9 4.5h-1z" fill="#43200a" />
      {/* feet */}
      <rect x="7" y="49" width="50" height="4" rx="2" fill="#43200a" />
    </svg>
  )
}
