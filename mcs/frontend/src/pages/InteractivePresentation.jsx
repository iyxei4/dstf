import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Zap,
  Building2,
  Users,
  Monitor,
  Calculator,
  ShieldCheck,
  History,
  PlugZap,
  Gauge,
  BarChart3,
  BellRing,
  Sparkles,
  CheckCircle,
  XCircle,
  Clock,
  Layers,
  LayoutDashboard,
  MousePointer,
  Keyboard,
  Play,
  Pause,
  Volume2,
  Fullscreen,
  Minimize,
} from "lucide-react";
import { Topbar } from "../components/ui/Topbar";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { PageFooter } from "../components/ui/PageFooter";
import { useTheme } from "../hooks/useTheme";
import { useScrollAnimation, useStaggeredAnimation } from "../hooks/useScrollAnimation";
import { Card, CardBody } from "../components/design";

const PRESENTERS = {
  Wackeen: { name: "Emilyan Wackeen M. Samedra", color: "#e9bd68", icon: Zap },
  Viencei: { name: "Viencei R. Antonio", color: "#79bd91", icon: Building2 },
  Leo: { name: "Leo Victor R. Santiago", color: "#8bb5c5", icon: Users },
};

const SLIDES = [
  {
    id: "title",
    title: "WATTWISE",
    subtitle: "Smart Web-Based Electricity Consumption Simulator and Management System",
    presenters: ["Wackeen", "Viencei", "Leo"],
    type: "title",
  },
  {
    id: "problem",
    title: "The Problem",
    presenter: "Viencei",
    content: [
      "Panel members, may we invite you to take these phones?",
      "Let's start with a simple question: Do we really know how much electricity our school consumes every day?",
      "Fans, televisions, lights, printers, and computers run for hours, but their energy usage often goes untracked.",
      "Without a simple monitoring system, schools have limited visibility into consumption patterns and fewer opportunities to make smarter energy decisions.",
      "That is the problem we set out to solve.",
    ],
    type: "content",
  },
  {
    id: "intro",
    title: "Introducing WattWise",
    presenter: "Wackeen",
    content: [
      "Today, we won't just tell you what WattWise can do. We're inviting you to experience it.",
      "We want you to experience how our system works from the user's perspective. Feel free to explore the website as we walk you through its key features.",
      "Each facility has a designated Energy Management Coordinator (EMC) responsible for entering the necessary data into the system.",
      "If the coordinator forgets to activate the switch on the website at the appropriate time, the system allows them to manually specify a custom date and time to ensure that the recorded data accurately reflects the facility's electricity usage.",
    ],
    type: "content",
  },
  {
    id: "signup",
    title: "Sign Up & Sign In",
    presenter: "Leo",
    content: [
      "First, users register and access their assigned classroom after administrator approval. Administrators can manage users, facilities, and equipment through a dedicated interface.",
      "Next, users record the equipment in their facility, including each equipment's power rating, operating status, and duration of use.",
    ],
    screenshot: "signup",
    type: "demo",
  },
  {
    id: "formula",
    title: "The Formula",
    presenter: "Leo",
    content: [
      "Let's take a quick example: a 100-watt television operating for four hours.",
      "WattWise applies a simple formula:",
      "Energy Consumption = Power × Time ÷ 1,000",
      "So, 100 watts × 4 hours ÷ 1,000 = 0.4 kilowatt-hours.",
    ],
    formula: { power: 100, time: 4, result: 0.4 },
    type: "formula",
  },
  {
    id: "admin-workspace",
    title: "Admin Workspace",
    presenter: "Wackeen",
    content: [
      "Administrators manage buildings, rooms, appliances, and EMC accounts from a centralized dashboard.",
      "Buildings & Rooms: Create buildings, add floors, and define rooms to match your real campus layout.",
      "Appliances: Give every appliance a name and rated wattage so its load is known and tracked.",
      "EMC Accounts: Invite coordinators, assign them to rooms, and revoke access when terms end.",
      "Reports & Analytics: Filter by month, building, room, coordinator, or appliance for insights.",
    ],
    screenshot: "admin",
    type: "demo",
  },
  {
    id: "monitoring-reports",
    title: "Monitoring Reports",
    presenter: "Viencei",
    content: [
      "The system applies the energy calculation to every recorded equipment and organizes the results into consumption records, summaries, and reports.",
      "Users can view room-level totals, historical usage, trends, and high-use flags that highlight records requiring attention.",
      "In just a few steps, WattWise transforms raw equipment information into clear, actionable energy insights.",
    ],
    screenshot: "reports",
    type: "demo",
  },
  {
    id: "adding-buildings",
    title: "Adding Buildings & Rooms",
    presenter: "Viencei",
    content: [
      "Structure your workspace: Name your workspace, add buildings and floors, then create the rooms inside them.",
      "Each room can be assigned a type (classroom, office, custom) and given a custom name.",
      "The visual campus map lets you see your entire facility hierarchy at a glance.",
    ],
    screenshot: "buildings",
    type: "demo",
  },
  {
    id: "emc-login",
    title: "EMC Login & Workspace",
    presenter: "Leo",
    content: [
      "Each facility has a designated Energy Management Coordinator (EMC) responsible for entering the necessary data into the system.",
      "EMCs sign in with their assigned credentials and only see the room they are assigned to — room-scoped access ensures focus and accountability.",
      "The EMC workspace shows their assigned room, available appliances, and their report history.",
    ],
    screenshot: "emc-login",
    type: "demo",
  },
  {
    id: "emc-on-off",
    title: "EMC ON/OFF Reporting",
    presenter: "Leo",
    content: [
      "Coordinators submit ON/OFF reports by selecting an appliance, entering hours of use, and submitting.",
      "If the coordinator forgets to activate the switch at the appropriate time, they can manually specify a custom date and time.",
      "Reports are observations, not live sensor readings. No report means the status is unknown, not OFF.",
      "Each submission calculates energy: Power (watts) × Hours ÷ 1,000 = kWh",
    ],
    screenshot: "emc-reporting",
    type: "demo",
  },
  {
    id: "tech-stack",
    title: "Technical Stack",
    presenter: "Wackeen",
    content: [
      "Behind the interface is a practical stack designed for reliability and stability:",
      "React for the user interface",
      "Python (FastAPI) for the backend",
      "Supabase (PostgreSQL) for the database",
      "Vercel for web hosting",
      "It organizes data about classrooms, facilities, users, equipment, and energy usage.",
      "Most importantly, WattWise helps schools monitor energy consumption, identify usage patterns, and encourage responsible use of appliances.",
    ],
    type: "content",
  },
  {
    id: "future",
    title: "Future Vision",
    presenter: "Leo",
    content: [
      "This is only the beginning.",
      "WattWise can scale by expanding to more classrooms, collecting data over longer periods, and incorporating factors such as occupancy, schedules, and real-time measurements.",
      "Future validation using independently measured electricity consumption can further strengthen the system's prediction capabilities.",
      "Our vision is to help schools move from simply consuming electricity to actively understanding and managing it.",
    ],
    type: "content",
  },
  {
    id: "closing",
    title: "Closing",
    presenters: ["Viencei", "Wackeen", "Leo"],
    content: [
      { presenter: "Viencei", text: "WattWise makes classroom electricity consumption visible." },
      { presenter: "Wackeen", text: "It turns appliance records into clear, useful insights." },
      { presenter: "Leo", text: "And it empowers smarter decisions through mathematics, technology, and data." },
      { presenter: "ALL", text: "We are the developers of WattWise: Measure smarter. Predict better. Power a more sustainable future." },
    ],
    type: "closing",
  },
  {
    id: "cta",
    title: "Ready to Experience It?",
    presenter: "Leo",
    content: [
      "Thank you. We are ready for your questions!",
      "Click below to explore the live system.",
    ],
    type: "cta",
  },
];

function SlideContent({ slide, index, isVisible, ref }) {
  const presenter = slide.presenter ? PRESENTERS[slide.presenter] : null;
  const presenters = slide.presenters ? slide.presenters.map(p => PRESENTERS[p]).filter(Boolean) : [];

  const baseClass = `ip-slide ip-slide--${slide.type} lp-animate lp-animate--fade-up ${isVisible ? "is-visible" : ""} lp-stagger-${(index % 6) + 1}`;

  return (
    <section ref={ref} className={baseClass} id={slide.id} aria-labelledby={`${slide.id}-title`}>
      <div className="ip-slide-inner">
        {slide.type === "title" && (
          <>
            <div className="ip-title-badge">
              <span className="ip-badge-icon">
                <Zap size={28} />
              </span>
              <span className="ip-badge-text">INTERACTIVE PRESENTATION</span>
            </div>
            <h1 id={`${slide.id}-title`} className="ip-main-title">WATTWISE</h1>
            <p className="ip-subtitle">{slide.subtitle}</p>
            <div className="ip-presenters-title">
              {presenters.map((p, i) => (
                <span key={p.name} className="ip-presenter-chip" style={{ borderColor: p.color }}>
                  <p.icon size={14} />
                  {p.name}
                </span>
              ))}
            </div>
            <div className="ip-scroll-hint">
              <span>Scroll to begin</span>
              <ChevronRight size={20} className="ip-scroll-chevron" />
            </div>
          </>
        )}

        {slide.type === "content" && (
          <>
            {presenter && (
              <div className="ip-presenter-badge" style={{ borderColor: presenter.color }}>
                <presenter.icon size={16} />
                <span>{presenter.name}</span>
              </div>
            )}
            <h2 id={`${slide.id}-title`} className="ip-slide-title">{slide.title}</h2>
            <div className="ip-slide-content">
              {slide.content.map((line, i) => (
                <p key={i} className="ip-slide-paragraph">{line}</p>
              ))}
            </div>
          </>
        )}

        {slide.type === "formula" && (
          <>
            {presenter && (
              <div className="ip-presenter-badge" style={{ borderColor: presenter.color }}>
                <presenter.icon size={16} />
                <span>{presenter.name}</span>
              </div>
            )}
            <h2 id={`${slide.id}-title`} className="ip-slide-title">{slide.title}</h2>
            <div className="ip-slide-content">
              {slide.content.slice(0, -1).map((line, i) => (
                <p key={i} className="ip-slide-paragraph">{line}</p>
              ))}
              <div className="ip-formula-display">
                <div className="ip-formula-equation">
                  <span className="ip-formula-part">Energy Consumption</span>
                  <span className="ip-formula-equals">=</span>
                  <span className="ip-formula-part">Power</span>
                  <span className="ip-formula-times">×</span>
                  <span className="ip-formula-part">Time</span>
                  <span className="ip-formula-divide">÷</span>
                  <span className="ip-formula-part">1,000</span>
                </div>
                <div className="ip-formula-example">
                  <span className="ip-formula-part ip-highlight">{slide.formula.power} W</span>
                  <span className="ip-formula-times">×</span>
                  <span className="ip-formula-part ip-highlight">{slide.formula.time} hrs</span>
                  <span className="ip-formula-divide">÷</span>
                  <span className="ip-formula-part">1,000</span>
                  <span className="ip-formula-equals">=</span>
                  <span className="ip-formula-result ip-highlight">{slide.formula.result} kWh</span>
                </div>
              </div>
              <p className="ip-slide-paragraph">{slide.content[slide.content.length - 1]}</p>
            </div>
          </>
        )}

        {slide.type === "demo" && (
          <>
            {presenter && (
              <div className="ip-presenter-badge" style={{ borderColor: presenter.color }}>
                <presenter.icon size={16} />
                <span>{presenter.name}</span>
              </div>
            )}
            <h2 id={`${slide.id}-title`} className="ip-slide-title">{slide.title}</h2>
            <div className="ip-slide-content">
              {slide.content.map((line, i) => (
                <p key={i} className="ip-slide-paragraph">{line}</p>
              ))}
            </div>
            <div className="ip-screenshot-container">
              <ScreenshotMockup feature={slide.screenshot} />
            </div>
          </>
        )}

        {slide.type === "closing" && (
          <>
            <div className="ip-presenters-title">
              {presenters.map((p, i) => (
                <span key={p.name} className="ip-presenter-chip" style={{ borderColor: p.color }}>
                  <p.icon size={14} />
                  {p.name}
                </span>
              ))}
            </div>
            <h2 id={`${slide.id}-title`} className="ip-slide-title">{slide.title}</h2>
            <div className="ip-slide-content ip-closing-content">
              {slide.content.map((item, i) => (
                <div key={i} className="ip-closing-line">
                  <span className="ip-closing-presenter" style={{ color: item.presenter !== "ALL" ? PRESENTERS[item.presenter]?.color : "var(--accent)" }}>
                    {item.presenter === "ALL" ? "ALL PRESENTERS" : `PRESENTER ${["1", "2", "3"][["Viencei", "Wackeen", "Leo"].indexOf(item.presenter)]}: ${item.presenter.toUpperCase()}`}
                  </span>
                  <span className="ip-closing-text" style={{ borderLeftColor: item.presenter !== "ALL" ? PRESENTERS[item.presenter]?.color : "var(--accent)" }}>
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {slide.type === "cta" && (
          <>
            {presenter && (
              <div className="ip-presenter-badge" style={{ borderColor: presenter.color }}>
                <presenter.icon size={16} />
                <span>{presenter.name}</span>
              </div>
            )}
            <h2 id={`${slide.id}-title`} className="ip-slide-title">{slide.title}</h2>
            <div className="ip-slide-content">
              {slide.content.map((line, i) => (
                <p key={i} className="ip-slide-paragraph">{line}</p>
              ))}
            </div>
            <div className="ip-cta-buttons">
              <Link to="/auth/signup" className="ds-btn ds-btn--primary ds-btn--lg">
                Get Started
                <ArrowRight size={16} />
              </Link>
              <Link to="/mcs/admin" className="ds-btn ds-btn--ghost ds-btn--lg">
                Admin Demo
                <ArrowRight size={16} />
              </Link>
              <Link to="/mcs/user" className="ds-btn ds-btn--ghost ds-btn--lg">
                User Demo
                <ArrowRight size={16} />
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function ScreenshotMockup({ feature }) {
  const mockups = {
    signup: (
      <div className="ip-mockup ip-mockup--signup">
        <div className="ip-mockup-header">
          <div className="ip-mockup-dots"><span /><span /><span /></div>
          <div className="ip-mockup-url">wattwise-classrooms.vercel.app/auth/signup</div>
        </div>
        <div className="ip-mockup-content">
          <div className="ip-mockup-panel ip-mockup-panel--aside">
            <div className="ip-mockup-number">02 / WATTWISE</div>
            <div className="ip-mockup-mark"><Zap size={24} /></div>
            <h3>Create your<br />account.</h3>
            <p>Pick a username and campus name. An admin will approve your access.</p>
          </div>
          <div className="ip-mockup-panel ip-mockup-panel--form">
            <h4>Create your workspace</h4>
            <div className="ip-mockup-field"><label>Username</label><input placeholder="juan" /></div>
            <div className="ip-mockup-field"><label>Campus name</label><input placeholder="CSHS" /></div>
            <div className="ip-mockup-field"><label>Email</label><input placeholder="you@example.com" type="email" /></div>
            <div className="ip-mockup-field"><label>Password</label><input placeholder="••••••••" type="password" /></div>
            <div className="ip-mockup-field"><label>Confirm password</label><input placeholder="••••••••" type="password" /></div>
            <button className="ip-mockup-btn">Create account</button>
          </div>
        </div>
      </div>
    ),
    admin: (
      <div className="ip-mockup ip-mockup--admin">
        <div className="ip-mockup-header">
          <div className="ip-mockup-dots"><span /><span /><span /></div>
          <div className="ip-mockup-url">wattwise-classrooms.vercel.app/mcs/admin</div>
        </div>
        <div className="ip-mockup-content">
          <div className="ip-mockup-sidebar">
            <div className="ip-mockup-nav-item active"><Building2 size={16} /><span>Buildings & Rooms</span></div>
            <div className="ip-mockup-nav-item"><PlugZap size={16} /><span>Appliances</span></div>
            <div className="ip-mockup-nav-item"><Users size={16} /><span>EMC Accounts</span></div>
            <div className="ip-mockup-nav-item"><BarChart3 size={16} /><span>Reports</span></div>
            <div className="ip-mockup-nav-item"><BellRing size={16} /><span>Notifications</span></div>
          </div>
          <div className="ip-mockup-main">
            <div className="ip-mockup-metric"><span className="ip-metric-icon green"><Building2 size={14} /></span><strong>3</strong><small>Buildings</small></div>
            <div className="ip-mockup-metric"><span className="ip-metric-icon amber"><Layers size={14} /></span><strong>12</strong><small>Floors</small></div>
            <div className="ip-mockup-metric"><span className="ip-metric-icon blue"><Zap size={14} /></span><strong>48</strong><small>Rooms</small></div>
            <div className="ip-mockup-metric"><span className="ip-metric-icon green"><Users size={14} /></span><strong>8</strong><small>Active EMCs</small></div>
            <div className="ip-mockup-table">
              <div className="ip-mockup-table-header"><span>Building</span><span>Floors</span><span>Rooms</span><span>EMCs</span></div>
              <div className="ip-mockup-table-row"><span>G11</span><span>4</span><span>16</span><span>3</span></div>
              <div className="ip-mockup-table-row"><span>ADMIN</span><span>2</span><span>8</span><span>2</span></div>
              <div className="ip-mockup-table-row"><span>G12</span><span>6</span><span>24</span><span>3</span></div>
            </div>
          </div>
        </div>
      </div>
    ),
    reports: (
      <div className="ip-mockup ip-mockup--reports">
        <div className="ip-mockup-header">
          <div className="ip-mockup-dots"><span /><span /><span /></div>
          <div className="ip-mockup-url">wattwise-classrooms.vercel.app/mcs/admin#reports</div>
        </div>
        <div className="ip-mockup-content">
          <div className="ip-mockup-filters">
            <select className="ip-mockup-select"><option>Month: 2026-10</option></select>
            <select className="ip-mockup-select"><option>Group by: Day</option></select>
            <select className="ip-mockup-select"><option>Building: All</option></select>
            <select className="ip-mockup-select"><option>Room: All</option></select>
          </div>
          <div className="ip-mockup-charts">
            <div className="ip-mockup-chart">
              <div className="ip-chart-title">Energy by Day (kWh)</div>
              <div className="ip-chart-bars">
                {[12, 19, 8, 24, 15, 22, 10].map((h, i) => (
                  <div key={i} className="ip-chart-bar" style={{ height: `${h * 3}px` }} title={`${h} kWh`} />
                ))}
              </div>
            </div>
            <div className="ip-mockup-chart">
              <div className="ip-chart-title">By Appliance</div>
              <div className="ip-chart-pie">
                <div className="ip-pie-slice green" style={{ '--p': '35%' }} /><div className="ip-pie-slice amber" style={{ '--p': '25%' }} /><div className="ip-pie-slice blue" style={{ '--p': '20%' }} /><div className="ip-pie-slice muted" style={{ '--p': '20%' }} />
              </div>
              <div className="ip-chart-legend">
                <span className="ip-legend-item"><span className="ip-legend-color green" />Fan</span>
                <span className="ip-legend-item"><span className="ip-legend-color amber" />Light</span>
                <span className="ip-legend-item"><span className="ip-legend-color blue" />PC</span>
                <span className="ip-legend-item"><span className="ip-legend-color muted" />Other</span>
              </div>
            </div>
          </div>
          <div className="ip-mockup-table">
            <div className="ip-mockup-table-header"><span>Date</span><span>Room</span><span>Appliance</span><span>Hours</span><span>Energy</span></div>
            <div className="ip-mockup-table-row"><span>Oct 23</span><span>G11-301</span><span>Fan</span><span>4.0</span><span>0.4 kWh</span></div>
            <div className="ip-mockup-table-row"><span>Oct 23</span><span>G11-301</span><span>LED Light</span><span>8.0</span><span>0.48 kWh</span></div>
            <div className="ip-mockup-table-row"><span>Oct 22</span><span>G12-205</span><span>PC</span><span>6.0</span><span>1.2 kWh</span></div>
          </div>
        </div>
      </div>
    ),
    buildings: (
      <div className="ip-mockup ip-mockup--buildings">
        <div className="ip-mockup-header">
          <div className="ip-mockup-dots"><span /><span /><span /></div>
          <div className="ip-mockup-url">wattwise-classrooms.vercel.app/mcs/admin#buildings</div>
        </div>
        <div className="ip-mockup-content">
          <div className="ip-mockup-building-tree">
            <div className="ip-tree-building">
              <div className="ip-tree-node ip-tree-building-node"><Building2 size={16} /><strong>G11 Building</strong><span>4 Floors · 16 Rooms</span></div>
              <div className="ip-tree-floors">
                <div className="ip-tree-floor">
                  <div className="ip-tree-node"><Layers size={14} /><span>Floor 1</span><span>4 Rooms</span></div>
                  <div className="ip-tree-rooms">
                    <div className="ip-tree-room">🏫 Room 101</div>
                    <div className="ip-tree-room">🏫 Room 102</div>
                    <div className="ip-tree-room">🏫 Room 103</div>
                    <div className="ip-tree-room">🏫 Room 104</div>
                  </div>
                </div>
                <div className="ip-tree-floor">
                  <div className="ip-tree-node"><Layers size={14} /><span>Floor 2</span><span>4 Rooms</span></div>
                  <div className="ip-tree-rooms">
                    <div className="ip-tree-room">🏫 Room 201</div>
                    <div className="ip-tree-room">🏫 Room 202</div>
                    <div className="ip-tree-room">🏫 Room 203</div>
                    <div className="ip-tree-room">🏫 Room 204</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="ip-tree-building">
              <div className="ip-tree-node ip-tree-building-node"><Building2 size={16} /><strong>ADMIN Building</strong><span>2 Floors · 8 Rooms</span></div>
              <div className="ip-tree-floors">
                <div className="ip-tree-floor">
                  <div className="ip-tree-node"><Layers size={14} /><span>Floor 1</span><span>4 Rooms</span></div>
                  <div className="ip-tree-rooms">
                    <div className="ip-tree-room">🏢 Office 101</div>
                    <div className="ip-tree-room">🏢 Office 102</div>
                    <div className="ip-tree-room">🏢 Office 103</div>
                    <div className="ip-tree-room">🏢 Office 104</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button className="ip-mockup-btn ip-mockup-btn--secondary">+ Add Building</button>
        </div>
      </div>
    ),
    "emc-login": (
      <div className="ip-mockup ip-mockup--emc-login">
        <div className="ip-mockup-header">
          <div className="ip-mockup-dots"><span /><span /><span /></div>
          <div className="ip-mockup-url">wattwise-classrooms.vercel.app/mcs/user</div>
        </div>
        <div className="ip-mockup-content">
          <div className="ip-mockup-panel ip-mockup-panel--aside">
            <div className="ip-mockup-number">01 / @MCS</div>
            <div className="ip-mockup-mark"><Zap size={24} /></div>
            <h3>Make your<br />room count.</h3>
            <p>Record what your classroom uses. Make every energy count.</p>
          </div>
          <div className="ip-mockup-panel ip-mockup-panel--form">
            <h4>Welcome!</h4>
            <p className="ip-mockup-form-intro">Use the username and password provided by your administrator.</p>
            <div className="ip-mockup-field"><label>Account name</label><input placeholder="e.g. maria.santos" /></div>
            <div className="ip-mockup-field"><label>Password</label><input placeholder="••••••••" type="password" /></div>
            <button className="ip-mockup-btn">Continue to workspace</button>
            <p className="ip-mockup-footnote">Ask your administrator to create or reset your credentials.</p>
          </div>
        </div>
      </div>
    ),
    "emc-reporting": (
      <div className="ip-mockup ip-mockup--emc-reporting">
        <div className="ip-mockup-header">
          <div className="ip-mockup-dots"><span /><span /><span /></div>
          <div className="ip-mockup-url">wattwise-classrooms.vercel.app/mcs/user</div>
        </div>
        <div className="ip-mockup-content">
          <div className="ip-mockup-emc-header">
            <div className="ip-mockup-room-info">
              <div className="ip-mockup-room-badge">ASSIGNED ROOM</div>
              <h3>G11 Building · Floor 3 · Room 301</h3>
              <p>Classroom · 40 occupants max</p>
            </div>
            <div className="ip-mockup-metrics">
              <div className="ip-metric"><span className="ip-metric-icon green"><Zap size={14} /></span><strong>6</strong><small>Appliances</small></div>
              <div className="ip-metric"><span className="ip-metric-icon blue"><Monitor size={14} /></span><strong>12</strong><small>Reports</small></div>
            </div>
          </div>
          <div className="ip-mockup-report-form">
            <h4>Submit a Report</h4>
            <div className="ip-mockup-field"><label>Appliance</label>
              <select className="ip-mockup-select">
                <option>Electric Fan (100W)</option>
                <option>LED Light (60W)</option>
                <option>Desktop PC (300W)</option>
                <option>Projector (250W)</option>
                <option>Air Conditioner (1200W)</option>
              </select>
            </div>
            <div className="ip-mockup-field-row">
              <div className="ip-mockup-field"><label>Hours Used</label><input placeholder="4.0" type="number" step="0.5" /></div>
              <div className="ip-mockup-field"><label>Custom Date/Time</label><input placeholder="Optional" type="datetime-local" /></div>
            </div>
            <div className="ip-mockup-energy-preview">
              <Calculator size={16} />
              <span>Preview: 300W × 4.0 hrs ÷ 1000 = <strong>1.2 kWh</strong></span>
            </div>
            <button className="ip-mockup-btn">Submit Report</button>
          </div>
          <div className="ip-mockup-recent-reports">
            <h4>Recent Reports</h4>
            <div className="ip-mockup-table">
              <div className="ip-mockup-table-header"><span>Appliance</span><span>Hours</span><span>Energy</span><span>Submitted</span></div>
              <div className="ip-mockup-table-row"><span>Electric Fan</span><span>4.0</span><span>0.4 kWh</span><span>Oct 23, 10:30 AM</span></div>
              <div className="ip-mockup-table-row"><span>LED Light</span><span>8.0</span><span>0.48 kWh</span><span>Oct 23, 8:00 AM</span></div>
              <div className="ip-mockup-table-row"><span>Desktop PC</span><span>6.0</span><span>1.8 kWh</span><span>Oct 22, 2:15 PM</span></div>
            </div>
          </div>
        </div>
      </div>
    ),
  };

  return mockups[feature] || (
    <div className="ip-mockup ip-mockup--placeholder">
      <div className="ip-mockup-header">
        <div className="ip-mockup-dots"><span /><span /><span /></div>
        <div className="ip-mockup-url">Screenshot placeholder</div>
      </div>
      <div className="ip-mockup-content">
        <p>Screenshot for "{feature}" coming soon</p>
      </div>
    </div>
  );
}

function ProgressIndicator({ currentSlide, totalSlides }) {
  return (
    <div className="ip-progress-indicator" aria-label="Presentation progress">
      <div className="ip-progress-bar">
        <div className="ip-progress-fill" style={{ width: `${((currentSlide + 1) / totalSlides) * 100}%` }} />
      </div>
      <span className="ip-progress-text">{currentSlide + 1} / {totalSlides}</span>
    </div>
  );
}

function NavigationControls({ currentSlide, totalSlides, onNext, onPrev, canGoNext, canGoPrev }) {
  return (
    <div className="ip-nav-controls">
      <button
        className="ip-nav-btn ip-nav-btn--prev"
        onClick={onPrev}
        disabled={!canGoPrev}
        aria-label="Previous slide"
      >
        <ChevronLeft size={20} />
      </button>
      <div className="ip-nav-dots">
        {Array.from({ length: totalSlides }, (_, i) => (
          <button
            key={i}
            className={`ip-nav-dot ${i === currentSlide ? "active" : ""}`}
            onClick={() => {
              // Scroll to slide
              const slide = document.getElementById(SLIDES[i].id);
              if (slide) slide.scrollIntoView({ behavior: "smooth" });
            }}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
      <button
        className="ip-nav-btn ip-nav-btn--next"
        onClick={onNext}
        disabled={!canGoNext}
        aria-label="Next slide"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

export function InteractivePresentation() {
  const { darkMode, toggleTheme } = useTheme();
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const slideRefs = useRef([]);

  // Scroll animations for each slide
  const slideAnimations = SLIDES.map((_, i) => useScrollAnimation({ threshold: 0.3, triggerOnce: true }));

  // Update current slide based on scroll position
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY + window.innerHeight / 2;
      let newIndex = 0;
      
      slideRefs.current.forEach((ref, i) => {
        if (ref && ref.offsetTop <= scrollY) {
          newIndex = i;
        }
      });
      
      setCurrentSlideIndex(newIndex);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const goToSlide = (index) => {
    const ref = slideRefs.current[index];
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth" });
    }
  };

  const goNext = () => goToSlide(Math.min(currentSlideIndex + 1, SLIDES.length - 1));
  const goPrev = () => goToSlide(Math.max(currentSlideIndex - 1, 0));

  return (
    <main className="ip-page">
      <Topbar
        subtitle="INTERACTIVE PRESENTATION"
        right={
          <>
            <ThemeToggle darkMode={darkMode} onToggle={toggleTheme} />
            <Link to="/auth/signup" className="ds-btn ds-btn--primary ds-btn--sm">
              Get Started
              <ArrowRight size={14} />
            </Link>
          </>
        }
      />

      <ProgressIndicator currentSlide={currentSlideIndex} totalSlides={SLIDES.length} />
      
      <NavigationControls
        currentSlide={currentSlideIndex}
        totalSlides={SLIDES.length}
        onNext={goNext}
        onPrev={goPrev}
        canGoNext={currentSlideIndex < SLIDES.length - 1}
        canGoPrev={currentSlideIndex > 0}
      />

      <div className="ip-slides-container">
        {SLIDES.map((slide, index) => {
          const [ref, isVisible] = slideAnimations[index];
          return (
            <SlideContent
              key={slide.id}
              slide={slide}
              index={index}
              isVisible={isVisible}
              ref={(el) => { slideRefs.current[index] = el; ref(el); }}
            />
          );
        })}
      </div>

      <PageFooter
        showPrivacy
        showContact
        contactEmail="cshswattwise@gmail.com"
        onPrivacyClick={() => window.dispatchEvent(new CustomEvent("open-privacy"))}
      />
    </main>
  );
}