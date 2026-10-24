import { useState } from "react";
import "./Auth.css";

// Change this one line to rename the product everywhere in the auth pages.
export const APP_NAME = "CollabIDE";

export function AuthLayout({ headline, children }) {
  return (
    <div className="cf-auth">
      <aside className="cf-brand">
        <div className="cf-wordmark">{APP_NAME}</div>

        <div>
          <h1>{headline}</h1>
          <p className="cf-brand-copy">
            Shared coding rooms in your browser, with an isolated container for every developer.
          </p>
        </div>

        {/* editor preview: two people in one room + live resource usage */}
        <div className="cf-editor" aria-hidden="true">
          <div className="cf-editor-bar">
            <span>scheduler.py</span>
            <span>Room 4821 · 3 online</span>
          </div>

          <div className="cf-code">
            <div className="cf-line">
              <span className="cf-k">def</span> <span className="cf-f">assign</span>(tasks, nodes):
            </div>
            <div className="cf-line cf-i1">
              <span className="cf-k">for</span> t <span className="cf-k">in</span> tasks:
            </div>
            <div className="cf-line cf-i2">
              node = best_fit(t, nodes)
              <span className="cf-caret cf-caret-a"><b>Meera</b></span>
            </div>
            <div className="cf-line cf-i2">
              node.run(t)
              <span className="cf-caret cf-caret-b"><b>Aarav</b></span>
            </div>
          </div>

          <div className="cf-meters">
            <div className="cf-meter">
              <span>CPU</span>
              <i><u style={{ width: "38%" }} /></i>
              <span>38%</span>
            </div>
            <div className="cf-meter">
              <span>Memory</span>
              <i><u style={{ width: "54%" }} /></i>
              <span>412 MB</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="cf-form-side">
        <div className="cf-form-wrap">{children}</div>
      </main>
    </div>
  );
}

export function PasswordField({ id, label, value, onChange, placeholder, autoComplete, invalid, children }) {
  const [show, setShow] = useState(false);
  return (
    <div className="cf-field">
      <label htmlFor={id}>{label}</label>
      <div className="cf-pass">
        <input
          id={id}
          className={`cf-input ${invalid ? "cf-invalid" : ""}`}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          aria-invalid={invalid || undefined}
        />
        <button type="button" className="cf-show" onClick={() => setShow((s) => !s)}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {children}
    </div>
  );
}