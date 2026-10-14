export function PageFooter({ showPrivacy = true, onPrivacyClick }) {
  return (
    <footer className="page-footer">
      <span>
        <span className="live-dot" /> ENERGY VALUES ARE ESTIMATES · NOT METER
        READINGS
      </span>
      <span>
        {showPrivacy && (
          <a href="#" onClick={(e) => { e.preventDefault(); onPrivacyClick?.(); }}>
            PRIVACY POLICY
          </a>
        )}
        {showPrivacy && <span className="footer-sep">·</span>}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("open-cookies"));
          }}
        >
          COOKIE SETTINGS
        </a>
        <span className="footer-sep">·</span>
        <a href="/mcs/about">ABOUT THIS APP</a>
        <span className="footer-sep">·</span>
        WATTWISE MCS <span className="footer-year">/ 2026</span>
      </span>
    </footer>
  );
}