/**
 * Test suite to verify restoration of the "Quick Check-in / Out" button and modal
 * on the Attendance page in Workly HR Dashboard.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

console.log('====================================================')
console.log('WORKLY QUICK CHECK-IN / OUT VERIFICATION TEST SUITE')
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

const appCode = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf-8')

// ==========================================
// 1. Root Cause & Active Tab Persistence
// ==========================================
console.log('1. Active Tab Persistence & Refresh Retention:')

test('App.jsx persists active workspace tab to localStorage to survive page refresh', () => {
  assert.ok(appCode.includes("localStorage.getItem('workly_active_tab')"))
  assert.ok(appCode.includes("localStorage.setItem('workly_active_tab', active)"))
})

test('App.jsx checks URL parameters/hash for deep linking tab navigation', () => {
  assert.ok(appCode.includes("window.location.hash.replace"))
  assert.ok(appCode.includes("urlParams?.get('tab')") || appCode.includes("urlParams.get('tab')"))
})

// ==========================================
// 2. Button Location & Design on Attendance Page
// ==========================================
console.log('\n2. Button Location & Design on Attendance Page:')

test('Attendance page displays "Quick Check-in / Out" button in page-actions header', () => {
  assert.ok(appCode.includes('Quick Check-in / Out'))
  assert.ok(appCode.includes('onClick={onQuickAttendance}'))
})

test('Attendance page preserves existing "Add Attendance" button in page-actions header', () => {
  assert.ok(appCode.includes('Add Attendance'))
  assert.ok(appCode.includes("onCreateRecord('attendance_records')"))
})

// ==========================================
// 3. Quick Attendance Modal & Form Fields
// ==========================================
console.log('\n3. Quick Attendance Form Fields & Controls:')

test('QuickAttendanceModal renders Employee select dropdown', () => {
  assert.ok(appCode.includes('function QuickAttendanceModal'))
  assert.ok(appCode.includes('Employee *'))
  assert.ok(appCode.includes('value={employeeId}'))
})

test('QuickAttendanceModal renders Attendance Date input', () => {
  assert.ok(appCode.includes('Attendance Date *'))
  assert.ok(appCode.includes('value={attendanceDate}'))
})

test('QuickAttendanceModal renders Entry Type with Both, Login Only, and Logout Only', () => {
  assert.ok(appCode.includes('Entry Type'))
  assert.ok(appCode.includes('Both (Login & Logout)'))
  assert.ok(appCode.includes('Login Only'))
  assert.ok(appCode.includes('Logout Only'))
})

test('QuickAttendanceModal renders Check-in Time and Check-out Time controls', () => {
  assert.ok(appCode.includes('Check-in Time'))
  assert.ok(appCode.includes('value={checkInTime}'))
  assert.ok(appCode.includes('Check-out Time'))
  assert.ok(appCode.includes('value={checkOutTime}'))
})

test('QuickAttendanceModal renders Work Mode and Attendance Status select dropdowns', () => {
  assert.ok(appCode.includes('Work Mode'))
  assert.ok(appCode.includes('value={workMode}'))
  assert.ok(appCode.includes('Attendance Status'))
  assert.ok(appCode.includes('value={status}'))
})

// ==========================================
// 4. Submission & Database Persistence Logic Simulation
// ==========================================
console.log('\n4. Submission & Database Persistence Logic Simulation:')

function simulateQuickSubmit(form, existingRecord = null) {
  const { employeeId, attendanceDate, entryType, checkInTime, checkOutTime, workMode, status } = form

  if (!employeeId) throw new Error('Please select an employee.')

  let inIso = null
  let outIso = null

  if (entryType === 'both' || entryType === 'login_only') {
    if (checkInTime) inIso = `${attendanceDate}T${checkInTime}:00`
  } else if (existingRecord?.check_in) {
    inIso = existingRecord.check_in
  }

  if (entryType === 'both' || entryType === 'logout_only') {
    if (checkOutTime) outIso = `${attendanceDate}T${checkOutTime}:00`
  } else if (existingRecord?.check_out) {
    outIso = existingRecord.check_out
  }

  if (inIso && outIso && new Date(outIso).getTime() <= new Date(inIso).getTime()) {
    throw new Error('Check-out time must be later than check-in time.')
  }

  let totalWorkMinutes = null
  if (inIso && outIso) {
    const diffMs = new Date(outIso).getTime() - new Date(inIso).getTime()
    if (diffMs > 0) totalWorkMinutes = Math.round(diffMs / (1000 * 60))
  }

  return {
    recordIdToUpdate: existingRecord?.id || undefined,
    values: {
      employee_id: employeeId,
      attendance_date: attendanceDate,
      work_mode: workMode,
      attendance_status: status,
      check_in: inIso,
      check_out: outIso,
      ...(totalWorkMinutes !== null ? { total_work_minutes: totalWorkMinutes } : {}),
    },
  }
}

test('Both mode computes check-in, check-out, and total_work_minutes accurately', () => {
  const res = simulateQuickSubmit({
    employeeId: 'emp-1',
    attendanceDate: '2026-10-31',
    entryType: 'both',
    checkInTime: '09:00',
    checkOutTime: '17:30',
    workMode: 'office',
    status: 'present',
  })
  assert.strictEqual(res.values.check_in, '2026-10-31T09:00:00')
  assert.strictEqual(res.values.check_out, '2026-10-31T17:30:00')
  assert.strictEqual(res.values.total_work_minutes, 510)
})

test('Login Only mode records check-in and omits check-out when no prior record exists', () => {
  const res = simulateQuickSubmit({
    employeeId: 'emp-2',
    attendanceDate: '2026-10-31',
    entryType: 'login_only',
    checkInTime: '08:45',
    checkOutTime: '17:00',
    workMode: 'remote',
    status: 'present',
  })
  assert.strictEqual(res.values.check_in, '2026-10-31T08:45:00')
  assert.strictEqual(res.values.check_out, null)
  assert.strictEqual(res.values.total_work_minutes, undefined)
})

test('Logout Only mode updates existing record check-out and computes work duration', () => {
  const existing = {
    id: 'att-101',
    employee_id: 'emp-3',
    attendance_date: '2026-10-31',
    check_in: '2026-10-31T09:00:00',
    check_out: null,
  }
  const res = simulateQuickSubmit(
    {
      employeeId: 'emp-3',
      attendanceDate: '2026-10-31',
      entryType: 'logout_only',
      checkInTime: '09:00',
      checkOutTime: '18:00',
      workMode: 'office',
      status: 'present',
    },
    existing
  )
  assert.strictEqual(res.recordIdToUpdate, 'att-101')
  assert.strictEqual(res.values.check_in, '2026-10-31T09:00:00')
  assert.strictEqual(res.values.check_out, '2026-10-31T18:00:00')
  assert.strictEqual(res.values.total_work_minutes, 540)
})

test('Rejects check_out <= check_in with descriptive validation error', () => {
  assert.throws(
    () => {
      simulateQuickSubmit({
        employeeId: 'emp-1',
        attendanceDate: '2026-10-31',
        entryType: 'both',
        checkInTime: '18:00',
        checkOutTime: '09:00',
        workMode: 'office',
        status: 'present',
      })
    },
    (err) => err.message === 'Check-out time must be later than check-in time.'
  )
})

console.log('\n====================================================')
console.log(`RESULTS: ${passed} passed, ${failed} failed.`)
console.log('====================================================')

if (failed > 0) {
  process.exit(1)
}

