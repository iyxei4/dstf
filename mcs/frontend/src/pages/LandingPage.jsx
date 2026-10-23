import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  Calculator,
  Gauge,
  History,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Users,
  BellRing,
  BarChart3,
  Menu,
  X,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";
import { Card, CardBody } from "../components/design";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "About", href: "#about" },
  { label: "Get Started", href: "/auth/signup" },
];

const features = [
  {
    title: "Building & Room Management",
    body: "Create buildings and floors, then add rooms to match your real campus layout.",
    icon: Building2,
  },
  {
    title: "Appliance Monitoring",
    body: "Give every appliance a name and rated wattage so its load is known and tracked.",
    icon: PlugZap,
  },
  {
    title: "Consumption Estimates",
    body: "Watts × hours ÷ 1000, shown inline with every estimate. No black boxes.",
    icon: Gauge,
  },
  {
    title: "Activity Notifications",
    body: "See new reports and coordinator sign-ins in real time without refreshing.",
    icon: BellRing,
  },
  {
    title: "Reports & Analytics",
    body: "Filter by month, building, room, coordinator, or appliance for insights.",
    icon: BarChart3,
  },
  {
    title: "EMC Account Management",
    body: "Invite coordinators, assign them to rooms, and revoke access when terms end.",
    icon: Users,
  },
];

const steps = [
  {
    number: "01",
    title: "Structure your workspace",
    body: "Name your workspace, add buildings and floors, then create the rooms inside them.",
  },
  {
    number: "02",
    title: "Add your coordinators",
    body: "Create EMC accounts and assign each to a single room. They only see that room.",
  },
  {
    number: "03",
    title: "Report and review",
    body: "Coordinators submit ON/OFF reports. You see latest status, estimates, and history.",
  },
];

const aboutItems = [
  {
    title: "Room-scoped access",
    body: "Coordinators only see the room they are assigned to.",
    icon: ShieldCheck,
  },
  {
    title: "History preserved",
    body: "Reports are appended, never overwritten; latest status is derived.",
    icon: History,
  },
  {
    title: "Honest estimates",
    body: "No report means unknown, not OFF. Energy comes from reported runtime.",
    icon: Calculator,
  },
];

function MobileMenu({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="lp-mobile-overlay" onClick={onClose}>
      <div className="lp-mobile-menu" onClick={(event) => event.stopPropagation()}>
        <div className="lp-mobile-header">
          <span className="lp-mobile-brand">wattwise.</span>
          <button
            type="button"
            className="lp-mobile-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="lp-mobile-nav" aria-label="Mobile sections">
          {navLinks.map((link) =>
            link.href.startsWith("#") ? (
              <a
                key={link.label}
                href={link.href}
                className="lp-mobile-link"
                onClick={onClose}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                to={link.href}
                className="lp-mobile-link"
                onClick={onClose}
              >
                {link.label}
              </Link>
            ),
          )}
          <a
            href="mailto:cshswattwise@gmail.com"
            className="lp-mobile-link"
            onClick={onClose}
          >
            Contact: cshswattwise@gmail.com
          </a>
        </nav>
      </div>
    </div>
  );
}

function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 600 450"
      className="lp-hero-illustration"
      aria-hidden="true"
      role="img"
    >
      <defs>
        <linearGradient id="energyBurst" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#79bd91" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#79bd91" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#141c17" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="buildingGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#293d30" />
          <stop offset="100%" stopColor="#1f2a23" />
        </linearGradient>
      </defs>

      {/* Energy burst background */}
      <ellipse
        cx="320"
        cy="180"
        rx="280"
        ry="160"
        fill="url(#energyBurst)"
        className="energy-burst"
      />

      {/* Grid lines */}
      <g stroke="#35483c" strokeWidth="0.5" opacity="0.4">
        {[...Array(12)].map((_, i) => (
          <line key={i} x1={50 + i * 45} y1="50" x2={50 + i * 45} y2="400" />
        ))}
        {[...Array(8)].map((_, i) => (
          <line key={i} x1="50" y1={50 + i * 45} x2="550" y2={50 + i * 45} />
        ))}
      </g>

      {/* Building - Main structure */}
      <g transform="translate(180, 120)">
        {/* Building base */}
        <rect x="0" y="180" width="240" height="80" rx="2" fill="url(#buildingGrad)" stroke="#35483c" strokeWidth="1" />

        {/* Floors */}
        {[3, 2, 1, 0].map((floor) => (
          <g key={floor} transform={`translate(0, ${floor * 45})`}>
            {/* Floor slab */}
            <rect x="-10" y="135" width="260" height="8" fill="#293d30" stroke="#35483c" strokeWidth="0.5" />

            {/* Windows - 5 per floor */}
            {[0, 1, 2, 3, 4].map((w) => (
              <rect
                key={w}
                x={12 + w * 44}
                y="45"
                width="28"
                height="38"
                rx="1"
                fill="#141c17"
                stroke="#35483c"
                strokeWidth="0.8"
              />
            ))}

            {/* Window glow for some rooms */}
            {[1, 3].map((w) => (
              <rect
                key={`glow-${w}`}
                x={14 + w * 44}
                y="47"
                width="24"
                height="34"
                rx="1"
                fill="#79bd91"
                opacity="0.15"
              />
            ))}
          </g>
        ))}

        {/* Roof */}
        <path
          d="M-10 45 L110 0 L250 45 Z"
          fill="#1a261f"
          stroke="#35483c"
          strokeWidth="1"
        />

        {/* Solar panels on roof */}
        <g transform="translate(20, -5)">
          {[0, 1, 2].map((p) => (
            <rect
              key={p}
              x={p * 70}
              y="0"
              width="55"
              height="18"
              rx="1"
              fill="#0d1a12"
              stroke="#2a5c3a"
              strokeWidth="0.8"
            />
          ))}
        </g>

        {/* Entrance */}
        <rect x="100" y="220" width="40" height="40" fill="#1a261f" stroke="#35483c" strokeWidth="1" rx="1" />
        <rect x="115" y="230" width="10" height="30" fill="#35483c" />
      </g>

      {/* Second building - smaller */}
      <g transform="translate(440, 200)">
        <rect x="0" y="100" width="120" height="160" rx="2" fill="url(#buildingGrad)" stroke="#35483c" strokeWidth="1" />
        {[0, 1, 2].map((floor) => (
          <g key={floor} transform={`translate(0, ${floor * 40 + 100})`}>
            <rect x="10" y="10" width="22" height="25" rx="1" fill="#141c17" stroke="#35483c" strokeWidth="0.5" />
            <rect x="48" y="10" width="22" height="25" rx="1" fill="#141c17" stroke="#35483c" strokeWidth="0.5" />
            <rect x="86" y="10" width="22" height="25" rx="1" fill="#141c17" stroke="#35483c" strokeWidth="0.5" />
          </g>
        ))}
        <rect x="40" y="60" width="40" height="12" fill="#1a261f" stroke="#35483c" strokeWidth="0.5" rx="1" />
      </g>

      {/* Energy flow lines */}
      <g stroke="#79bd91" strokeWidth="1.5" opacity="0.6" fill="none">
        <path d="M300 280 Q380 250 420 260" strokeDasharray="8 4" className="energy-flow" />
        <path d="M300 300 Q360 320 410 310" strokeDasharray="8 4" className="energy-flow" />
        <path d="M300 320 Q340 350 390 340" strokeDasharray="8 4" className="energy-flow" />
      </g>

      {/* Measurement annotations */}
      <g fontFamily="var(--mono)" fontSize="10" fill="#79bd91" opacity="0.7">
        <text x="220" y="80" textAnchor="middle">⚡ 2.8 kWh</text>
        <text x="480" y="160" textAnchor="middle">⚡ 1.4 kWh</text>
        <text x="150" y="380" textAnchor="middle">Floor 1</text>
        <text x="150" y="335" textAnchor="middle">Floor 2</text>
        <text x="150" y="290" textAnchor="middle">Floor 3</text>
        <text x="150" y="245" textAnchor="middle">Floor 4</text>
      </g>

      {/* Lightning bolt decorative */}
      <g transform="translate(320, 80)" className="lightning-bolt">
        <path
          d="M0 0 L-8 20 L4 20 L-4 40 L8 -20 L-4 -20 Z"
          fill="#79bd91"
          opacity="0.2"
        />
      </g>
    </svg>
  );
}

export function LandingPage() {
  const { darkMode, toggleTheme } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <main className="lp-page lp-landing">
      <Topbar
        nav={
          <nav className="topbar-nav" aria-label="Sections">
            {navLinks.map((link) =>
              link.href.startsWith("#") ? (
                <a key={link.label} href={link.href}>
                  {link.label}
                </a>
              ) : (
                <Link key={link.label} to={link.href}>
                  {link.label}
                </Link>
              ),
            )}
          </nav>
        }
        right={
          <>
            <span className="lp-nav-cta-group">
              <Link to="/auth/signup" className="ds-btn ds-btn--ghost ds-btn--sm">
                Sign in
              </Link>
              <Link to="/auth/signup" className="ds-btn ds-btn--primary ds-btn--sm">
                Get started
                <ArrowUpRight size={14} />
              </Link>
            </span>
            <button
              type="button"
              className="lp-hamburger"
              aria-label="Open menu"
              onClick={() => setIsMenuOpen(true)}
            >
              <Menu size={18} />
            </button>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
          </>
        }
      />

      <MobileMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />

      {/* Hero */}
      <section className="lp-hero" aria-labelledby="hero-title">
        <div className="lp-hero-layer" />
        <div className="lp-hero-grid">
          <div className="lp-hero-content">
            <div className="lp-badge">
              <Sparkles size={13} />
              <span>Building energy reporting platform</span>
            </div>
            <h1 id="hero-title" className="lp-title">
              <span className="lp-title-line">ENERGY.</span>
              <span className="lp-title-line lp-title-accent">MADE VISIBLE.</span>
              <span className="lp-title-line lp-title-small">
                Management made <em>SMARTER.</em>
              </span>
            </h1>
            <p className="lp-description">
              Monitor buildings, organize classrooms, manage appliances, and
              understand electricity consumption through a simple, centralized
              energy reporting platform.
            </p>
            <div className="lp-ctas">
              <Link to="/auth/signup" className="ds-btn ds-btn--primary ds-btn--lg">
                Get started
                <ArrowUpRight size={16} />
              </Link>
              <a href="#how-it-works" className="ds-btn ds-btn--ghost ds-btn--lg">
                How it works
                <ArrowUpRight size={16} />
              </a>
            </div>
            <div className="lp-trust-indicators">
              <span className="trust-item">
                <ShieldCheck size={14} /> Room-scoped access
              </span>
              <span className="trust-item">
                <History size={14} /> History preserved
              </span>
              <span className="trust-item">
                <Calculator size={14} /> Honest estimates
              </span>
            </div>
          </div>

          <div className="lp-hero-art">
            <HeroIllustration />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="ww-section lp-features" id="features" aria-labelledby="features-title">
        <div className="ww-section-inner">
          <div className="ww-section-head">
            <span className="ww-eyebrow">Features</span>
            <h2 id="features-title" className="ww-section-title">Everything a facility needs.</h2>
            <p className="ww-section-lede">
              One workspace for the buildings you manage, the rooms inside them,
              and the people who report on them.
            </p>
          </div>
          <div className="lp-feature-grid">
            {features.map((feature) => (
              <Card key={feature.title} variant="outlined" hoverable className="lp-feature">
                <CardBody>
                  <span className="ww-icon">
                    <feature.icon size={18} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="ww-section lp-how" id="how-it-works" aria-labelledby="how-title">
        <div className="ww-section-inner">
          <div className="ww-section-head">
            <span className="ww-eyebrow">How it works</span>
            <h2 id="how-title" className="ww-section-title">From workspace to report.</h2>
            <p className="ww-section-lede">
              Three steps, no hardware installation.
            </p>
          </div>
          <div className="lp-steps">
            {steps.map((step) => (
              <article className="lp-step" key={step.number}>
                <span className="lp-step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section className="ww-section lp-about" id="about" aria-labelledby="about-title">
        <div className="ww-section-inner lp-about-grid">
          <div>
            <span className="ww-eyebrow">About WattWise</span>
            <h2 id="about-title" className="ww-section-title">Built for rooms, not guesses.</h2>
            <p className="ww-section-lede">
              WattWise is a user-reported energy reporting platform for schools
              and facilities. Every appliance status comes from a coordinator in
              an assigned room — so the console reflects what was reported, not
              what a sensor assumed.
            </p>
            <p className="ww-section-lede">
              It replaces scattered group chats and paper logs with one clear,
              room-scoped record.
            </p>
          </div>
          <div className="lp-about-list">
            {aboutItems.map((item) => (
              <div className="lp-about-item" key={item.title}>
                <span className="ww-icon">
                  <item.icon size={16} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="lp-cta" aria-labelledby="cta-title">
        <div className="lp-cta-panel">
          <div>
            <h2 id="cta-title">Bring your buildings into focus.</h2>
            <p>Start with one workspace and add rooms as you grow.</p>
          </div>
          <div className="lp-cta-actions">
            <Link to="/auth/signup" className="ds-btn ds-btn--primary ds-btn--lg">
              Get started
              <ArrowUpRight size={16} />
            </Link>
            <a
              href="mailto:cshswattwise@gmail.com"
              className="ds-btn ds-btn--ghost ds-btn--lg"
            >
              Contact us
            </a>
          </div>
        </div>
      </section>

      <PageFooter
        showPrivacy
        showContact
        contactEmail="cshswattwise@gmail.com"
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}