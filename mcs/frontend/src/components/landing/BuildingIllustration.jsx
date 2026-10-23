/* Architectural line drawing of a school building with rooftop solar
   panels, sitting in front of a geometric energy burst. Colours come from
   the theme tokens so the same drawing works in both themes. */
export function BuildingIllustration() {
  return (
    <svg
      className="lp-illustration"
      viewBox="0 0 640 520"
      role="img"
      aria-label="Line drawing of a school building with rooftop solar panels and an energy burst behind it"
    >
      <defs>
        <linearGradient id="wwBurst" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a1d7ae" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#79bd91" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* Energy burst */}
      <polygon
        className="illo-burst"
        points="100,50 74.1,56.5 93.3,75 67.7,67.7 75,93.3 56.5,74.1 50,100 43.5,74.1 25,93.3 32.3,67.7 6.7,75 25.9,56.5 0,50 25.9,43.5 6.7,25 32.3,32.3 25,6.7 43.5,25.9 50,0 56.5,25.9 75,6.7 67.7,32.3 93.3,25 74.1,43.5"
        transform="translate(330 250) scale(3.4) translate(-50 -50)"
      />

      {/* Rooftop solar arrays */}
      <g transform="rotate(-14 266 214)">
        <rect className="illo-solar" x="186" y="190" width="160" height="48" rx="2" />
        <path
          className="illo-grid"
          d="M226 190 V238 M266 190 V238 M306 190 V238 M186 214 H346"
        />
      </g>
      <g transform="rotate(-14 417 214)">
        <rect className="illo-solar" x="342" y="190" width="150" height="48" rx="2" />
        <path
          className="illo-grid"
          d="M379.5 190 V238 M417 190 V238 M454.5 190 V238 M342 214 H492"
        />
      </g>

      {/* Main building */}
      <rect className="illo-face" x="170" y="246" width="300" height="206" />
      <rect className="illo-slab" x="158" y="238" width="324" height="8" rx="1" />

      {/* Side wing */}
      <rect className="illo-face" x="470" y="330" width="88" height="122" />
      <rect className="illo-slab" x="462" y="322" width="104" height="8" rx="1" />

      {/* Windows — upper floors */}
      {[266, 318].map((y) =>
        [206, 254, 302, 350, 398].map((x) => (
          <rect
            key={`${x}-${y}`}
            className="illo-glass"
            x={x}
            y={y}
            width="36"
            height="34"
            rx="2"
          />
        )),
      )}

      {/* Windows — ground floor, leaving room for the entrance */}
      {[206, 254, 350, 398].map((x) => (
        <rect
          key={`ground-${x}`}
          className="illo-glass"
          x={x}
          y="370"
          width="36"
          height="34"
          rx="2"
        />
      ))}

      {/* Side wing windows */}
      {[352, 402].map((y) =>
        [490, 524].map((x) => (
          <rect
            key={`wing-${x}-${y}`}
            className="illo-glass"
            x={x}
            y={y}
            width="24"
            height="36"
            rx="2"
          />
        )),
      )}

      {/* Entrance */}
      <rect className="illo-slab" x="288" y="396" width="64" height="6" rx="1" />
      <rect className="illo-face" x="302" y="404" width="36" height="48" rx="2" />
      <path className="illo-strong" d="M302 404 V452 M338 404 V452" />
      <circle className="illo-accent" cx="331" cy="432" r="1.8" />
      <path className="illo-line" d="M294 452 H346" />

      {/* Flagpole on the wing */}
      <path className="illo-line" d="M540 322 V252" />
      <path className="illo-accent" d="M540 254 L574 262 L540 270 Z" />

      {/* Trees */}
      <path className="illo-line" d="M112 452 V420" />
      <circle className="illo-line" cx="112" cy="396" r="24" />
      <path className="illo-line" d="M592 452 V426" />
      <circle className="illo-line" cx="592" cy="404" r="20" />

      {/* Ground line */}
      <path className="illo-strong" d="M56 452 H584" />
      <path className="illo-line" d="M96 461 H120 M300 461 H336 M500 461 H526" />

      {/* Small accents */}
      <path className="illo-line" d="M110 162 V178 M102 170 H118" opacity="0.6" />
      <path className="illo-line" d="M560 138 V154 M552 146 H568" opacity="0.6" />
    </svg>
  );
}
