/* 
  WattWise Landing Page - Animated Building Illustration
  A single building on the right side with staggered window lighting,
  solar panels, and energy flow visualization.
*/
import { useEffect, useRef } from "react";

export function BuildingIllustration() {
  const svgRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Animate energy flow lines
    const flowLines = svg.querySelectorAll(".energy-flow-line");
    let flowOffset = 0;

    const animateFlow = () => {
      flowOffset = (flowOffset + 0.5) % 20;
      flowLines.forEach((line) => {
        line.style.strokeDashoffset = flowOffset;
      });
      animationFrameRef.current = requestAnimationFrame(animateFlow);
    };

    animateFlow();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      className="lp-illustration"
      viewBox="0 0 800 550"
      role="img"
      aria-label="Animated building with solar panels, windows lighting up sequentially, and energy flowing"
    >
      <defs>
        {/* Sky gradient */}
        <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0d1a12" />
          <stop offset="50%" stopColor="#14261a" />
          <stop offset="100%" stopColor="#1a3022" />
        </linearGradient>

        {/* Building body gradient */}
        <linearGradient id="buildingGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1e2d23" />
          <stop offset="100%" stopColor="#142018" />
        </linearGradient>

        {/* Window dark/off state */}
        <linearGradient id="windowDark" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0a120c" />
          <stop offset="100%" stopColor="#080f0a" />
        </linearGradient>

        {/* Window lit state - warm yellow */}
        <linearGradient id="windowLit" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f5d06e" />
          <stop offset="50%" stopColor="#e8b84d" />
          <stop offset="100%" stopColor="#d4a038" />
        </linearGradient>

        {/* Window glow effect */}
        <radialGradient id="windowGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f5d06e" stopOpacity="0.6" />
          <stop offset="40%" stopColor="#e8b84d" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#d4a038" stopOpacity="0" />
        </radialGradient>

        {/* Solar panel gradient */}
        <linearGradient id="solarGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0a1a0d" />
          <stop offset="50%" stopColor="#123818" />
          <stop offset="100%" stopColor="#0a1a0d" />
        </linearGradient>

        {/* Solar cell lines */}
        <pattern id="solarPattern" patternUnits="userSpaceOnUse" width="8" height="8">
          <rect width="8" height="8" fill="#08120a" />
          <path d="M0 8V0 M8 0H0" stroke="#1a5c24" strokeWidth="0.5" opacity="0.6" />
        </pattern>

        {/* Energy flow gradient */}
        <linearGradient id="energyFlowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f5d06e" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#e8b84d" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#f5d06e" stopOpacity="0.8" />
        </linearGradient>

        {/* Ground gradient */}
        <linearGradient id="groundGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1a281e" />
          <stop offset="100%" stopColor="#0f1812" />
        </linearGradient>

        {/* Tree gradient */}
        <radialGradient id="treeGrad" cx="50%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#1a3a1e" />
          <stop offset="100%" stopColor="#0d2010" />
        </radialGradient>

        {/* Roof gradient */}
        <linearGradient id="roofGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#121e16" />
          <stop offset="100%" stopColor="#0a140c" />
        </linearGradient>

        {/* Window frame shadow */}
        <filter id="windowInset" x="-20%" y="-20%" width="140%" height="140%">
          <feOffset dx="0" dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.3" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Glow filter for lit windows */}
        <filter id="litGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Sky background */}
      <rect width="800" height="550" fill="url(#skyGrad)" />

      {/* Stars */}
      <g className="stars" opacity="0.6">
        <circle cx="50" cy="60" r="1" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="3s" repeatCount="indefinite" begin="0s" />
        </circle>
        <circle cx="150" cy="40" r="0.8" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="2.5s" repeatCount="indefinite" begin="0.5s" />
        </circle>
        <circle cx="300" cy="80" r="1.2" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="3.5s" repeatCount="indefinite" begin="1s" />
        </circle>
        <circle cx="500" cy="50" r="1" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="2.8s" repeatCount="indefinite" begin="1.5s" />
        </circle>
        <circle cx="650" cy="70" r="0.8" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="3.2s" repeatCount="indefinite" begin="0.8s" />
        </circle>
        <circle cx="720" cy="100" r="1" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="2.2s" repeatCount="indefinite" begin="1.2s" />
        </circle>
        <circle cx="100" cy="120" r="0.6" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="4s" repeatCount="indefinite" begin="2s" />
        </circle>
        <circle cx="400" cy="30" r="1.5" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="3s" repeatCount="indefinite" begin="0.3s" />
        </circle>
        <circle cx="600" cy="120" r="0.8" fill="#f5d06e">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="2.7s" repeatCount="indefinite" begin="1.8s" />
        </circle>
      </g>

      {/* Moon */}
      <circle cx="700" cy="80" r="30" fill="#1a2a1e" stroke="#2a4a2e" strokeWidth="1" opacity="0.4" />
      <circle cx="692" cy="72" r="24" fill="#2a4a2e" opacity="0.3" />

      {/* Single Building - Right Side (positioned at x=450, centered in right half) */}
      <g transform="translate(450, 120)">
        {/* Building shadow */}
        <rect x="20" y="20" width="300" height="380" fill="#050f08" opacity="0.3" filter="url(#windowInset)" />

        {/* Building main body */}
        <rect x="0" y="0" width="300" height="380" fill="url(#buildingGrad)" stroke="#2a4a2e" strokeWidth="1.5" rx="2" />

        {/* Side walls - depth effect */}
        <rect x="0" y="0" width="12" height="380" fill="#142018" stroke="#2a4a2e" strokeWidth="0.5" />
        <rect x="288" y="0" width="12" height="380" fill="#142018" stroke="#2a4a2e" strokeWidth="0.5" />

        {/* Floor slabs - 6 floors */}
        {[0, 1, 2, 3, 4, 5].map((floor) => (
          <g key={`slab-${floor}`} transform={`translate(0, ${floor * 60})`}>
            <rect x="0" y="55" width="300" height="10" fill="#142018" stroke="#2a4a2e" strokeWidth="0.5" />
            <rect x="0" y="55" width="12" height="10" fill="#101c14" />
            <rect x="288" y="55" width="12" height="10" fill="#101c14" />
          </g>
        ))}

        {/* Windows - 6 floors x 6 windows each = 36 windows */}
        {[0, 1, 2, 3, 4, 5].map((floor) => (
          <g key={`floor-${floor}`} transform={`translate(0, ${floor * 60})`}>
            {[0, 1, 2, 3, 4, 5].map((w) => {
              // Staggered delay: floor-major (top to bottom), then window index (left to right)
              const delay = (5 - floor) * 0.25 + w * 0.1;
              return (
                <g key={`win-${floor}-${w}`} transform={`translate(${16 + w * 45}, 8)`}>
                  {/* Window frame */}
                  <rect
                    x="-2"
                    y="-2"
                    width="42"
                    height="50"
                    rx="3"
                    fill="#101c14"
                    stroke="#2a4a2e"
                    strokeWidth="1"
                  />
                  
                  {/* Window glass - dark/off */}
                  <rect
                    className="window-glass-off"
                    x="0"
                    y="0"
                    width="38"
                    height="46"
                    rx="2"
                    fill="url(#windowDark)"
                  />

                  {/* Window glass - lit (animated) */}
                  <rect
                    className="window-glass-lit"
                    x="2"
                    y="2"
                    width="34"
                    height="42"
                    rx="2"
                    fill="url(#windowLit)"
                    filter="url(#litGlow)"
                    style={{ 
                      animationDelay: `${delay}s`,
                      animationFillMode: 'forwards'
                    }}
                  >
                    <animate 
                      attributeName="opacity" 
                      values="0;0;1" 
                      dur="4s" 
                      begin={`${delay}s`} 
                      fill="freeze" 
                      repeatCount="1" 
                    />
                  </rect>

                  {/* Window cross muntins */}
                  <line x1="19" y1="0" x2="19" y2="46" stroke="#142018" strokeWidth="2" />
                  <line x1="0" y1="23" x2="38" y2="23" stroke="#142018" strokeWidth="2" />
                </g>
              );
            })}
          </g>
        ))}

        {/* Roof */}
        <path
          d="M-10 0 L150 -35 L310 0 Z"
          fill="url(#roofGrad)"
          stroke="#2a4a2e"
          strokeWidth="1.5"
        />

        {/* Roof edge */}
        <line x1="-10" y1="0" x2="310" y2="0" stroke="#2a4a2e" strokeWidth="2" />

        {/* Solar panels on roof - 5 panels */}
        <g transform="translate(20, -25)">
          {[0, 1, 2, 3, 4].map((p) => (
            <g key={`solar-${p}`} transform={`translate(${p * 55}, 0)`}>
              <rect
                className="solar-panel"
                x="0"
                y="0"
                width="50"
                height="28"
                rx="2"
                fill="url(#solarGrad)"
                stroke="#1a5c24"
                strokeWidth="1"
              >
                <animate attributeName="opacity" values="1;0.7;1" dur="4s" repeatCount="indefinite" begin={`${p * 0.4}s`} />
              </rect>
              
              {/* Solar cells grid */}
              <rect
                x="3"
                y="3"
                width="44"
                height="22"
                fill="url(#solarPattern)"
              />
              
              {/* Panel frame */}
              <rect
                x="0"
                y="0"
                width="50"
                height="28"
                rx="2"
                fill="none"
                stroke="#0a1a0d"
                strokeWidth="1.5"
              />
            </g>
          ))}
        </g>

        {/* Building entrance */}
        <g transform="translate(120, 330)">
          <rect x="0" y="0" width="60" height="50" fill="#101c14" stroke="#2a4a2e" strokeWidth="1.5" rx="2" />
          <rect x="25" y="15" width="10" height="35" fill="#2a4a2e" />
          {/* Door light */}
          <circle cx="52" cy="30" r="4" fill="#f5d06e" opacity="0.8">
            <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
          </circle>
        </g>

        {/* Building label */}
        <text 
          x="150" 
          y="430" 
          textAnchor="middle" 
          fontFamily="var(--mono)" 
          fontSize="11" 
          fill="#4a6a4e" 
          letterSpacing="0.1em"
        >
          WATTWISE CAMPUS
        </text>
      </g>

      {/* Energy Flow Lines - animated dashed lines from solar to building */}
      <g className="energy-flows" stroke="url(#energyFlowGrad)" strokeWidth="2" fill="none" opacity="0.7">
        {/* Flow from solar panels down to building */}
        <path 
          className="energy-flow-line"
          d="M600 50 Q600 80 600 120" 
          strokeDasharray="10 8"
          strokeLinecap="round"
        >
          <animate attributeName="strokeDashoffset" from="0" to="-18" dur="2s" repeatCount="indefinite" />
        </path>
        <path 
          className="energy-flow-line"
          d="M655 50 Q655 80 655 120" 
          strokeDasharray="10 8"
          strokeLinecap="round"
        >
          <animate attributeName="strokeDashoffset" from="0" to="-18" dur="2s" repeatCount="indefinite" begin="0.3s" />
        </path>
        <path 
          className="energy-flow-line"
          d="M710 50 Q710 80 710 120" 
          strokeDasharray="10 8"
          strokeLinecap="round"
        >
          <animate attributeName="strokeDashoffset" from="0" to="-18" dur="2s" repeatCount="indefinite" begin="0.6s" />
        </path>
        <path 
          className="energy-flow-line"
          d="M765 50 Q765 80 765 120" 
          strokeDasharray="10 8"
          strokeLinecap="round"
        >
          <animate attributeName="strokeDashoffset" from="0" to="-18" dur="2s" repeatCount="indefinite" begin="0.9s" />
        </path>
      </g>

      {/* Ground plane */}
      <rect x="0" y="500" width="800" height="50" fill="url(#groundGrad)" />
      <line x1="0" y1="500" x2="800" y2="500" stroke="#2a4a2e" strokeWidth="2" />

      {/* Ground texture lines */}
      <g stroke="#1a3020" strokeWidth="0.5" opacity="0.5">
        <line x1="100" y1="510" x2="140" y2="540" />
        <line x1="300" y1="510" x2="330" y2="540" />
        <line x1="500" y1="510" x2="520" y2="540" />
        <line x1="650" y1="510" x2="670" y2="540" />
      </g>

      {/* Tree on left side */}
      <g transform="translate(80, 480)">
        <path d="M0 20 L0 0" stroke="#1a4a1e" strokeWidth="4" strokeLinecap="round" />
        <circle cx="0" cy="-5" r="30" fill="url(#treeGrad)" />
        <circle cx="-8" cy="5" r="22" fill="url(#treeGrad)" opacity="0.8" />
        <circle cx="8" cy="5" r="22" fill="url(#treeGrad)" opacity="0.8" />
        <circle cx="0" cy="-15" r="18" fill="url(#treeGrad)" opacity="0.6" />
      </g>

      {/* Tree on right side */}
      <g transform="translate(720, 480)">
        <path d="M0 20 L0 0" stroke="#1a4a1e" strokeWidth="3" strokeLinecap="round" />
        <circle cx="0" cy="-5" r="25" fill="url(#treeGrad)" />
        <circle cx="-6" cy="5" r="18" fill="url(#treeGrad)" opacity="0.8" />
        <circle cx="6" cy="5" r="18" fill="url(#treeGrad)" opacity="0.8" />
      </g>

      {/* Energy measurement annotations - animated */}
      <g fontFamily="var(--mono)" fontSize="10" fill="#e8b84d" opacity="0.8">
        <text x="600" y="90" textAnchor="middle" className="measurement-label">
          <tspan x="600" dy="0">2.8 kWh</tspan>
          <animate attributeName="opacity" values="0.5;1;0.5" dur="3s" repeatCount="indefinite" />
        </text>
        <text x="680" y="150" textAnchor="middle" className="measurement-label">
          <tspan x="680" dy="0">1.4 kWh</tspan>
          <animate attributeName="opacity" values="0.5;1;0.5" dur="3s" repeatCount="indefinite" begin="0.5s" />
        </text>
        <text x="600" y="220" textAnchor="middle" className="floor-label">
          <tspan x="600" dy="0">Floor 1</tspan>
        </text>
        <text x="600" y="160" textAnchor="middle" className="floor-label">
          <tspan x="600" dy="0">Floor 2</tspan>
        </text>
        <text x="600" y="100" textAnchor="middle" className="floor-label">
          <tspan x="600" dy="0">Floor 3</tspan>
        </text>
        <text x="600" y="40" textAnchor="middle" className="floor-label">
          <tspan x="600" dy="0">Floor 4</tspan>
        </text>
        <text x="600" y="-20" textAnchor="middle" className="floor-label">
          <tspan x="600" dy="0">Floor 5</tspan>
        </text>
        <text x="600" y="-80" textAnchor="middle" className="floor-label">
          <tspan x="600" dy="0">Floor 6</tspan>
        </text>
      </g>

      {/* Lightning bolt decorative - top right */}
      <g transform="translate(680, 30)">
        <path 
          className="lightning-bolt"
          d="M0 0 L-5 15 L5 15 L-2 30 L8 15 L-8 15 L0 0 Z" 
          fill="#f5d06e" 
          opacity="0.7"
        >
          <animateTransform 
            attributeName="transform" 
            type="rotate" 
            values="0;5;0;-5;0" 
            dur="4s" 
            repeatCount="indefinite" 
          />
        </path>
      </g>

      {/* WattWise logo mark - bottom center */}
      <g transform="translate(400, 515)" opacity="0.5">
        <circle r="12" fill="#1a3022" stroke="#2a4a2e" strokeWidth="1.5" />
        <path d="M0 -6 L-3 0 L3 0 Z M0 0 L-3 6 L3 6 Z" fill="#f5d06e" />
        <animate attributeName="opacity" values="0.5;0.8;0.5" dur="3s" repeatCount="indefinite" />
      </g>
    </svg>
  );
}