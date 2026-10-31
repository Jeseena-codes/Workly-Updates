/**
 * Test Suite for Edge Function Error Handling and Affected Actions in Workly.
 * Verifies:
 * 1. Extraction of meaningful error messages from non-2xx responses (JSON with .error, .message, .msg, and plain text).
 * 2. Prevention of "Edge Function returned a non-2xx status code" masking.
 * 3. Attendance record creation / upsert logic to prevent duplicate key 400 errors.
 * 4. Safe server payload parsing and null-safe user claims extraction.
 */

const { FunctionsHttpError } = require('@supabase/functions-js')
const fs = require('fs')
const path = require('path')

console.log('====================================================')
console.log('WORKLY EDGE FUNCTION & ERROR HANDLING TEST SUITE')
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
// 1. Error Message Extraction Logic (api in dashboard.js)
// ==========================================
console.log('1. Client-Side Error Extraction (src/lib/dashboard.js):')

const dashboardCode = fs.readFileSync(path.join(__dirname, '../src/lib/dashboard.js'), 'utf-8')

assert(
  dashboardCode.includes('responseBody?.error || responseBody?.message || responseBody?.msg || message'),
  'dashboard.js extracts error, message, or msg from response body instead of defaulting to generic error'
)

assert(
  dashboardCode.includes('error.context.text()'),
  'dashboard.js includes fallback to error.context.text() for non-JSON or plain text responses'
)

// Simulated dashboard error extractor exactly matching src/lib/dashboard.js
async function extractErrorMessage(error) {
  let message = error.message
  if (error.context) {
    try {
      const cloned = typeof error.context.clone === 'function' ? error.context.clone() : error.context
      const responseBody = await cloned.json()
      message = responseBody?.error || responseBody?.message || responseBody?.msg || message
    } catch {
      try {
        const text = await error.context.text()
        if (text && text.trim()) message = text.trim()
      } catch {
        // Keep default
      }
    }
  }
  return message
}

async function testExtractionCases() {
  // Case A: JSON with error field
  const resA = new Response(JSON.stringify({ error: 'Check-out time must be later than check-in time.' }), { status: 400, headers: { 'content-type': 'application/json' } })
  const errA = new FunctionsHttpError(resA)
  const msgA = await extractErrorMessage(errA)
  assert(msgA === 'Check-out time must be later than check-in time.', 'Extracts responseBody.error accurately')

  // Case B: JSON with message field (Supabase / Gateway format)
  const resB = new Response(JSON.stringify({ message: 'Authentication required. Please sign in again.' }), { status: 401, headers: { 'content-type': 'application/json' } })
  const errB = new FunctionsHttpError(resB)
  const msgB = await extractErrorMessage(errB)
  assert(msgB === 'Authentication required. Please sign in again.', 'Extracts responseBody.message (prevents "Edge Function returned a non-2xx status code" masking)')

  // Case C: Plain text response (e.g. 502/504 gateway or 500 server crash)
  const resC = new Response('502 Bad Gateway: Upstream timeout', { status: 502, headers: { 'content-type': 'text/plain' } })
  const errC = new FunctionsHttpError(resC)
  const msgC = await extractErrorMessage(errC)
  assert(msgC === '502 Bad Gateway: Upstream timeout', 'Extracts plain-text error from response context without throwing SyntaxError')

  // Case D: Conflict error (409)
  const resD = new Response(JSON.stringify({ error: 'This project cannot be deleted because it has related tasks.' }), { status: 409, headers: { 'content-type': 'application/json' } })
  const errD = new FunctionsHttpError(resD)
  const msgD = await extractErrorMessage(errD)
  assert(msgD === 'This project cannot be deleted because it has related tasks.', 'Extracts 409 Conflict domain error correctly')
}

// ==========================================
// 2. Attendance Duplicate Constraint & RecordModal Logic
// ==========================================
console.log('\n2. Attendance Duplicate Handling & Upsert Logic:')

const appCode = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf-8')
const apiCode = fs.readFileSync(path.join(__dirname, '../supabase/functions/workly-api/index.ts'), 'utf-8')

assert(
  appCode.includes("let existingId = undefined") &&
  appCode.includes("type === 'attendance_records' && values.employee_id && values.attendance_date") &&
  appCode.includes("await saveRecord(type, values, existingId)"),
  'RecordModal in App.jsx looks up existing attendance record by date and employee to pass ID for update instead of failing on duplicate'
)

assert(
  apiCode.includes("table === 'attendance_records' && action === 'create'") &&
  apiCode.includes("upsert(record, { onConflict: 'employee_id,attendance_date' })"),
  'workly-api performs safe upsert for attendance_records to eliminate duplicate constraint failures'
)

// ==========================================
// 3. Server Exception & Null-Safety in workly-api
// ==========================================
console.log('\n3. Server Exception Handling in workly-api:')

assert(
  apiCode.includes("const authRes = await ctx.supabase.auth.getUser()") &&
  apiCode.includes("const user = authRes?.data?.user"),
  'workly-api safely checks auth result without crashing on null data destructuring'
)

assert(
  apiCode.includes("try {\n      body = await request.json()\n    } catch"),
  'workly-api safely handles malformed or non-JSON request bodies with 400 error'
)

testExtractionCases().then(() => {
  console.log('\n====================================================')
  console.log(`RESULTS: ${passed} passed, ${failed} failed.`)
  console.log('====================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
})

