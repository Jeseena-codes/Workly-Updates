/**
 * Workly Secure Node.js Email Service powered by Nodemailer.
 * Reads credentials strictly from server environment variables.
 * Never exposes credentials to client/frontend code.
 */
const nodemailer = require('nodemailer')
require('dotenv').config()

function getSmtpConfig() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const secure = process.env.SMTP_SECURE === 'true' || port === 465
  const from = (process.env.SMTP_FROM && process.env.SMTP_FROM.trim()) 
    || process.env.WORKLY_FROM_EMAIL 
    || (user ? `Workly HR <${user}>` : 'Workly HR <no-reply@workly.internal>')

  return { host, port, user, pass, secure, from }
}

function createTransporter() {
  const config = getSmtpConfig()
  if (!config.host || !config.user || !config.pass) {
    return null
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  })
}

async function verifyConnection() {
  const transporter = createTransporter()
  if (!transporter) {
    return {
      connected: false,
      reason: 'SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) not configured in server environment variables.',
    }
  }
  try {
    await transporter.verify()
    return { connected: true, host: process.env.SMTP_HOST, port: process.env.SMTP_PORT || 587 }
  } catch (err) {
    return { connected: false, error: err.message }
  }
}

async function sendLeaveEmail({ to, subject, html, text }) {
  const config = getSmtpConfig()
  const transporter = createTransporter()
  if (!transporter) {
    return {
      sent: false,
      reason: 'SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) not configured in server environment variables.',
    }
  }
  try {
    const info = await transporter.sendMail({
      from: config.from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    })
    return { sent: true, messageId: info.messageId }
  } catch (err) {
    return { sent: false, error: err.message }
  }
}

module.exports = {
  getSmtpConfig,
  createTransporter,
  verifyConnection,
  sendLeaveEmail,
}
