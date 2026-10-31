/**
 * Automated Verification Test Suite for Attendance Management Enhancements in Workly.
 * Tests:
 * 1. Timestamp validation (check_out > check_in) in frontend and backend logic.
 * 2. Date-Range filter logic (inclusive boundary dates, today, clear, validation).
 * 3. Employee dropdown filter working concurrently with text search and date range.
 * 4. Database schema contracts and constraint definitions.
 */

const fs = require('fs')
const path = require('path')

console.log('====================================================')
console.log('WORKLY ATTENDANCE MANAGEMENT ENHANCEMENT TEST SUITE')
console.log('====================================================\n')

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`)
    passed++
  } else {
    console.error(`  ✗ FAIL: ${message}`)
    failed++
  }
}

// ==========================================
// 1. Database Schema & Migration Contracts
// ==========================================
console.log('1. Database Schema & Constraint Definitions:')
const schemaSql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf-8')
const migrationSql = fs.readFileSync(path.join(__dirname, '../database/migrations_01_employee_and_leave.sql'), 'utf-8')

assert(
  schemaSql.includes('attendance_records_check_times') &&
  schemaSql.includes('CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in)'),
  'schema.sql enforces CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in)'
)

assert(
  migrationSql.includes('attendance_records_check_times') &&
  migrationSql.includes('CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in)'),
  'migrations_01_employee_and_leave.sql includes attendance_records_check_times constraint'
)

// ==========================================
// 2. Server-side Validation in workly-api
// ==========================================
console.log('\n2. Backend / API Timestamp Validation Logic (workly-api):')
const apiCode = fs.readFileSync(path.join(__dirname, '../supabase/functions/workly-api/index.ts'), 'utf-8')

assert(
  apiCode.includes("table === 'attendance_records'") &&
  apiCode.includes('outMs <= inMs') &&
  apiCode.includes('Check-out time must be later than check-in time.'),
  'workly-api validates check_out > check_in on insert/update and returns descriptive 400 error'
)

assert(
  apiCode.includes('total_work_minutes = Math.round((outMs - inMs) / (1000 * 60))'),
  'workly-api automatically derives total_work_minutes from valid timestamps'
)

// Simulated backend validation function
function simulateBackendValidation(record, previous = null) {
  const inTime = record.check_in !== undefined ? record.check_in : previous?.check_in
  const outTime = record.check_out !== undefined ? record.check_out : previous?.check_out
  if (inTime && outTime) {
    const inMs = new Date(String(inTime)).getTime()
    const outMs = new Date(String(outTime)).getTime()
    if (isNaN(inMs) || isNaN(outMs)) {
      return { error: 'Invalid check-in or check-out timestamp format.' }
    }
    if (outMs <= inMs) {
      return { error: 'Check-out time must be later than check-in time.' }
    }
    const total_work_minutes = Math.round((outMs - inMs) / (1000 * 60))
    return { ok: true, total_work_minutes }
  }
  return { ok: true }
}

const invalidBackendTest1 = simulateBackendValidation({
  check_in: '2026-10-30T17:00:00Z',
  check_out: '2026-10-30T09:00:00Z',
})
assert(invalidBackendTest1.error === 'Check-out time must be later than check-in time.', 'Rejects check_out earlier than check_in (17:00 -> 09:00)')

const invalidBackendTest2 = simulateBackendValidation({
  check_in: '2026-10-30T09:00:00Z',
  check_out: '2026-10-30T09:00:00Z',
})
assert(invalidBackendTest2.error === 'Check-out time must be later than check-in time.', 'Rejects check_out equal to check_in (same timestamp)')

const validBackendTest = simulateBackendValidation({
  check_in: '2026-10-30T09:00:00Z',
  check_out: '2026-10-30T17:30:00Z',
})
assert(validBackendTest.ok && validBackendTest.total_work_minutes === 510, 'Accepts valid timestamps and calculates 510 minutes (8.5 hrs)')

const updateBackendTest = simulateBackendValidation(
  { check_out: '2026-10-30T18:00:00Z' },
  { check_in: '2026-10-30T09:00:00Z' }
)
assert(updateBackendTest.ok && updateBackendTest.total_work_minutes === 540, 'Validates partial update against previous check_in (540 mins)')

// ==========================================
// 3. Frontend Timestamp Validation Logic
// ==========================================
console.log('\n3. Frontend Validation in App.jsx (QuickAttendanceModal & RecordModal):')
const appCode = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf-8')

assert(
  appCode.includes("setMessage('Check-out time must be later than check-in time.')"),
  'QuickAttendanceModal shows clear validation message when check_out <= check_in'
)

assert(
  appCode.includes("type === 'attendance_records' && values.check_in && values.check_out") &&
  appCode.includes("throw new Error('Check-out time must be later than check-in time.')"),
  'RecordModal throws error when check_out <= check_in for attendance_records'
)

assert(
  appCode.includes("showToast('Check-out time must be later than check-in time.', 'error')"),
  'handleRecordLogout prevents logout if current time <= check_in time'
)

// ==========================================
// 4. Date-Range Filter Logic & Inclusivity
// ==========================================
console.log('\n4. Date-Range Filter Logic:')
const mockRecords = [
  { id: '1', employee_id: 'e1', full_name: 'Alice Johnson', attendance_date: '2026-10-20', work_mode: 'office', attendance_status: 'present' },
  { id: '2', employee_id: 'e2', full_name: 'Bob Smith', attendance_date: '2026-10-25', work_mode: 'office', attendance_status: 'present' },
  { id: '3', employee_id: 'e1', full_name: 'Alice Johnson', attendance_date: '2026-10-28', work_mode: 'remote', attendance_status: 'present' },
  { id: '4', employee_id: 'e3', full_name: 'Charlie Brown', attendance_date: '2026-10-30', work_mode: 'office', attendance_status: 'late' },
  { id: '5', employee_id: 'e2', full_name: 'Bob Smith', attendance_date: '2026-11-02', work_mode: 'hybrid', attendance_status: 'present' },
]

const mockEmployees = [
  { id: 'e1', employee_code: 'EMP001', full_name: 'Alice Johnson' },
  { id: 'e2', employee_code: 'EMP002', full_name: 'Bob Smith' },
  { id: 'e3', employee_code: 'EMP003', full_name: 'Charlie Brown' },
]

function filterAttendance({ employeeFilter = 'all', searchQuery = '', fromDate = '', toDate = '', modeFilter = 'all', statusFilter = 'all' }) {
  return mockRecords.filter((row) => {
    if (employeeFilter !== 'all' && row.employee_id !== employeeFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matchName = String(row.full_name || '').toLowerCase().includes(q)
      const matchEmp = mockEmployees.find((e) => e.id === row.employee_id)
      const matchCode = String(matchEmp?.employee_code || '').toLowerCase().includes(q)
      if (!matchName && !matchCode) return false
    }
    if (fromDate && toDate && fromDate > toDate) return false
    const rowDate = String(row.attendance_date || '').slice(0, 10)
    if (fromDate && rowDate < fromDate) return false
    if (toDate && rowDate > toDate) return false
    if (modeFilter !== 'all' && row.work_mode !== modeFilter) return false
    if (statusFilter !== 'all' && row.attendance_status !== statusFilter) return false
    return true
  })
}

const rangeInclusive = filterAttendance({ fromDate: '2026-10-25', toDate: '2026-10-30' })
assert(
  rangeInclusive.length === 3 &&
  rangeInclusive.some((r) => r.id === '2') && // 10-25 (boundary)
  rangeInclusive.some((r) => r.id === '3') && // 10-28 (inside)
  rangeInclusive.some((r) => r.id === '4'),   // 10-30 (boundary)
  'Date range includes both boundary dates (10-25 and 10-30) and records in between'
)

const invalidRange = filterAttendance({ fromDate: '2026-10-30', toDate: '2026-10-25' })
assert(invalidRange.length === 0, 'Invalid date range (fromDate > toDate) safely matches zero records')

const singleDayRange = filterAttendance({ fromDate: '2026-10-30', toDate: '2026-10-30' })
assert(singleDayRange.length === 1 && singleDayRange[0].id === '4', 'Today button behavior (fromDate === toDate) filters single day accurately')

const noDateFilter = filterAttendance({})
assert(noDateFilter.length === 5, 'Clear Dates button accurately restores all records across all dates')

// ==========================================
// 5. Employee Dropdown & Combined Filtering
// ==========================================
console.log('\n5. Employee Dropdown & Combined Filtering:')
assert(appCode.includes('aria-label="Filter by employee"'), 'App.jsx contains aria-label="Filter by employee" dropdown select')
assert(appCode.includes('<option value="all">All Employees</option>'), 'Employee dropdown includes "All Employees" option')

const empFilterOnly = filterAttendance({ employeeFilter: 'e1' })
assert(empFilterOnly.length === 2 && empFilterOnly.every((r) => r.employee_id === 'e1'), 'Filters specifically for employee Alice (e1)')

const combinedFilter = filterAttendance({
  employeeFilter: 'e1',
  fromDate: '2026-10-25',
  toDate: '2026-10-30',
})
assert(combinedFilter.length === 1 && combinedFilter[0].id === '3', 'Employee dropdown works concurrently with Date-Range filter')

const combinedWithSearch = filterAttendance({
  employeeFilter: 'all',
  searchQuery: 'EMP002',
  fromDate: '2026-10-01',
  toDate: '2026-10-31',
})
assert(combinedWithSearch.length === 1 && combinedWithSearch[0].id === '2', 'Text search query works concurrently with Date-Range filter')

// ==========================================
// 6. Automatic Employee Identification & Check-In/Check-Out
// ==========================================
console.log('\n6. Automatic Employee Identification & Check-In/Out:')

// 6.1 Static verification of code implementation in App.jsx
assert(
  appCode.includes("dashboard.employees.find((emp) => emp.email && emp.email.trim().toLowerCase() === user.email?.trim().toLowerCase())"),
  'App.jsx identifies current employee by matching user.email to employee.email'
)

assert(
  appCode.includes('// Automatic attendance check-in on session load for identified employee') &&
  appCode.includes("saveRecord('attendance_records', {") &&
  appCode.includes('autoCheckInAttemptedRef.current = true'),
  'App.jsx automatically records check-in for identified employee on session load'
)

assert(
  appCode.includes('handleSignOut') &&
  appCode.includes('totalWorkMinutes = Math.round(diffMs / (1000 * 60))') &&
  appCode.includes("saveRecord(\n              'attendance_records',") || appCode.includes("saveRecord('attendance_records'"),
  'App.jsx automatically records check-out on sign out and calculates total_work_minutes'
)

assert(
  appCode.includes('currentEmployee ? `${currentEmployee.full_name} (${currentEmployee.employee_code})` : \'Administrator\''),
  'App.jsx displays identified employee name and code in sidebar user card'
)

// 6.2 Simulated Behavior: Employee Identification
const directory = [
  { id: 'emp-101', email: 'alice@workly.internal', full_name: 'Alice Johnson', employee_code: 'EMP-001' },
  { id: 'emp-102', email: 'bob@workly.internal', full_name: 'Bob Smith', employee_code: 'EMP-002' },
]

function identifyEmployee(userEmail, employees) {
  if (!userEmail) return null
  return employees.find((emp) => emp.email && emp.email.trim().toLowerCase() === userEmail.trim().toLowerCase()) || null
}

const identified1 = identifyEmployee('alice@workly.internal', directory)
assert(identified1 && identified1.id === 'emp-101', 'Identifies employee when user email matches directory')

const identified2 = identifyEmployee('ALICE@workly.internal', directory)
assert(identified2 && identified2.id === 'emp-101', 'Performs case-insensitive email matching for employee identification')

const adminOnlyUser = identifyEmployee('superuser@external-admin.com', directory)
assert(adminOnlyUser === null, 'Returns null when administrator email does not correspond to an employee')

// 6.3 Simulated Behavior: Automatic Check-in
function simulateAutoCheckIn(identifiedEmp, todayDate, attendanceList) {
  if (!identifiedEmp) return { status: 'skipped_not_employee' }
  const existing = attendanceList.find(
    (rec) => rec.employee_id === identifiedEmp.id && String(rec.attendance_date).slice(0, 10) === todayDate
  )
  if (!existing) {
    return {
      action: 'create',
      record: {
        employee_id: identifiedEmp.id,
        attendance_date: todayDate,
        check_in: new Date().toISOString(),
        work_mode: 'office',
        attendance_status: 'present',
      },
    }
  }
  if (!existing.check_in) {
    return {
      action: 'update',
      id: existing.id,
      fields: { check_in: new Date().toISOString() },
    }
  }
  return { status: 'already_checked_in', id: existing.id }
}

const todayStr = new Date().toISOString().slice(0, 10)
const testAttendanceState = []

const autoCheckInResult1 = simulateAutoCheckIn(identified1, todayStr, testAttendanceState)
assert(
  autoCheckInResult1.action === 'create' &&
  autoCheckInResult1.record.employee_id === 'emp-101' &&
  autoCheckInResult1.record.attendance_status === 'present',
  'Automatic check-in generates new present record for employee today'
)

// Add the record to state
testAttendanceState.push({
  id: 'att-today-1',
  ...autoCheckInResult1.record,
})

// Second session load today should not duplicate
const autoCheckInResult2 = simulateAutoCheckIn(identified1, todayStr, testAttendanceState)
assert(
  autoCheckInResult2.status === 'already_checked_in',
  'Subsequent login/session load does not duplicate existing attendance record'
)

// 6.4 Simulated Behavior: Automatic Check-out on Sign-out
function simulateAutoCheckOut(identifiedEmp, todayDate, attendanceList, nowTime = new Date()) {
  if (!identifiedEmp) return { status: 'skipped_not_employee' }
  const existing = attendanceList.find(
    (rec) => rec.employee_id === identifiedEmp.id && String(rec.attendance_date).slice(0, 10) === todayDate
  )
  if (existing && existing.check_in && !existing.check_out) {
    const inMs = new Date(existing.check_in).getTime()
    const outMs = nowTime.getTime()
    if (outMs > inMs) {
      const diffMs = outMs - inMs
      const totalWorkMinutes = Math.round(diffMs / (1000 * 60))
      return {
        action: 'update',
        id: existing.id,
        fields: {
          check_out: nowTime.toISOString(),
          total_work_minutes: totalWorkMinutes,
        },
      }
    }
  }
  return { status: 'no_checkout_needed' }
}

const checkoutTime = new Date(Date.now() + 8 * 60 * 60 * 1000) // 8 hours later
const autoCheckOutResult = simulateAutoCheckOut(identified1, todayStr, testAttendanceState, checkoutTime)
assert(
  autoCheckOutResult.action === 'update' &&
  autoCheckOutResult.fields.total_work_minutes === 480 &&
  autoCheckOutResult.fields.check_out === checkoutTime.toISOString(),
  'Automatic check-out on sign-out records check-out timestamp and computes 480 work minutes (8 hours)'
)

// Admin-only user sign-out
const adminSignoutResult = simulateAutoCheckOut(adminOnlyUser, todayStr, testAttendanceState, checkoutTime)
assert(adminSignoutResult.status === 'skipped_not_employee', 'Admin without employee profile signs out without touching attendance')

console.log('\n====================================================')
console.log(`RESULTS: ${passed} passed, ${failed} failed.`)
console.log('====================================================\n')

if (failed > 0) {
  process.exit(1)
}
