import { useState } from "react";
import api from "../services/api";
import { useNavigate, Link } from "react-router-dom";
import { AuthLayout, PasswordField } from "./AuthLayout";

function getStrength(pw) {
  if (!pw) return { level: 0, label: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  const level = Math.max(1, score);
  return { level, label: ["", "Weak", "Fair", "Strong"][level] };
}

export default function Register() {
  const nav = useNavigate();
  const [formData, setFormData] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const update = (key) => (e) => setFormData({ ...formData, [key]: e.target.value });
  const strength = getStrength(formData.password);

  const handleRegister = async (e) => {
    e.preventDefault();

    if (formData.password.length < 8) {
      return setError("Use at least 8 characters for your password.");
    }

    try {
      setLoading(true);
      setError("");
      await api.post("/auth/register", formData);
      nav("/", { state: { registered: true } });
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't create your account. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout headline="Start shipping with CloudFlow.">
      <h2>Create your account</h2>
      <p className="cf-sub">It takes less than a minute.</p>

      {error && (
        <p className="cf-msg cf-msg-error" role="alert">
          {error}
        </p>
      )}

      <form className="cf-form" onSubmit={handleRegister}>
        <div className="cf-field">
          <label htmlFor="name">Full name</label>
          <input
            id="name"
            className="cf-input"
            placeholder="Jane Doe"
            autoComplete="name"
            autoFocus
            value={formData.name}
            onChange={update("name")}
            required
          />
        </div>

        <div className="cf-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="cf-input"
            type="email"
            placeholder="name@company.com"
            autoComplete="email"
            value={formData.email}
            onChange={update("email")}
            required
          />
        </div>

        <PasswordField
          id="password"
          label="Password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          value={formData.password}
          onChange={update("password")}
        >
          {formData.password && (
            <div className="cf-strength" data-level={strength.level}>
              <div className="cf-strength-bar">
                <span style={{ width: `${(strength.level / 3) * 100}%` }} />
              </div>
              <span>{strength.label}</span>
            </div>
          )}
        </PasswordField>

        <button className="cf-btn" type="submit" disabled={loading}>
          {loading && <span className="cf-spinner" aria-hidden="true" />}
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="cf-switch">
        Already have an account? <Link to="/">Sign in</Link>
      </p>
    </AuthLayout>
  );
}