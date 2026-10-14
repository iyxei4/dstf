import { Zap, Building2, Users, ClipboardList, ArrowDownRight } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { kwhText, money } from "../../utils/formatters";

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
        <article>
          <span>
            <span className="metric-icon amber">
              <Building2 size={15} />
            </span>
            EST. MONTHLY BILL
          </span>
          <strong>{money(dashboard?.estimated_bill_php)}</strong>
          <small className="metric-foot">
            At {money(dashboard?.rate_php_per_kwh)} / kWh
          </small>
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
          <div className="consolidated-item is-total">
            <span>TOTAL ACCOUNTS</span>
            <strong>{dashboard?.users?.length || 0}</strong>
          </div>
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
              <h2>Energy & estimated bill</h2>
            </div>
            <span className="trend-unit">kWh / PHP</span>
          </div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
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
                  yAxisId="energy"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#879087", fontSize: 11 }}
                />
                <YAxis
                  yAxisId="cost"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#a58b60", fontSize: 10 }}
                />
                <Tooltip
                  formatter={(value, name) => [
                    name === "Energy"
                      ? `${kwhText(value)} kWh`
                      : money(value),
                    name,
                  ]}
                  contentStyle={{
                    borderRadius: 8,
                    borderColor: "#e3e8df",
                    fontSize: 12,
                  }}
                />
                <Area
                  yAxisId="energy"
                  type="monotone"
                  dataKey="kwh"
                  name="Energy"
                  stroke="#278253"
                  strokeWidth={2.5}
                  fill="url(#usageFill)"
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="cost"
                  type="monotone"
                  dataKey="bill"
                  name="Est. bill"
                  stroke="#e2a23b"
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#e2a23b" }}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-dot green-legend" /> ENERGY USE{" "}
              <strong>kWh</strong>
            </span>
            <span>
              <i className="legend-dot amber-legend" /> EST. BILL{" "}
              <strong>PHP</strong>
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