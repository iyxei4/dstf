import { useState, useEffect } from "react";
import { Cookie, Shield, Check, X, Settings, Clock } from "lucide-react";

const cookie = [
  {
    id: "essential",
    name: "Essential",
    description: "Required for authentication, security, and basic app functionality. Cannot be disabled.",
    icon: Shield,
    required: true,
    cookies: [
      { name: "wattwise_admin", purpose: "Admin session (8 hrs, HttpOnly, Secure, SameSite=Strict)" },
      { name: "wattwise_user", purpose: "User session (8 hrs, HttpOnly, Secure, SameSite=Strict)" },
    ],
  },
  {
    id: "preferences",
    name: "Preferences",
    description: "Remembers your theme choice and username for convenience.",
    icon: Settings,
    required: false,
    cookies: [
      { name: "wattwise-theme", purpose: "Light/dark mode preference (localStorage, no expiry)" },
      { name: "wattwise-user", purpose: "Remembered username for login (localStorage, no expiry)" },
    ],
  },
  {
    id: "functionality",
    name: "Functionality",
    description: "Enables live timers and realtime dashboard updates.",
    icon: Clock,
    required: false,
    cookies: [
      { name: "wattwise-running:{user}", purpose: "Active appliance timer state (localStorage, cleared on sign-out)" },
      { name: "Supabase Realtime", purpose: "Live data sync for admin dashboard (optional, requires env vars)" },
    ],
  },
];

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [preferences, setPreferences] = useState({
    essential: true,
    preferences: true,
    functionality: true,
  });

  // The footer's "Cookie settings" link reopens the preferences modal even
  // after a choice has been stored.
  useEffect(() => {
    const openDetails = () => setShowDetails(true);
    window.addEventListener("open-cookies", openDetails);
    return () => window.removeEventListener("open-cookies", openDetails);
  }, []);

  useEffect(() => {
    const consent = localStorage.getItem("wattwise-cookie-consent");
    if (!consent) {
      setShowBanner(true);
    } else {
      try {
        const parsed = JSON.parse(consent);
        setPreferences(parsed.preferences || preferences);
      } catch {
        setShowBanner(true);
      }
    }
  }, []);

  const saveConsent = (acceptedPreferences) => {
    const consent = {
      timestamp: new Date().toISOString(),
      preferences: acceptedPreferences,
    };
    localStorage.setItem("wattwise-cookie-consent", JSON.stringify(consent));
    setShowBanner(false);
  };

  const acceptAll = () => {
    const allEnabled = cookie.reduce((acc, cat) => ({ ...acc, [cat.id]: true }), {});
    saveConsent(allEnabled);
  };

  const acceptSelected = () => {
    saveConsent({ ...preferences, essential: true });
  };

  const rejectAll = () => {
    saveConsent({ essential: true, preferences: false, functionality: false });
  };

  const toggleCategory = (categoryId) => {
    if (categoryId === "essential") return;
    setPreferences((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
  };

  if (!showBanner && !showDetails) return null;

  return (
    <>
      {showBanner && !showDetails && (
        <div className="cookie-banner animate-slide-up" role="dialog" aria-label="Cookie consent">
          <div className="cookie-banner-content">
            <div className="cookie-icon">
              <Cookie size={24} />
            </div>
            <div className="cookie-text">
              <strong>We use cookies and local storage</strong>
              <p>
                WattWise uses essential cookies for authentication and optional storage for
                preferences and live timers. No analytics or tracking.
              </p>
            </div>
            <div className="cookie-actions">
              <button className="button button-secondary" onClick={() => setShowDetails(true)}>
                <Settings size={14} /> Customize
              </button>
              <button className="button button-outline" onClick={rejectAll}>
                Reject optional
              </button>
              <button className="button button-primary" onClick={acceptAll}>
                <Check size={14} /> Accept all
              </button>
            </div>
          </div>
        </div>
      )}
      {showDetails && (
        <div className="modal-overlay animate-fade-in" onClick={() => setShowDetails(false)}>
          <div className="modal cookie-modal animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <Cookie className="modal-icon" size={24} />
                <div>
                  <h2>Cookie & Storage Preferences</h2>
                  <p className="modal-subtitle">Manage what data we store in your browser</p>
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowDetails(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="modal-body cookie-modal-body">
              {cookie.map((category) => (
                <div key={category.id} className="cookie-category">
                  <div className="cookie-category-header">
                    <div className="cookie-category-info">
                      <category.icon className="cookie-category-icon" size={20} />
                      <div>
                        <h4>{category.name}</h4>
                        <p>{category.description}</p>
                      </div>
                    </div>
                    <label className={`cookie-toggle ${preferences[category.id] ? "on" : ""} ${category.required ? "disabled" : ""}`}>
                      <input
                        type="checkbox"
                        checked={preferences[category.id]}
                        onChange={() => toggleCategory(category.id)}
                        disabled={category.required}
                        aria-label={category.name}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                  <ul className="cookie-list">
                    {category.cookies.map((cookie, i) => (
                      <li key={i}>
                        <code>{cookie.name}</code>
                        <span>{cookie.purpose}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="button button-outline" onClick={rejectAll}>
                <X size={14} /> Reject optional
              </button>
              <button className="button button-primary" onClick={acceptSelected}>
                <Check size={14} /> Save preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}