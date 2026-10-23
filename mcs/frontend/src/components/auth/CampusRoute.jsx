import { useEffect, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { request } from "../../utils/api";

/**
 * Keep /mcs/{username}/{campus}/... aligned with the signed-in account.
 * The server still authorizes every request; this only prevents a stale or
 * hand-edited URL from showing a confusing workspace.
 */
export function CampusRoute({ role, children }) {
  const { username, campus } = useParams();
  const location = useLocation();
  const [target, setTarget] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    request("/users/session")
      .then((session) => {
        if (cancelled) return;
        const slug = session.campus_slug;
        if (!slug) {
          setTarget(session.role === "emc" ? "/mcs/user" : "/onboarding");
          return;
        }

        // The seeded demo campus uses fixed routes instead of a personal
        // campus URL. This also redirects the old /mcs/demo/cshs/... links.
        if (slug === "cshs" && session.role === "owner" && session.username === "admin") {
          setTarget("/mcs/admin");
          return;
        }
        if (slug === "cshs" && session.role === "emc" && session.username === "bernoulli") {
          setTarget("/mcs/user");
          return;
        }

        if (role === "owner" && session.role !== "owner") {
          setTarget(
            session.role === "emc" && session.owner_username
              ? `/mcs/${session.owner_username}/${slug}/emc`
              : "/mcs/user",
          );
          return;
        }
        if (role === "emc" && session.role !== "emc") {
          setTarget(`/mcs/${session.username}/${slug}/dashboard`);
          return;
        }

        const ownerName =
          role === "emc" ? session.owner_username : session.username;
        if (!ownerName) {
          setTarget(role === "emc" ? "/mcs/user" : "/onboarding");
          return;
        }
        const expected =
          role === "emc"
            ? `/mcs/${ownerName}/${slug}/emc`
            : `/mcs/${ownerName}/${slug}/dashboard`;

        if (location.pathname !== expected) {
          setTarget(expected);
        } else {
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setTarget("/auth");
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname, role, username, campus]);

  if (target) return <Navigate to={target} replace />;
  if (!ready) {
    return (
      <div className="route-fallback" role="status" aria-live="polite">
        Loading…
      </div>
    );
  }
  return children;
}

/** Gate the fixed demo admin route at /mcs/admin. */
export function DemoAdminRoute({ children }) {
  const [target, setTarget] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request("/users/session")
      .then((session) => {
        if (cancelled) return;
        if (session.role !== "owner") {
          setTarget(
            session.role === "emc" && session.owner_username && session.campus_slug
              ? `/mcs/${session.owner_username}/${session.campus_slug}/emc`
              : "/mcs/user",
          );
          return;
        }
        if (session.campus_slug !== "cshs" || session.username !== "admin") {
          setTarget(
            session.campus_slug
              ? `/mcs/${session.username}/${session.campus_slug}/dashboard`
              : "/onboarding",
          );
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setTarget("/auth");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (target) return <Navigate to={target} replace />;
  if (!ready) {
    return (
      <div className="route-fallback" role="status" aria-live="polite">
        Loading…
      </div>
    );
  }
  return children;
}

/** Send a signed-in owner away from the demo reporting route. */
export function DemoUserRoute({ children }) {
  const [target, setTarget] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request("/users/session")
      .then((session) => {
        if (cancelled) return;
        if (session.role === "owner") {
          if (session.campus_slug === "cshs" && session.username === "admin") {
            setTarget("/mcs/admin");
          } else if (session.campus_slug) {
            setTarget(`/mcs/${session.username}/${session.campus_slug}/dashboard`);
          } else {
            setTarget("/onboarding");
          }
          return;
        }
        setReady(true);
      })
      // No session is expected at /mcs/user: UserPage shows its login form.
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (target) return <Navigate to={target} replace />;
  if (!ready) {
    return (
      <div className="route-fallback" role="status" aria-live="polite">
        Loading…
      </div>
    );
  }
  return children;
}
