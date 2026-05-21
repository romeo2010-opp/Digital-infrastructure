import nodemailer from "nodemailer"
import { badRequest } from "../../../utils/http.js"

let cachedTransporter = null
let cachedConfigSignature = ""

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase())
}

function readSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const from = String(process.env.SMTP_FROM || "").trim()
  const user = String(process.env.SMTP_USER || "").trim()
  const pass = String(process.env.SMTP_PASS || "")
  const secure = readBoolean(process.env.SMTP_SECURE, port === 465)

  if (!host || !port || !from) {
    throw badRequest("MERA login email is not configured. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.")
  }

  return {
    host,
    port,
    secure,
    from,
    auth: user || pass ? { user, pass } : undefined,
  }
}

function getTransporter() {
  const config = readSmtpConfig()
  const signature = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    from: config.from,
    user: config.auth?.user || "",
    hasPass: Boolean(config.auth?.pass),
  })

  if (!cachedTransporter || cachedConfigSignature !== signature) {
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    })
    cachedConfigSignature = signature
  }

  return { transporter: cachedTransporter, from: config.from }
}

export function buildMeraLoginCodeEmail({ code, expiresAt, fullName }) {
  const name = String(fullName || "MERA officer").trim()
  const expiry = expiresAt ? new Date(expiresAt) : null
  const expiryText = expiry && !Number.isNaN(expiry.getTime())
    ? expiry.toLocaleString("en-MW", { timeZone: process.env.APP_TIME_ZONE || "Africa/Blantyre" })
    : "soon"

  return {
    subject: "Your MERA portal login code",
    text: [
      `Hello ${name},`,
      "",
      `Your MERA portal login code is ${code}.`,
      `It expires at ${expiryText}.`,
      "",
      "If you did not request this code, contact your SmartLink administrator.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5">
        <p>Hello ${name.replace(/[<>&"]/g, "")},</p>
        <p>Your MERA portal login code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
        <p>This code expires at ${expiryText}.</p>
        <p style="color:#6b7280;font-size:13px">If you did not request this code, contact your SmartLink administrator.</p>
      </div>
    `,
  }
}

export async function sendMeraLoginCodeEmail({ to, code, expiresAt, fullName }) {
  const recipient = String(to || "").trim()
  if (!recipient) throw badRequest("MERA user email is missing")

  const { transporter, from } = getTransporter()
  const message = buildMeraLoginCodeEmail({ code, expiresAt, fullName })
  await transporter.sendMail({
    from,
    to: recipient,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
}
