import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  Gauge,
  PlugZap,
  Sparkles,
  Users,
  BellRing,
  BarChart3,
  X,
  Menu,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";
import { Card, CardBody } from "../components/design";
import { useScrollAnimation, useStaggeredAnimation } from "../hooks/useScrollAnimation";
import { BuildingIllustration } from "../components/landing/BuildingIllustration";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Walkthrough", href: "/interactive" },
  { label: "About", href: "#about" },
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
        </nav>
      </div>
    </div>
  );
}

export function PublicLandingPage() {
  const { darkMode, toggleTheme } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Scroll animations
  const [heroRef, heroVisible] = useScrollAnimation({ threshold: 0.1 });
  const [featuresRef, featuresVisible] = useScrollAnimation({ threshold: 0.1 });
  const [howRef, howVisible] = useScrollAnimation({ threshold: 0.1 });

  // Staggered animations for grid items
  const [getFeatureRef, visibleFeatures] = useStaggeredAnimation(features.length, { delay: 80 });
  const [getStepRef, visibleSteps] = useStaggeredAnimation(steps.length, { delay: 120 });

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
              <Link to="/auth" className="ds-btn ds-btn--ghost ds-btn--sm">
                Sign in
              </Link>
              <Link to="/signup" className="ds-btn ds-btn--primary ds-btn--sm">
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
      <section ref={heroRef} className="lp-hero" aria-labelledby="hero-title">
        <div className="lp-hero-layer" />
        <div className="lp-hero-grid">
          <div className="lp-hero-content">
            <div className={`lp-badge lp-animate lp-animate--fade-up ${heroVisible ? "is-visible" : ""} lp-stagger-1`}>
              <Sparkles size={13} />
              <span>Building energy reporting platform</span>
            </div>
            <h1 id="hero-title" className={`lp-title lp-animate lp-animate--fade-up ${heroVisible ? "is-visible" : ""} lp-stagger-2`}>
              <span className="lp-title-line">ENERGY.</span>
              <span className="lp-title-line lp-title-accent">MADE VISIBLE.</span>
              <span className="lp-title-line lp-title-small">
                Management made <em>SMARTER.</em>
              </span>
            </h1>
            <p className={`lp-description lp-animate lp-animate--fade-up ${heroVisible ? "is-visible" : ""} lp-stagger-3`}>
              Monitor buildings, organize classrooms, manage appliances, and
              understand electricity consumption through a simple, centralized
              energy reporting platform.
            </p>
            <div className={`lp-ctas lp-animate lp-animate--fade-up ${heroVisible ? "is-visible" : ""} lp-stagger-4`}>
              <Link to="/signup" className="ds-btn ds-btn--primary ds-btn--lg">
                Get started
                <ArrowUpRight size={16} />
              </Link>
              <a href="#how-it-works" className="ds-btn ds-btn--ghost ds-btn--lg">
                How it works
                <ArrowUpRight size={16} />
              </a>
            </div>
          </div>

          <div className={`lp-hero-art lp-animate lp-animate--slide-right ${heroVisible ? "is-visible" : ""} lp-stagger-3`}>
            <BuildingIllustration />
          </div>
        </div>
      </section>

      {/* Features */}
      <section ref={featuresRef} className="ww-section lp-features" id="features" aria-labelledby="features-title">
        <div className="ww-section-inner">
          <div className={`ww-section-head lp-animate lp-animate--fade-up ${featuresVisible ? "is-visible" : ""} lp-stagger-1`}>
            <span className="ww-eyebrow">Features</span>
            <h2 id="features-title" className="ww-section-title">Everything a facility needs.</h2>
            <p className="ww-section-lede">
              One workspace for the buildings you manage, the rooms inside them,
              and the people who report on them.
            </p>
          </div>
          <div className="lp-feature-grid">
            {features.map((feature, index) => (
              <Card
                key={feature.title}
                variant="outlined"
                hoverable
                className={`lp-feature lp-animate lp-animate--fade-up ${visibleFeatures.has(index) ? "is-visible" : ""} lp-stagger-${(index % 6) + 1}`}
                ref={getFeatureRef(index)}
              >
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
      <section ref={howRef} className="ww-section lp-how" id="how-it-works" aria-labelledby="how-title">
        <div className="ww-section-inner">
          <div className={`ww-section-head lp-animate lp-animate--fade-up ${howVisible ? "is-visible" : ""} lp-stagger-1`}>
            <span className="ww-eyebrow">How it works</span>
            <h2 id="how-title" className="ww-section-title">From workspace to report.</h2>
            <p className="ww-section-lede">
              Three steps, no hardware installation.
            </p>
          </div>
          <div className="lp-steps">
            {steps.map((step, index) => (
              <article
                key={step.number}
                className={`lp-step lp-animate lp-animate--fade-up ${visibleSteps.has(index) ? "is-visible" : ""} lp-stagger-${index + 1}`}
                ref={getStepRef(index)}
              >
                <span className="lp-step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
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