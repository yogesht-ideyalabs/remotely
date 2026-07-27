/**
 * SMTP alert email delivery — sends monitor up/down notifications and the
 * settings page's "send test email" action. Uses `nodemailer` rather than
 * hand-rolling the SMTP protocol: unlike TOTP (a single well-specified HMAC
 * construction, hand-rolled elsewhere in this project) or the login rate
 * limiter (a plain in-memory Map), SMTP has real protocol surface (STARTTLS
 * negotiation, AUTH mechanisms, MIME) that's genuinely risky to get subtly
 * wrong — the same reasoning that led to using @simplewebauthn instead of
 * hand-rolling CBOR/COSE parsing.
 *
 * Author: Yogesh Tiwari
 */

import nodemailer from "nodemailer";
import { getSmtpConfig, type SmtpConfig } from "./store.js";

export interface SendResult {
  ok: boolean;
  error?: string;
}

function transporterFor(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
  });
}

export async function sendAlertEmail(subject: string, text: string): Promise<SendResult> {
  const cfg = getSmtpConfig();
  if (!cfg || !cfg.enabled) return { ok: false, error: "SMTP alert email is not enabled" };
  if (cfg.toAddresses.length === 0) return { ok: false, error: "no alert recipient addresses configured" };
  try {
    const transporter = transporterFor(cfg);
    await transporter.sendMail({
      from: cfg.fromAddress || cfg.username,
      to: cfg.toAddresses.join(","),
      subject,
      text,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}

// Used by the settings page's "send test email" button — sends regardless
// of the `enabled` flag (so you can verify credentials before flipping
// monitoring alerts on), but still requires a saved config to send with.
export async function sendTestEmail(cfg: SmtpConfig): Promise<SendResult> {
  if (cfg.toAddresses.length === 0) return { ok: false, error: "no recipient addresses configured" };
  try {
    const transporter = transporterFor(cfg);
    await transporter.sendMail({
      from: cfg.fromAddress || cfg.username,
      to: cfg.toAddresses.join(","),
      subject: "Remotely — test alert email",
      text: "This is a test email from Remotely's alert settings. If you're reading this, SMTP delivery is configured correctly.",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}
