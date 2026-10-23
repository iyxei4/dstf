import { Zap, Activity, Users, ClipboardList, ArrowDownRight } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { kwhText } from "../../utils/formatters";

export function AdminOverview({ dashboard, month, activeAccounts, inactiveAccounts, pendingCount }) {
  const monthlyData = dashboard?.monthly || [];

  return (
    <>
      <section className="admin-metrics">
        <article className="metric-primary">
          <span>
            <Zap size={15} /> TOTAL CONSUMPTION
          </span>
          <strong key={dashboard?.total_kwh}>
            {kwhText(dashboard?.total_kwh)} <small>kWh</small>
          </strong>
          <small className="metric-foot">
            For{" "}
            {new Date(`${month}-01T00:00:00`).toLocaleDateString("en-PH", {
              month: "long",
              year: "numeric",
            })}
          </small>
        </article>
        <article className="metric-chart">
          <span>
            <span className="metric-icon green">
              <Activity size={15} />
            </span>
            MONTHLY TREND
          </span>
          <div style={{ width: "100%", height: 64, marginTop: 6 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={monthlyData}
                margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="metricUsageFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#278253" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#278253" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  formatter={(value) => [`${kwhText(value)} kWh`, "Energy"]}
                  contentStyle={{
                    borderRadius: 8,
                    borderColor: "#e3e8df",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="kwh"
                  stroke="#278253"
                  strokeWidth={2}
                  fill="url(#metricUsageFill)"
                  activeDot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <small className="metric-foot">Last {monthlyData.length || 0} months</small>
        </article>
        <article>
          <span>
            <span className="metric-icon green">
              <Users size={15} />
            </span>
            ACTIVE ACCOUNTS
          </span>
          <strong key={activeAccounts}>
            {activeAccounts.toString().padStart(2, "0")}
          </strong>
          <small className="metric-foot">
            Approved and able to sign in
          </small>
        </article>
        <article className={inactiveAccounts ? "metric-alert" : ""}>
          <span>
            <span className="metric-icon blue">
              <ClipboardList size={15} />
            </span>
            INACTIVE ACCOUNTS
          </span>
          <strong key={inactiveAccounts}>
            {inactiveAccounts.toString().padStart(2, "0")}
          </strong>
          <small className="metric-foot">
            {pendingCount
              ? `${pendingCount} awaiting approval`
              : "Nothing awaiting approval"}
          </small>
        </article>
      </section>
      <section className="panel consolidated-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CONSOLIDATED</span>
            <h2>Campus summary</h2>
          </div>
        </div>
        <div className="consolidated-grid">
          <div className="consolidated-item">
            <span>Classrooms</span>
            <strong>{dashboard?.rooms_count || 0}</strong>
          </div>
          <div className="consolidated-item">
            <span>Sections</span>
            <strong>{dashboard?.section_count || 0}</strong>
          </div>
          <div className="consolidated-item">
            <span>Appliances</span>
            <strong>{dashboard?.appliances?.length || 0}</strong>
          </div>
          <div className="consolidated-item">
            <span>Usage entries</span>
            <strong>{dashboard?.record_count || 0}</strong>
          </div>
        </div>
      </section>
      <section className="admin-analysis-grid">
        <article className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SIX-MONTH VIEW</span>
              <h2>Energy consumption</h2>
            </div>
            <span className="trend-unit">kWh</span>
          </div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={monthlyData}
                margin={{ top: 8, right: 4, left: -16, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="usageFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#278253"
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="100%"
                      stopColor="#278253"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e9ece4" vertical={false} />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#879087", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#879087", fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `${kwhText(value)} kWh`,
                    name,
                  ]}
                  contentStyle={{
                    borderRadius: 8,
                    borderColor: "#e3e8df",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="kwh"
                  name="Energy"
                  stroke="#278253"
                  strokeWidth={2.5}
                  fill="url(#usageFill)"
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-dot green-legend" /> ENERGY USE{" "}
              <strong>kWh</strong>
            </span>
          </div>
        </article>
        <article className="panel section-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SECTION RANKING</span>
              <h2>Highest usage</h2>
            </div>
            <ArrowDownRight className="ranking-icon" size={18} />
          </div>
          {dashboard?.sections?.length ? (
            <div className="section-rank-list">
              {dashboard.sections
                .slice(0, 5)
                .map((section, index) => (
                  <div className="section-rank" key={section.name}>
                    <span className="rank-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="rank-name">
                      <strong>{section.name}</strong>
                      <i>
                        <b
                          style={{
                            width: `${Math.max(5, (section.kwh / Math.max(dashboard.sections[0].kwh, 1)) * 100)}%`,
                          }}
                        />
                      </i>
                    </span>
                    <span className="rank-value">
                      <strong>{kwhText(section.kwh)}</strong>
                      <small>kWh</small>
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="empty-state compact-empty">
              No usage recorded for this month.
            </div>
          )}
        </article>
      </section>
    </>
  );
}