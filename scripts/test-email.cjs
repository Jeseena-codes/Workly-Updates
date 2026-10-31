/**
 * Test script for verifying Nodemailer email functionality in Workly.
 * Usage: node scripts/test-email.cjs [optional-recipient-email]
 */
const { verifyConnection, sendLeaveEmail, getSmtpConfig } = require('../server/email-service.cjs')

async function runTest() {
  console.log('=== WORKLY EMAIL SERVICE & NODEMAILER AUDIT ===\n')
  const config = getSmtpConfig()

  console.log('1. Server Environment Configuration:')
  console.log('   - SMTP_HOST:', config.host ? `Configured (${config.host})` : 'MISSING')
  console.log('   - SMTP_PORT:', config.port || 587)
  console.log('   - SMTP_USER:', config.user ? `Configured (${config.user})` : 'MISSING')
  console.log('   - SMTP_PASS:', config.pass ? 'Configured (hidden)' : 'MISSING')
  console.log('   - SMTP_FROM:', config.from)

  console.log('\n2. Verifying Nodemailer Transporter Connection:')
  const verifyRes = await verifyConnection()
  if (verifyRes.connected) {
    console.log('   ✓ SUCCESS: SMTP connection verified successfully with host', verifyRes.host)
  } else {
    console.log('   ⚠️ NOTICE:', verifyRes.reason || verifyRes.error)
    console.log('   (To send actual outbound emails, configure SMTP_HOST, SMTP_USER, and SMTP_PASS in server environment or Supabase secrets.)')
  }

  const testRecipient = process.argv[2]
  if (testRecipient && verifyRes.connected) {
    console.log(`\n3. Sending Test Leave Approval Notification to: ${testRecipient}...`)
    const sendRes = await sendLeaveEmail({
      to: testRecipient,
      subject: 'Test Leave Approval Notification from Workly HR',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0f897b;">Workly HR: Test Notification</h2>
          <p>This is a test notification confirming Nodemailer outbound email integration is operational.</p>
        </div>
      `,
    })
    if (sendRes.sent) {
      console.log('   ✓ EMAIL DELIVERED! Message ID:', sendRes.messageId)
    } else {
      console.log('   ✗ DELIVERY FAILED:', sendRes.error || sendRes.reason)
    }
  }

  console.log('\n=== AUDIT COMPLETE ===')
}

runTest().catch((err) => {
  console.error('Fatal error during email test:', err)
  process.exit(1)
})
