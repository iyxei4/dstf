import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Calculator,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Keyboard,
  Maximize2,
  Minimize2,
  MonitorSmartphone,
  MousePointer2,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";

const DEMO_SOURCES = {
  landing: "/",
  signup: "/signup",
  admin: "/mcs/admin/dashboard",
  user: "/mcs/user",
};

const DEMO_LABELS = {
  landing: "Public site",
  signup: "Sign up",
  admin: "Admin console",
  user: "EMC workspace",
};

const ADMIN_CREDENTIALS = { username: "interactive-admin", password: "123" };

function emcCredentials() {
  return { username: "interactive-user", password: "123" };
}

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function frameDocument(refs, key) {
  try {
    const doc = refs.current[key]?.contentDocument;
    if (!doc || doc.readyState === "loading") return null;
    return doc;
  } catch {
    return null;
  }
}

function waitForElement(refs, key, selector, isCurrent, timeout = 20000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (!isCurrent()) {
        resolve(null);
        return;
      }
      const element = frameDocument(refs, key)?.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }
      if (Date.now() - startedAt > timeout) {
        resolve(null);
        return;
      }
      window.setTimeout(check, 120);
    };
    check();
  });
}

function typeInto(element, text, isCurrent, delay = 42) {
  const frameWindow = element.ownerDocument.defaultView;
  const descriptor = Object.getOwnPropertyDescriptor(
    frameWindow.HTMLInputElement.prototype,
    "value",
  );
  const setValue = (value) => {
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new frameWindow.Event("input", { bubbles: true }));
  };

  if (window.matchMedia("(pointer: fine)").matches) {
    element.focus({ preventScroll: true });
  }
  setValue("");

  return new Promise((resolve) => {
    let index = 0;
    const step = () => {
      if (!isCurrent()) {
        resolve(false);
        return;
      }
      index += 1;
      setValue(text.slice(0, index));
      if (index >= text.length) {
        resolve(true);
        return;
      }
      window.setTimeout(step, delay);
    };
    step();
  });
}

function submitAuthForm(doc) {
  const form = doc.querySelector("form.auth-form");
  if (!form) return false;
  const button =
    form.querySelector("button[type='submit']") || form.querySelector("button");
  if (button) {
    button.click();
    return true;
  }
  if (form.requestSubmit) {
    form.requestSubmit();
    return true;
  }
  return false;
}

function clickAdminNav(doc, label) {
  const links = [...doc.querySelectorAll(".admin-nav .nav-link")];
  const target = links.find((link) =>
    link.textContent.trim().startsWith(label),
  );
  if (!target) return false;
  target.click();
  return true;
}

async function runSignupDemo({ refs, isCurrent, markDone }) {
  const confirmInput = await waitForElement(
    refs,
    "signup",
    "form.auth-form #confirm-password",
    isCurrent,
  );
  if (!confirmInput) return;
  const form = confirmInput.closest("form");
  if (!form) return;

  const suffix = Date.now().toString(36);
  const fields = [
    ["#username", `walkthrough${suffix}`],
    ["#campus-name", "CSHS"],
    ["#email", `walkthrough${suffix}@wattwise.demo`],
    ["#password", "mcs2026demo"],
    ["#confirm-password", "mcs2026demo"],
  ];

  for (const [selector, value] of fields) {
    if (!isCurrent()) return;
    const input = form.querySelector(selector);
    if (!input) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    const typed = await typeInto(input, value, isCurrent);
    if (!typed) return;
    await wait(110);
  }

  await wait(260);
  if (!isCurrent()) return;
  if (submitAuthForm(form.ownerDocument)) markDone();
}

async function runAdminDemo({ refs, isCurrent, markDone }) {
  const first = await waitForElement(
    refs,
    "admin",
    ".admin-page .admin-nav, form.auth-form",
    isCurrent,
    25000,
  );
  if (!first) return;

  if (!frameDocument(refs, "admin")?.querySelector(".admin-page")) {
    const form = first.closest("form");
    const username = form?.querySelector("input[autocomplete='username']");
    const password = form?.querySelector("input[autocomplete='current-password']");
    if (!form || !username || !password) return;

    if (!(await typeInto(username, ADMIN_CREDENTIALS.username, isCurrent))) return;
    await wait(120);
    if (!(await typeInto(password, ADMIN_CREDENTIALS.password, isCurrent))) return;
    await wait(260);
    if (!isCurrent()) return;
    submitAuthForm(form.ownerDocument);
  }

  const nav = await waitForElement(
    refs,
    "admin",
    ".admin-page .admin-nav",
    isCurrent,
    30000,
  );
  if (!nav) return;
  markDone();

  await wait(1500);
  const tour = ["Reports", "Buildings & rooms", "Users & facilities", "Overview"];
  for (let index = 0; index < tour.length; index += 1) {
    if (!isCurrent()) return;
    clickAdminNav(nav.ownerDocument, tour[index]);
    if (index < tour.length - 1) await wait(3200);
  }
}

async function runEmcDemo({ refs, isCurrent, markDone }) {
  const first = await waitForElement(
    refs,
    "user",
    ".workspace-page, form.auth-form",
    isCurrent,
    25000,
  );
  if (!first) return;

  const doc = frameDocument(refs, "user");
  if (doc?.querySelector("form.auth-form")) {
    const form = doc.querySelector("form.auth-form");
    const username = form.querySelector("input[autocomplete='username']");
    const password = form.querySelector("input[autocomplete='current-password']");
    if (!username || !password) return;

    const credentials = emcCredentials();
    if (!(await typeInto(username, credentials.username, isCurrent))) return;
    await wait(120);
    if (!(await typeInto(password, credentials.password, isCurrent))) return;
    await wait(260);
    if (!isCurrent()) return;
    submitAuthForm(doc);
  }

  const panel = await waitForElement(
    refs,
    "user",
    ".appliance-list-panel",
    isCurrent,
    30000,
  );
  if (!panel) return;

  await wait(700);
  if (!isCurrent()) return;
  const table =
    frameDocument(refs, "user")?.querySelector(".appliance-table") || panel;
  table.scrollIntoView({ behavior: "smooth", block: "start" });
  await wait(1100);

  const firstSwitch = await waitForElement(
    refs,
    "user",
    ".power-switch[aria-checked='false']:not(:disabled)",
    isCurrent,
    12000,
  );
  if (!firstSwitch) {
    frameDocument(refs, "user")
      ?.querySelector(".appliance-table")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    markDone();
    return;
  }

  for (let index = 0; index < 30; index += 1) {
    if (!isCurrent()) return;
    const currentDoc = frameDocument(refs, "user");
    const powerSwitch = currentDoc?.querySelector(
      ".power-switch[aria-checked='false']:not(:disabled)",
    );
    if (!powerSwitch) break;
    powerSwitch.click();
    await wait(480);
  }

  await wait(300);
  if (!isCurrent()) return;
  frameDocument(refs, "user")
    ?.querySelector(".appliance-table")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
  markDone();
}

const SLIDE_AUTOMATION = {
  signup: runSignupDemo,
  admin: runAdminDemo,
  "emc-login": runEmcDemo,
};

// Short cues only. The presenter script stays outside this page.
const SLIDES = [
  {
    id: "title",
    kind: "title",
    eyebrow: "INTERACTIVE WALKTHROUGH",
    title: "WATTWISE",
    subtitle: "Classroom energy, made visible.",
    lead: "A live walkthrough of the reporting workspace — not a slideshow of mockups.",
  },
  {
    id: "problem",
    kind: "content",
    kicker: "01 · THE GAP",
    title: "Everyday devices. Invisible costs.",
    cues: [
      "Fans, lights, screens, printers",
      "Hours of use go untracked",
      "No shared view of the campus",
    ],
    note: "Open with a simple question about today's electricity use.",
  },
  {
    id: "intro",
    kind: "demo",
    kicker: "02 · THE SYSTEM",
    title: "A working system, not a mockup.",
    cues: [
      "One coordinator per room",
      "Custom date and time correction",
      "Explore the live app",
    ],
    demo: "landing",
    demoHint: "Open the public site, then move into the reporting flow.",
  },
  {
    id: "signup",
    kind: "demo",
    kicker: "03 · ACCESS",
    title: "From sign-up to assigned room.",
    cues: [
      "Register an account",
      "Admin approves access",
      "Room-scoped sign-in",
    ],
    demo: "signup",
    demoHint: "The form fills itself, then creates a pending account.",
  },
  {
    id: "formula",
    kind: "formula",
    kicker: "04 · THE MATH",
    title: "The estimate, in one line.",
    cues: ["Power × time ÷ 1,000", "An estimate, not a meter reading"],
    formula: { power: 100, time: 4, result: 0.4 },
  },
  {
    id: "admin",
    kind: "demo",
    kicker: "05 · ADMIN",
    title: "One console for the whole campus.",
    cues: [
      "Buildings and rooms",
      "Appliance wattage",
      "Accounts and access",
      "Reports and analytics",
    ],
    demo: "admin",
    demoHint: "The console signs in and tours its main sections.",
  },
  {
    id: "reports",
    kind: "demo",
    kicker: "06 · REPORTS",
    title: "From records to trends.",
    cues: [
      "Filter by month and room",
      "Compare appliance use",
      "Spot peak periods",
    ],
    demo: "admin",
    demoHint: "The Reports tab is already open in the demo.",
  },
  {
    id: "buildings",
    kind: "demo",
    kicker: "07 · STRUCTURE",
    title: "Model the real campus.",
    cues: [
      "Building → floor → room",
      "Room types and names",
      "Visual room map",
    ],
    demo: "admin",
    demoHint: "Buildings & rooms follows in the same console.",
  },
  {
    id: "emc-login",
    kind: "demo",
    kicker: "08 · EMC",
    title: "A workspace with one room.",
    cues: [
      "One assigned room",
      "Room-scoped access",
      "Recent submissions",
    ],
    demo: "user",
    demoHint: "The demo signs in, finds the appliances, and turns them on.",
  },
  {
    id: "emc-reporting",
    kind: "demo",
    kicker: "09 · REPORTING",
    title: "Report an observation.",
    cues: [
      "ON / OFF",
      "Hours or a custom time",
      "No report means unknown",
    ],
    demo: "user",
    demoHint: "Submit a report and watch the estimate and history update.",
  },
  {
    id: "stack",
    kind: "stack",
    kicker: "10 · UNDER THE HOOD",
    title: "A small, practical stack.",
    cues: [
      "One React frontend",
      "FastAPI on Vercel",
      "Supabase for records",
    ],
    tech: ["React", "FastAPI", "Supabase", "Vercel"],
  },
  {
    id: "future",
    kind: "content",
    kicker: "11 · NEXT",
    title: "From snapshots to patterns.",
    cues: [
      "More classrooms",
      "Longer reporting history",
      "Independent validation",
    ],
    note: "Keep the scope honest: these are reports, not sensor telemetry.",
  },
  {
    id: "closing",
    kind: "closing",
    kicker: "12 · WattWise",
    title: "Thank you, we are now ready for your questions!",
    cues: ["Visible use", "Clearer decisions", "A more sustainable campus"],
  },
];

function CueList({ cues }) {
  return (
    <ul className="ip-cues">
      {cues.map((cue, index) => (
        <li key={cue} style={{ "--cue-index": index }}>
          <span className="ip-cue-mark">
            <ChevronRight size={14} />
          </span>
          <span>{cue}</span>
        </li>
      ))}
    </ul>
  );
}

function TryThis({ children }) {
  return (
    <div className="ip-try">
      <MousePointer2 size={15} />
      <div>
        <span>TRY THIS</span>
        <p>{children}</p>
      </div>
    </div>
  );
}

function FormulaCard({ formula }) {
  return (
    <div className="ip-formula-card">
      <div className="ip-formula-card__label">
        <Calculator size={15} />
        <span>ENERGY ESTIMATE</span>
      </div>
      <div className="ip-formula-line">
        <span>Energy</span>
        <b>=</b>
        <span>Power</span>
        <b>×</b>
        <span>Time</span>
        <b>÷</b>
        <span>1,000</span>
      </div>
      <div className="ip-formula-example">
        <strong>{formula.power} W</strong>
        <span>×</span>
        <strong>{formula.time} h</strong>
        <span>÷</span>
        <span>1,000</span>
        <span>=</span>
        <em>{formula.result} kWh</em>
      </div>
    </div>
  );
}

function TechGrid({ items }) {
  return (
    <div className="ip-tech-grid">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function SlideBody({ slide, direction, onNext }) {
  const slideClass = `ip-slide ip-slide--${slide.kind} ${
    direction > 0 ? "is-next" : "is-prev"
  }`;

  if (slide.kind === "title") {
    return (
      <article className={slideClass}>
        <div className="ip-title-mark">
          <Sparkles size={14} />
          <span>{slide.eyebrow}</span>
        </div>
        <h1 className="ip-title">{slide.title}</h1>
        <p className="ip-subtitle">{slide.subtitle}</p>
        <p className="ip-lead">{slide.lead}</p>
        <div className="ip-title-actions">
          <button type="button" className="ip-start-btn" onClick={onNext}>
            Start walkthrough
            <ArrowRight size={16} />
          </button>
          <span className="ip-title-hint">
            <Keyboard size={14} />
            A / D or arrow keys · swipe on mobile
          </span>
        </div>
      </article>
    );
  }

  if (slide.kind === "closing") {
    return (
      <article className={slideClass}>
        <div className="ip-slide__top">
          <span className="ip-kicker">{slide.kicker}</span>
        </div>
        <h2 className="ip-title ip-title--slide ip-title--statement">
          {slide.title}
        </h2>
        <CueList cues={slide.cues} />
        <div className="ip-closing-actions">
          <Link to="/" className="ds-btn ds-btn--primary">
            Open the live app
            <ArrowRight size={16} />
          </Link>
          <Link to="/mcs/admin" className="ds-btn ds-btn--ghost">
            Admin console
            <ExternalLink size={16} />
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className={slideClass}>
      <div className="ip-slide__top">
        <span className="ip-kicker">{slide.kicker}</span>
      </div>
      <h2 className="ip-title ip-title--slide">{slide.title}</h2>

      {slide.kind === "formula" && <FormulaCard formula={slide.formula} />}

      <CueList cues={slide.cues} />
      {slide.demoHint && <TryThis>{slide.demoHint}</TryThis>}
      {slide.note && <p className="ip-note">{slide.note}</p>}
      {slide.tech && <TechGrid items={slide.tech} />}
    </article>
  );
}

function DemoStage({
  activeDemo,
  mountedDemos,
  demoOpen,
  demoExpanded,
  iframeRefs,
  onFrameLoad,
  onToggleExpand,
  onClose,
  onOpen,
}) {
  if (!activeDemo) return null;

  return (
    <>
      <aside
        className={`ip-demo${demoOpen ? " is-open" : ""}${
          demoExpanded ? " is-expanded" : ""
        }`}
        aria-hidden={!demoOpen}
      >
        <div className="ip-demo__bar">
          <div className="ip-demo__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="ip-demo__title">
            <MonitorSmartphone size={14} />
            <span>{DEMO_LABELS[activeDemo]}</span>
          </div>
          <div className="ip-demo__actions">
            <a
              className="ip-icon-btn"
              href={DEMO_SOURCES[activeDemo]}
              target="_blank"
              rel="noreferrer"
              title="Open demo in a new tab"
              aria-label="Open demo in a new tab"
            >
              <ExternalLink size={15} />
            </a>
            <button
              type="button"
              className="ip-icon-btn"
              onClick={onToggleExpand}
              title={demoExpanded ? "Restore demo" : "Expand demo"}
              aria-label={demoExpanded ? "Restore demo" : "Expand demo"}
            >
              {demoExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              className="ip-icon-btn"
              onClick={onClose}
              title="Hide demo"
              aria-label="Hide demo"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="ip-demo__viewport">
          {Object.entries(DEMO_SOURCES).map(([key, src]) => (
            <div
              className={`ip-demo__frame${
                activeDemo === key ? " is-active" : ""
              }`}
              key={key}
              aria-hidden={activeDemo !== key}
            >
              {mountedDemos.has(key) && (
                <iframe
                  ref={(element) => {
                    iframeRefs.current[key] = element;
                  }}
                  src={src}
                  title={`${DEMO_LABELS[key]} live demo`}
                  onLoad={onFrameLoad}
                />
              )}
            </div>
          ))}
          {!mountedDemos.has(activeDemo) && (
            <div className="ip-demo__loading">
              <span className="ip-spinner" />
              Loading live demo…
            </div>
          )}
        </div>

        <div className="ip-demo__foot">
          <code>{DEMO_SOURCES[activeDemo]}</code>
          <span>Live app · session preserved</span>
        </div>
      </aside>

      {!demoOpen && (
        <button type="button" className="ip-demo-dock" onClick={onOpen}>
          <span className="ip-demo-dock__pulse" aria-hidden="true" />
          <span className="ip-demo-dock__text">
            <strong>Live demo</strong>
            <small>{DEMO_LABELS[activeDemo]}</small>
          </span>
          <Play size={15} />
        </button>
      )}
    </>
  );
}

export function InteractivePresentation() {
  const { darkMode, toggleTheme } = useTheme();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [mountedDemos, setMountedDemos] = useState(() => new Set());
  const [activeDemo, setActiveDemo] = useState(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoExpanded, setDemoExpanded] = useState(false);

  const indexRef = useRef(0);
  const iframeRefs = useRef({});
  const touchStartRef = useRef(null);
  const automationToken = useRef(0);
  const automationDone = useRef(new Set());
  const slide = SLIDES[index];

  const goTo = useCallback((next) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, next));
    setDirection(clamped >= indexRef.current ? 1 : -1);
    indexRef.current = clamped;
    setIndex(clamped);
  }, []);

  const goNext = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const goPrev = useCallback(() => goTo(indexRef.current - 1), [goTo]);

  const openDemo = useCallback(() => {
    const next = activeDemo || "landing";
    setActiveDemo(next);
    setMountedDemos((current) => {
      if (current.has(next)) return current;
      const copy = new Set(current);
      copy.add(next);
      return copy;
    });
    setDemoOpen(true);
  }, [activeDemo]);

  const closeDemo = useCallback(() => {
    setDemoOpen(false);
    setDemoExpanded(false);
  }, []);

  const toggleExpand = useCallback(() => {
    setDemoExpanded((current) => !current);
  }, []);

  useEffect(() => {
    if (!slide.demo) {
      setDemoOpen(false);
      return;
    }
    setActiveDemo(slide.demo);
    setMountedDemos((current) => {
      if (current.has(slide.demo)) return current;
      const copy = new Set(current);
      copy.add(slide.demo);
      return copy;
    });
    setDemoOpen(true);
  }, [index, slide.demo]);

  useEffect(() => {
    const automation = SLIDE_AUTOMATION[slide.id];
    if (!automation || automationDone.current.has(slide.id)) return undefined;

    const token = automationToken.current + 1;
    automationToken.current = token;
    const isCurrent = () => automationToken.current === token;
    const markDone = () => automationDone.current.add(slide.id);

    const timer = window.setTimeout(() => {
      automation({ refs: iframeRefs, isCurrent, markDone }).catch(() => {
        // A demo can be closed or replaced while it is being automated.
      });
    }, 700);

    return () => {
      window.clearTimeout(timer);
      if (automationToken.current === token) automationToken.current = token + 1;
    };
  }, [index, slide.id]);

  useEffect(() => {
    Object.values(iframeRefs.current).forEach((frame) => {
      try {
        const doc = frame?.contentDocument;
        if (doc?.documentElement) {
          doc.documentElement.dataset.theme = darkMode ? "dark" : "light";
        }
      } catch {
        // The demo is same-origin; ignore a frame that is still navigating.
      }
    });
  }, [darkMode, mountedDemos]);

  useEffect(() => {
    document.body.style.overflow = demoExpanded ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [demoExpanded]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (demoExpanded) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDemoExpanded(false);
        }
        return;
      }

      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        goNext();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goPrev();
      } else if (event.code === "Space") {
        if (tag === "BUTTON" || tag === "A") return;
        event.preventDefault();
        goNext();
      } else if (event.key === "Home") {
        event.preventDefault();
        goTo(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goTo(SLIDES.length - 1);
      } else if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        goPrev();
      } else if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        goNext();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (demoOpen) toggleExpand();
        else openDemo();
      } else if (event.key === "Escape" && demoOpen) {
        closeDemo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeDemo,
    demoExpanded,
    demoOpen,
    goNext,
    goPrev,
    goTo,
    openDemo,
    toggleExpand,
  ]);

  const handleFrameLoad = useCallback(
    (event) => {
      try {
        const doc = event.currentTarget.contentDocument;
        if (doc?.documentElement) {
          doc.documentElement.dataset.theme = darkMode ? "dark" : "light";
        }
      } catch {
        // Same-origin frame only.
      }
    },
    [darkMode],
  );

  const handleTouchStart = (event) => {
    if (event.touches.length !== 1) return;
    touchStartRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    };
  };

  const handleTouchEnd = (event) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  return (
    <main className="ip-page">
      <Topbar
        subtitle="LIVE WALKTHROUGH"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <Link to="/" className="ds-btn ds-btn--ghost ds-btn--sm">
              Exit
            </Link>
          </>
        }
      />

      <div className={`ip-shell${demoOpen ? " has-demo" : ""}`}>
        <section
          className="ip-deck"
          aria-label="WattWise presentation"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="ip-progress" aria-label="Presentation progress">
            <div className="ip-progress__steps">
              {SLIDES.map((item, itemIndex) => (
                <button
                  type="button"
                  key={item.id}
                  className={`ip-progress__step${
                    itemIndex === index ? " is-active" : ""
                  }${itemIndex < index ? " is-done" : ""}`}
                  onClick={() => goTo(itemIndex)}
                  aria-label={`Go to slide ${itemIndex + 1}: ${item.title}`}
                  aria-current={itemIndex === index ? "step" : undefined}
                />
              ))}
            </div>
            <span className="ip-progress__counter">
              {String(index + 1).padStart(2, "0")} /{" "}
              {String(SLIDES.length).padStart(2, "0")}
            </span>
          </div>

          <div className="ip-slide-wrap">
            <SlideBody
              key={slide.id}
              slide={slide}
              direction={direction}
              onNext={goNext}
            />
          </div>

          <nav className="ip-controls" aria-label="Slide controls">
            <div className="ip-controls__group">
              <button
                type="button"
                className="ip-nav-btn"
                onClick={goPrev}
                disabled={index === 0}
                aria-label="Previous slide"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="ip-nav-btn"
                onClick={goNext}
                disabled={index === SLIDES.length - 1}
                aria-label="Next slide"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <span className="ip-controls__hint">
              <Keyboard size={14} />
              A / D or arrows · F fullscreen
            </span>
            <button
              type="button"
              className="ip-demo-trigger"
              onClick={demoOpen ? closeDemo : openDemo}
            >
              <Play size={14} />
              {demoOpen ? "Hide demo" : "Live demo"}
            </button>
          </nav>

          <PageFooter
            showPrivacy
            showContact
            contactEmail="cshswattwise@gmail.com"
            onPrivacyClick={() =>
              window.dispatchEvent(new CustomEvent("open-privacy"))
            }
          />
        </section>

        <DemoStage
          activeDemo={activeDemo}
          mountedDemos={mountedDemos}
          demoOpen={demoOpen}
          demoExpanded={demoExpanded}
          iframeRefs={iframeRefs}
          onFrameLoad={handleFrameLoad}
          onToggleExpand={toggleExpand}
          onClose={closeDemo}
          onOpen={openDemo}
        />
      </div>
    </main>
  );
}
