import { useState } from "react";
import api from "../services/api";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { AuthLayout, PasswordField, APP_NAME } from "./AuthLayout";

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const justRegistered = location.state?.registered;

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      return setError("Enter your email and password to continue.");
    }

    try {
      setLoading(true);
      setError("");

      const res = await api.post("/auth/login", { email: email.trim(), password });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      localStorage.setItem("userId", res.data.user._id);

      nav(location.state?.from || "/dashboard", { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Email or password is incorrect.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout headline="Code together, in the cloud.">
      <h2>Sign in</h2>
      <p className="cf-sub">Welcome back. Sign in to rejoin your rooms.</p>

      {justRegistered && !error && (
        <p className="cf-msg cf-msg-ok" role="status">
          Account created. Sign in to get started.
        </p>
      )}
      {error && (
        <p className="cf-msg cf-msg-error" role="alert">
          {error}
        </p>
      )}

      <form className="cf-form" onSubmit={handleLogin} noValidate>
        <div className="cf-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className={`cf-input ${error && !email ? "cf-invalid" : ""}`}
            type="email"
            placeholder="name@company.com"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <PasswordField
          id="password"
          label="Password"
          placeholder="Enter your password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          invalid={!!error && !password}
        />

        <button className="cf-btn" type="submit" disabled={loading}>
          {loading && <span className="cf-spinner" aria-hidden="true" />}
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="cf-switch">
        New to {APP_NAME}? <Link to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  );
}