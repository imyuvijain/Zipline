// Top-right profile: avatar + name + role. Dropdown holds the demo user switcher and the call actions.
import { useEffect, useRef, useState } from "react";
import { IS_MANAGER, ME, TEAM_MEMBERS, nameOfUser, roleOf, switchUser } from "./api.ts";
import { CatchMeUp, TeamReview } from "./call/IncomingCall.tsx";

export function Profile() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const name = nameOfUser(ME);
  return (
    <div className="profile" ref={ref}>
      <button className="profile-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="profile-avatar">{name.charAt(0)}</span>
        <span className="profile-text"><span className="profile-name">{name}</span><span className="profile-role">{roleOf(ME)}</span></span>
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-card">
            <span className="profile-avatar lg">{name.charAt(0)}</span>
            <div><div className="profile-name">{name}</div><div className="profile-role">{roleOf(ME)} · @{ME}</div></div>
          </div>
          <div className="profile-actions">{IS_MANAGER ? <TeamReview /> : <CatchMeUp />}</div>
          <div className="profile-section">Switch user (demo)</div>
          {TEAM_MEMBERS.map((m) => (
            <button key={m.user} role="menuitem" className={`profile-user ${m.user === ME ? "current" : ""}`} disabled={m.user === ME} onClick={() => switchUser(m.user)}>
              <span className="profile-avatar sm">{m.name.charAt(0)}</span>
              <span>{m.name}</span>
              <span className="profile-role">{roleOf(m.user)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
