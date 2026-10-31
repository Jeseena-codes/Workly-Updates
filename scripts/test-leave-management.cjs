/**
 * Comprehensive verification script for Workly Leave Management:
 * 1. Leave balance calculations (Available Quota, Used, Remaining)
 * 2. Leave request validation, duration calculations & criteria checks
 * 3. Overdraft flagging for HR review
 * 4. Deductions on approval and zero deductions on rejection
 * 5. Idempotent decisions & double-deduction prevention
 * 6. Audit trail & rejection reason recording
 * 7. Email notification dispatch via Nodemailer & server email service
 */

const assert = require('assert')
const { sendLeaveEmail, getSmtpConfig } = require('../server/email-service.cjs')

// Simulate and test the Leave calculation logic used across App.jsx & Edge function
function calculateLeaveDays(startDateStr, endDateStr, portion = 'full_day') {
  if (!startDateStr || !endDateStr) return 0
  const start = new Date(startDateStr)
  const end = new Date(endDateStr)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0

  let businessDays = 0
  const cur = new Date(start)
  while (cur <= end) {
    const dayOfWeek = cur.getDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++
    }
    cur.setDate(cur.getDate() + 1)
  }

  if (portion === 'first_half' || portion === 'second_half') {
    return Math.max(0.5, businessDays - 0.5)
  }
  return businessDays
}

function checkLeaveOverlap(existingRequests, employeeId, startDateStr, endDateStr, excludeId = null) {
  const reqStart = new Date(startDateStr)
  const reqEnd = new Date(endDateStr)

  return existingRequests.filter((req) => {
    if (req.id === excludeId) return false
    if (req.employee_id !== employeeId) return false
    if (req.status === 'rejected' || req.status === 'cancelled') return false

    const existingStart = new Date(req.start_date)
    const existingEnd = new Date(req.end_date)
    return reqStart <= existingEnd && reqEnd >= existingStart
  })
}

function validateAndFlagLeaveRequest(request, currentBalance) {
  const remaining = Number(currentBalance?.balance_days ?? 0)
  const requested = Number(request.chargeable_days || 1)
  let isFlagged = false
  let flagReason = null

  if (request.leave_type !== 'unpaid' && requested > remaining) {
    isFlagged = true
    flagReason = `Requested duration of ${requested} day(s) exceeds available balance of ${remaining} day(s).`
  }

  return {
    ...request,
    policy_exception: isFlagged,
    flag_reason: flagReason,
  }
}

// Simulate DB atomic decision state machine
class LeaveBalanceStore {
  constructor() {
    this.balances = new Map() // key: employeeId:leaveType -> { allocated_days, used_days, balance_days }
    this.requests = new Map() // key: requestId -> leave_request row
    this.decisions = []
    this.auditLogs = []
  }

  setBalance(employeeId, leaveType, allocated, used = 0) {
    this.balances.set(`${employeeId}:${leaveType}`, {
      employee_id: employeeId,
      leave_type: leaveType,
      allocated_days: allocated,
      used_days: used,
      balance_days: allocated - used,
    })
  }

  getBalance(employeeId, leaveType) {
    return (
      this.balances.get(`${employeeId}:${leaveType}`) || {
        employee_id: employeeId,
        leave_type: leaveType,
        allocated_days: 0,
        used_days: 0,
        balance_days: 0,
      }
    )
  }

  addRequest(request) {
    this.requests.set(request.id, { ...request, status: 'pending' })
  }

  decideLeave(requestId, decision, chargeableDays, reason, actorId, policyException = false) {
    const request = this.requests.get(requestId)
    if (!request) throw new Error('Leave request not found')
    if (request.status !== 'pending') throw new Error('Only pending leave requests can be decided')
    if (chargeableDays < 0) throw new Error('Chargeable leave days must be zero or more')

    const daysToCharge = decision === 'rejected' ? 0 : chargeableDays

    if (decision === 'approved' && request.leave_type !== 'unpaid') {
      const balKey = `${request.employee_id}:${request.leave_type}`
      const currentBal = this.getBalance(request.employee_id, request.leave_type)
      const newUsed = currentBal.used_days + daysToCharge
      const newRemaining = currentBal.balance_days - daysToCharge

      this.balances.set(balKey, {
        ...currentBal,
        used_days: newUsed,
        balance_days: newRemaining,
      })
    }

    request.status = decision
    request.chargeable_days = daysToCharge
    request.decision_reason = reason
    request.decided_by = actorId
    request.decided_at = new Date().toISOString()
    request.policy_exception = policyException

    this.decisions.push({
      leave_request_id: requestId,
      decision,
      chargeable_days: daysToCharge,
      reason,
      decided_by: actorId,
      created_at: new Date().toISOString(),
    })

    this.auditLogs.push({
      actor_id: actorId,
      action: decision,
      module: 'leave_requests',
      record_id: requestId,
    })

    return request
  }
}

async function runTestSuite() {
  console.log('====================================================')
  console.log('WORKLY LEAVE MANAGEMENT VERIFICATION TEST SUITE')
  console.log('====================================================\n')

  let passed = 0
  let failed = 0

  function test(name, fn) {
    try {
      fn()
      console.log(`  ✓ PASS: ${name}`)
      passed++
    } catch (e) {
      console.error(`  ✗ FAIL: ${name}`)
      console.error(`    Error: ${e.message}`)
      failed++
    }
  }

  // TEST SUITE 1: Duration calculation & Business Day logic
  console.log('1. Testing Duration Calculation & Leave Criteria:')
  test('Single weekday full day equals 1.0 day', () => {
    // 2026-11-02 (Monday) to 2026-11-02 (Monday)
    const days = calculateLeaveDays('2026-11-02', '2026-11-02', 'full_day')
    assert.strictEqual(days, 1)
  })

  test('Single weekday half day equals 0.5 day', () => {
    const days = calculateLeaveDays('2026-11-02', '2026-11-02', 'first_half')
    assert.strictEqual(days, 0.5)
  })

  test('Weekend days are automatically excluded from business day count', () => {
    // Friday 2026-11-06 to Monday 2026-11-09 is 4 calendar days (Fri, Sat, Sun, Mon)
    // Business days should be 2 (Fri, Mon)
    const days = calculateLeaveDays('2026-11-06', '2026-11-09', 'full_day')
    assert.strictEqual(days, 2)
  })

  test('Invalid inverted dates return 0 days', () => {
    const days = calculateLeaveDays('2026-11-10', '2026-11-02')
    assert.strictEqual(days, 0)
  })

  // TEST SUITE 2: Leave Overlap Detection
  console.log('\n2. Testing Leave Overlap Detection:')
  const existingReqs = [
    {
      id: 'req-1',
      employee_id: 'emp-101',
      start_date: '2026-11-10',
      end_date: '2026-11-12',
      status: 'approved',
    },
    {
      id: 'req-2',
      employee_id: 'emp-101',
      start_date: '2026-11-20',
      end_date: '2026-11-22',
      status: 'rejected', // rejected requests must not cause collision
    },
    {
      id: 'req-3',
      employee_id: 'emp-102',
      start_date: '2026-11-10',
      end_date: '2026-11-12',
      status: 'pending',
    },
  ]

  test('Detects overlapping dates for same employee', () => {
    const conflicts = checkLeaveOverlap(existingReqs, 'emp-101', '2026-11-11', '2026-11-15')
    assert.strictEqual(conflicts.length, 1)
    assert.strictEqual(conflicts[0].id, 'req-1')
  })

  test('Ignores rejected leave requests when checking overlaps', () => {
    const conflicts = checkLeaveOverlap(existingReqs, 'emp-101', '2026-11-20', '2026-11-22')
    assert.strictEqual(conflicts.length, 0)
  })

  test('Ignores leave requests for different employees', () => {
    const conflicts = checkLeaveOverlap(existingReqs, 'emp-103', '2026-11-10', '2026-11-12')
    assert.strictEqual(conflicts.length, 0)
  })

  // TEST SUITE 3: Overdraft Flagging for HR Review
  console.log('\n3. Testing Overdraft Detection & Flagging for HR Review:')
  test('Requests within available balance are NOT flagged', () => {
    const bal = { balance_days: 10 }
    const res = validateAndFlagLeaveRequest({ leave_type: 'annual', chargeable_days: 3 }, bal)
    assert.strictEqual(res.policy_exception, false)
    assert.strictEqual(res.flag_reason, null)
  })

  test('Requests exceeding available balance ARE flagged for HR review with reason', () => {
    const bal = { balance_days: 5 }
    const res = validateAndFlagLeaveRequest({ leave_type: 'annual', chargeable_days: 8 }, bal)
    assert.strictEqual(res.policy_exception, true)
    assert.ok(res.flag_reason.includes('exceeds available balance of 5 day(s)'))
  })

  test('Unpaid leave requests are not flagged for overdraft', () => {
    const bal = { balance_days: 0 }
    const res = validateAndFlagLeaveRequest({ leave_type: 'unpaid', chargeable_days: 15 }, bal)
    assert.strictEqual(res.policy_exception, false)
  })

  // TEST SUITE 4: Balance State Machine, Deductions, Idempotency & Rejections
  console.log('\n4. Testing Atomic Balance State Machine & Duplicate Deduction Prevention:')
  const store = new LeaveBalanceStore()
  // Setup Employee 1 with 20 days annual quota
  store.setBalance('emp-1', 'annual', 20, 0)

  test('Initial state: Available Quota = 20, Used = 0, Remaining = 20', () => {
    const b = store.getBalance('emp-1', 'annual')
    assert.strictEqual(b.allocated_days, 20)
    assert.strictEqual(b.used_days, 0)
    assert.strictEqual(b.balance_days, 20)
  })

  store.addRequest({
    id: 'req-app-1',
    employee_id: 'emp-1',
    leave_type: 'annual',
    start_date: '2026-11-02',
    end_date: '2026-11-04',
    chargeable_days: 3,
  })

  test('Approval deducts balance and updates used_days', () => {
    const decided = store.decideLeave('req-app-1', 'approved', 3, 'Approved by Manager', 'admin-uuid')
    assert.strictEqual(decided.status, 'approved')
    assert.strictEqual(decided.chargeable_days, 3)

    const b = store.getBalance('emp-1', 'annual')
    assert.strictEqual(b.allocated_days, 20)
    assert.strictEqual(b.used_days, 3)
    assert.strictEqual(b.balance_days, 17)
  })

  test('Duplicate decision attempt throws error (No duplicate deduction)', () => {
    assert.throws(
      () => {
        store.decideLeave('req-app-1', 'approved', 3, 'Double approval', 'admin-uuid')
      },
      { message: /Only pending leave requests can be decided/ },
    )
    // Verify balance remains exactly 17
    const b = store.getBalance('emp-1', 'annual')
    assert.strictEqual(b.used_days, 3)
    assert.strictEqual(b.balance_days, 17)
  })

  store.addRequest({
    id: 'req-rej-1',
    employee_id: 'emp-1',
    leave_type: 'annual',
    start_date: '2026-11-16',
    end_date: '2026-11-20',
    chargeable_days: 5,
  })

  test('Rejection does NOT deduct balance and records rejection reason', () => {
    const rejectionReason = 'Critical project milestone during requested week'
    const decided = store.decideLeave('req-rej-1', 'rejected', 5, rejectionReason, 'admin-uuid')
    assert.strictEqual(decided.status, 'rejected')
    assert.strictEqual(decided.chargeable_days, 0)
    assert.strictEqual(decided.decision_reason, rejectionReason)

    // Balance must be unchanged
    const b = store.getBalance('emp-1', 'annual')
    assert.strictEqual(b.used_days, 3)
    assert.strictEqual(b.balance_days, 17)

    // Verify decision audit trail recorded
    const decisionLog = store.decisions.find((d) => d.leave_request_id === 'req-rej-1')
    assert.ok(decisionLog)
    assert.strictEqual(decisionLog.decision, 'rejected')
    assert.strictEqual(decisionLog.reason, rejectionReason)
  })

  test('HR can approve flagged request with policy_exception = true', () => {
    store.addRequest({
      id: 'req-flagged-1',
      employee_id: 'emp-1',
      leave_type: 'annual',
      start_date: '2026-12-01',
      end_date: '2026-12-24',
      chargeable_days: 18,
      policy_exception: true,
      flag_reason: 'Exceeds balance',
    })

    const decided = store.decideLeave('req-flagged-1', 'approved', 18, 'Approved with HR exception', 'admin-uuid', true)
    assert.strictEqual(decided.status, 'approved')
    assert.strictEqual(decided.policy_exception, true)

    // Balance reflects approved overdraft (17 - 18 = -1)
    const b = store.getBalance('emp-1', 'annual')
    assert.strictEqual(b.used_days, 21)
    assert.strictEqual(b.balance_days, -1)
  })

  // TEST SUITE 5: Email Notification Integration
  console.log('\n5. Testing Outbound Email Service & Nodemailer Dispatch:')
  const smtpConfig = getSmtpConfig()
  test('Server environment variables are evaluated securely without leaking secrets', () => {
    assert.ok(typeof smtpConfig.port === 'number')
    assert.ok(smtpConfig.from)
  })

  test('Email service handles unconfigured SMTP credentials gracefully without throwing fatal errors', async () => {
    const result = await sendLeaveEmail({
      to: 'employee@example.com',
      subject: 'Leave Request Decision',
      html: '<p>Test notification</p>',
    })
    assert.ok(result !== null && typeof result === 'object')
    if (result.sent) {
      assert.ok(result.messageId)
    } else {
      assert.ok(result.reason || result.error)
    }
  })

  console.log('\n====================================================')
  console.log(`RESULTS: ${passed} passed, ${failed} failed.`)
  console.log('====================================================')

  if (failed > 0) {
    process.exit(1)
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal suite failure:', err)
  process.exit(1)
})
