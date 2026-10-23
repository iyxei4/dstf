export function PageFooter({
  showPrivacy = true,
  onPrivacyClick,
  showContact = false,
  contactEmail = "",
}) {
  return (
    <footer
      className={`page-footer lp-footer${showContact && contactEmail ? " lp-footer-with-contact" : ""}`}
    >
      <span>
        {showPrivacy && (
          <a href="#" onClick={(e) => { e.preventDefault(); onPrivacyClick?.(); }}>
            PRIVACY POLICY
          </a>
        )}
        {showPrivacy && <span className="footer-sep">·</span>}
        <a href="/tos" className="lp-footer-link">
          TERMS & CONDITIONS
        </a>
        <span className="footer-sep">·</span>
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
        <a href="/about">ABOUT THIS APP</a>
        <span className="footer-sep">·</span>
        WATTWISE MCS <span className="footer-year">/ 2026</span>
      </span>
      {showContact && contactEmail && (
        <div className="lp-footer-contact">
          Questions or inquiries:<br />
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          <span className="lp-footer-data-note">
            We only collect data necessary for room-scoped energy reporting.
          </span>
        </div>
      )}
    </footer>
  );
}
