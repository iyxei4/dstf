import { useState, useEffect } from "react";
import { X, Check, Shield } from "lucide-react";

const PRIVACY_CONTENT = {
  lastUpdated: "October 14, 2026",
  sections: [
    {
      title: "Data We Collect",
      items: [
        "Account credentials (username, hashed password) — provided by administrators",
        "Classroom section and room assignment",
        "Appliance usage records: appliance name, wattage, hours used, date/time, optional occupant count",
        "Session cookies for authentication (admin and user sessions, 8-hour expiry)",
        "Theme preference (light/dark) stored in localStorage",
        "Running timer state stored in localStorage per user account",
      ],
    },
    {
      title: "How We Use Your Data",
      items: [
        "Authenticate users and administrators",
        "Calculate energy estimates: E = P × t ÷ 1000 (watts × hours ÷ 1000 = kWh)",
        "Aggregate usage by room, section, appliance, and time period for reports",
        "Estimate costs using the configured electricity rate (PHP/kWh)",
        "Identify high-consumption rooms (1.5× building average) for admin review",
      ],
    },
    {
      title: "Data Storage & Security",
      items: [
        "SQLite database (wattwise.db) on the server — no cloud sync by default",
        "Passwords hashed with PBKDF2-SHA256 (310,000 iterations)",
        "Session tokens signed with HMAC using MCS_SESSION_SECRET",
        "Cookies: HttpOnly, SameSite=Strict, Secure (when MCS_SECURE_COOKIES=true), Path=/api",
        "Supabase Realtime (optional) for live dashboard updates — only if VITE_SUPABASE_* env vars are set",
      ],
    },
    {
      title: "Cookies & Local Storage",
      items: [
        "wattwise_admin — admin session cookie (8 hours, HttpOnly, SameSite=Strict)",
        "wattwise_user — user session cookie (8 hours, HttpOnly, SameSite=Strict)",
        "wattwise-theme — theme preference (localStorage, no expiry)",
        "wattwise-user — remembered username (localStorage, no expiry)",
        "wattwise-running:{username} — active timer state (localStorage, cleared on sign-out)",
        "wattwise-cookie-consent — cookie consent choice (localStorage, 1 year)",
      ],
    },
    {
      title: "Your Rights",
      items: [
        "Access: Admins can view all user accounts and usage records",
        "Rectification: Admins can update room assignments, sections, and appliance data",
        "Deletion: Admins can reject/remove pending user registrations; approved accounts require admin action",
        "Portability: Usage data export not built in — contact admin for database access",
        "Opt-out: Disable Supabase Realtime by removing VITE_SUPABASE_* env vars",
      ],
    },
    {
      title: "Third Parties",
      items: [
        "No analytics, tracking, or advertising scripts",
        "Supabase (optional): only if you configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for realtime updates",
        "Google Fonts: DM Sans, DM Mono, Manrope loaded from fonts.googleapis.com",
        "Lucide React icons: bundled locally, no external requests",
      ],
    },
    {
      title: "Data Retention",
      items: [
        "Usage records: kept indefinitely unless manually deleted by admin",
        "Appliance catalog: kept indefinitely",
        "User accounts: kept until admin removes them",
        "Sessions: expire after 8 hours of inactivity",
        "LocalStorage items: persist until manually cleared",
      ],
    },
    {
      title: "Contact",
      items: [
        "This app is self-hosted. For data requests, contact your system administrator.",
        "No external data processor — all data stays on your server.",
      ],
    },
  ],
};

export function PrivacyPolicy({ isOpen, onClose }) {
  const [activeSection, setActiveSection] = useState(0);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <Shield className="modal-icon" size={24} />
            <div>
              <h2>Privacy Policy</h2>
              <p className="modal-subtitle">WattWise Classrooms — Last updated: {PRIVACY_CONTENT.lastUpdated}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close privacy policy">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <nav className="modal-toc" aria-label="Policy sections">
            {PRIVACY_CONTENT.sections.map((section, index) => (
              <button
                key={section.title}
                className={`toc-item ${activeSection === index ? "active" : ""}`}
                onClick={() => setActiveSection(index)}
              >
                <span className="toc-number">{index + 1}</span>
                {section.title}
              </button>
            ))}
          </nav>
          <div className="modal-content" role="tabpanel" aria-labelledby="policy-section-title">
            <section className="policy-section animate-fade-in">
              <h3 id="policy-section-title">{PRIVACY_CONTENT.sections[activeSection].title}</h3>
              <ul>
                {PRIVACY_CONTENT.sections[activeSection].items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
        <div className="modal-footer">
          <button className="button button-primary" onClick={onClose}>
            <Check size={16} /> Understood
          </button>
        </div>
      </div>
    </div>
  );
}