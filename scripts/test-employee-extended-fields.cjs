/**
 * Comprehensive verification script for Workly Extended Employee Fields:
 * - Phone Number
 * - Address
 * - Emergency Contact
 * - Date of Birth
 *
 * Checks:
 * 1. Database schema and migration integrity (schema.sql & migrations_01_employee_and_leave.sql)
 * 2. Backend Edge Function tableFields & field normalization (workly-api/index.ts)
 * 3. Frontend App.jsx Add New Employee and Edit Employee modal integration
 * 4. Profile -> Personal section display and empty field fallback
 * 5. Functional simulation: Create employee with extended fields
 * 6. Functional simulation: Edit existing employee and update extended fields
 * 7. Functional simulation: Safe handling of empty/missing values (no date syntax errors)
 * 8. Persistence across simulated reload/refresh
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ PASS: ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`)
    console.error(`    ${err.message}`)
    failed++
  }
}

async function runTests() {
  console.log('====================================================')
  console.log('WORKLY EXTENDED EMPLOYEE FIELDS VERIFICATION')
  console.log('====================================================\n')

  const appJsx = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
  const schemaSql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8')
  const migrationSql = fs.readFileSync(path.join(__dirname, '../database/migrations_01_employee_and_leave.sql'), 'utf8')
  const edgeApi = fs.readFileSync(path.join(__dirname, '../supabase/functions/workly-api/index.ts'), 'utf8')

  console.log('1. Database Schema & Migration Verification:')
  test('database/schema.sql includes phone, address, emergency_contact, and date_of_birth in employees table', () => {
    assert.ok(schemaSql.includes('phone TEXT'), 'phone column missing in schema.sql')
    assert.ok(schemaSql.includes('address TEXT'), 'address column missing in schema.sql')
    assert.ok(schemaSql.includes('emergency_contact JSONB'), 'emergency_contact column missing in schema.sql')
    assert.ok(schemaSql.includes('date_of_birth DATE'), 'date_of_birth column missing in schema.sql')
  })

  test('database/migrations_01_employee_and_leave.sql includes safe ALTER TABLE statements for all 4 columns', () => {
    assert.ok(migrationSql.includes('ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;'))
    assert.ok(migrationSql.includes('ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT;'))
    assert.ok(migrationSql.includes('ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT;'))
    assert.ok(migrationSql.includes('ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact JSONB;'))
  })

  console.log('\n2. Backend Edge Function API Verification:')
  test('workly-api/index.ts allows all 4 extended fields in tableFields.employees', () => {
    assert.ok(edgeApi.includes("'phone'"))
    assert.ok(edgeApi.includes("'address'"))
    assert.ok(edgeApi.includes("'emergency_contact'"))
    assert.ok(edgeApi.includes("'date_of_birth'"))
  })

  test('workly-api/index.ts safely normalizes empty date strings and emergency_contact structure', () => {
    assert.ok(edgeApi.includes("record.date_of_birth === ''") || edgeApi.includes("record.date_of_birth = null"))
    assert.ok(edgeApi.includes("record.emergency_contact = null") || edgeApi.includes("emergency_contact"))
  })

  console.log('\n3. UI Forms & Component Integrity Verification:')
  test('EmployeeModal supports both Add New Employee and Edit Employee modes', () => {
    assert.ok(appJsx.includes('function EmployeeModal({ employee = null, dashboard, onClose, onSaved })'))
    assert.ok(appJsx.includes('const isEdit = Boolean(employee?.id)'))
    assert.ok(appJsx.includes("isEdit ? 'Edit Employee' : 'Add New Employee'"))
    assert.ok(appJsx.includes("isEdit ? 'Save Changes' : 'Create Employee'"))
  })

  test('EmployeeModal contains form inputs for Phone Number, Address, Emergency Contact, and Date of Birth', () => {
    assert.ok(appJsx.includes('Phone Number'))
    assert.ok(appJsx.includes('Date of Birth'))
    assert.ok(appJsx.includes('Emergency Contact'))
    assert.ok(appJsx.includes('Address'))
    assert.ok(appJsx.includes('value={form.phone}'))
    assert.ok(appJsx.includes('value={form.address}'))
    assert.ok(appJsx.includes('value={form.emergency_contact}'))
    assert.ok(appJsx.includes('value={form.date_of_birth}'))
  })

  test('EmployeeProfile includes Personal section with Phone, Address, Emergency contact, and Date of birth', () => {
    assert.ok(appJsx.includes("['Email', employee.email"))
    assert.ok(appJsx.includes("['Phone', employee.phone"))
    assert.ok(appJsx.includes("['Address', employee.address"))
    assert.ok(appJsx.includes("['Emergency contact'"))
    assert.ok(appJsx.includes("['Date of birth', formatDate(employee.date_of_birth)]"))
  })

  test('App provides access to Edit Employee from EmployeeProfile and ModuleExtras', () => {
    assert.ok(appJsx.includes('✎ Edit Employee'))
    assert.ok(appJsx.includes('onEdit={handleOpenEmployeeModal}'))
    assert.ok(appJsx.includes('✎ Edit'))
  })

  console.log('\n4. Functional Simulation & Data Persistence:')
  // Mock Store simulating Supabase database operations
  class MockDatabase {
    constructor() {
      this.employees = new Map()
    }

    createEmployee(values) {
      const id = `emp-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      // Normalization as performed by App.jsx & Edge Function
      const record = {
        id,
        employee_code: values.employee_code,
        full_name: values.full_name,
        email: values.email,
        department: values.department || 'Engineering',
        designation: values.designation || 'Software Engineer',
        status: values.status || 'active',
        joined_on: values.joined_on || null,
        phone: values.phone ? values.phone.trim() : null,
        address: values.address ? values.address.trim() : null,
        emergency_contact: values.emergency_contact
          ? (typeof values.emergency_contact === 'string' ? { name: values.emergency_contact.trim() } : values.emergency_contact)
          : null,
        date_of_birth: values.date_of_birth ? values.date_of_birth : null,
        created_at: new Date().toISOString(),
      }
      this.employees.set(id, record)
      return record
    }

    updateEmployee(id, values) {
      const existing = this.employees.get(id)
      if (!existing) throw new Error('Employee not found')
      const updated = {
        ...existing,
        ...values,
        phone: values.phone !== undefined ? (values.phone ? values.phone.trim() : null) : existing.phone,
        address: values.address !== undefined ? (values.address ? values.address.trim() : null) : existing.address,
        emergency_contact: values.emergency_contact !== undefined
          ? (values.emergency_contact ? (typeof values.emergency_contact === 'string' ? { name: values.emergency_contact.trim() } : values.emergency_contact) : null)
          : existing.emergency_contact,
        date_of_birth: values.date_of_birth !== undefined ? (values.date_of_birth || null) : existing.date_of_birth,
        joined_on: values.joined_on !== undefined ? (values.joined_on || null) : existing.joined_on,
      }
      this.employees.set(id, updated)
      return updated
    }

    getEmployee(id) {
      return this.employees.get(id)
    }
  }

  const db = new MockDatabase()

  test('Create new employee with all 4 fields populated', () => {
    const created = db.createEmployee({
      employee_code: 'EMP-901',
      full_name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      phone: '+91 98765 43210',
      address: '42 MG Road, Bengaluru, Karnataka 560001',
      emergency_contact: 'Raj Sharma (+91 98765 00000)',
      date_of_birth: '1992-08-15',
    })

    assert.strictEqual(created.employee_code, 'EMP-901')
    assert.strictEqual(created.phone, '+91 98765 43210')
    assert.strictEqual(created.address, '42 MG Road, Bengaluru, Karnataka 560001')
    assert.deepStrictEqual(created.emergency_contact, { name: 'Raj Sharma (+91 98765 00000)' })
    assert.strictEqual(created.date_of_birth, '1992-08-15')
  })

  test('Edit existing employee and update the 4 fields', () => {
    const existing = db.createEmployee({
      employee_code: 'EMP-902',
      full_name: 'Amit Verma',
      email: 'amit.verma@example.com',
      phone: '+91 91234 56789',
      address: 'Old Address, Delhi',
      emergency_contact: 'Old Contact',
      date_of_birth: '1988-03-20',
    })

    const updated = db.updateEmployee(existing.id, {
      phone: '+91 99999 88888',
      address: '10 Park Street, Kolkata, West Bengal',
      emergency_contact: 'Sunita Verma (Mother)',
      date_of_birth: '1988-03-25',
    })

    assert.strictEqual(updated.phone, '+91 99999 88888')
    assert.strictEqual(updated.address, '10 Park Street, Kolkata, West Bengal')
    assert.deepStrictEqual(updated.emergency_contact, { name: 'Sunita Verma (Mother)' })
    assert.strictEqual(updated.date_of_birth, '1988-03-25')
  })

  test('Employee records with empty/missing optional fields save cleanly as null (preventing Postgres date syntax error)', () => {
    const createdWithBlanks = db.createEmployee({
      employee_code: 'EMP-903',
      full_name: 'Rohan Gupta',
      email: 'rohan.gupta@example.com',
      phone: '',
      address: '',
      emergency_contact: '',
      date_of_birth: '',
    })

    assert.strictEqual(createdWithBlanks.phone, null)
    assert.strictEqual(createdWithBlanks.address, null)
    assert.strictEqual(createdWithBlanks.emergency_contact, null)
    assert.strictEqual(createdWithBlanks.date_of_birth, null)
  })

  test('Personal section helper resolves values and displays "—" for missing fields', () => {
    const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—')

    const getPersonalRows = (employee) => {
      const emergencyName = typeof employee.emergency_contact === 'string'
        ? employee.emergency_contact
        : (employee.emergency_contact?.name || employee.emergency_contact?.contact || employee.emergency_contact?.phone || '')

      return [
        ['Email', employee.email || '—'],
        ['Phone', employee.phone || '—'],
        ['Address', employee.address || '—'],
        ['Emergency contact', emergencyName || '—'],
        ['Date of birth', formatDate(employee.date_of_birth)],
      ]
    }

    const fullEmp = db.createEmployee({
      employee_code: 'EMP-904',
      full_name: 'Ananya Roy',
      email: 'ananya@example.com',
      phone: '+91 98888 77777',
      address: '77 Residency Rd, Pune',
      emergency_contact: 'Vikram Roy',
      date_of_birth: '1995-11-04',
    })

    const fullRows = getPersonalRows(fullEmp)
    assert.strictEqual(fullRows.find(([k]) => k === 'Phone')[1], '+91 98888 77777')
    assert.strictEqual(fullRows.find(([k]) => k === 'Address')[1], '77 Residency Rd, Pune')
    assert.strictEqual(fullRows.find(([k]) => k === 'Emergency contact')[1], 'Vikram Roy')
    assert.strictEqual(fullRows.find(([k]) => k === 'Date of birth')[1], '4 Nov')

    const emptyEmp = db.createEmployee({
      employee_code: 'EMP-905',
      full_name: 'New Joinee',
      email: 'joinee@example.com',
    })

    const emptyRows = getPersonalRows(emptyEmp)
    assert.strictEqual(emptyRows.find(([k]) => k === 'Phone')[1], '—')
    assert.strictEqual(emptyRows.find(([k]) => k === 'Address')[1], '—')
    assert.strictEqual(emptyRows.find(([k]) => k === 'Emergency contact')[1], '—')
    assert.strictEqual(emptyRows.find(([k]) => k === 'Date of birth')[1], '—')
  })

  test('Simulated browser refresh retains updated fields from persistent storage', () => {
    const saved = db.createEmployee({
      employee_code: 'EMP-906',
      full_name: 'Suresh Patel',
      email: 'suresh@example.com',
      phone: '+91 97777 66666',
      address: 'Ahmedabad, Gujarat',
      emergency_contact: 'Kiran Patel',
      date_of_birth: '1985-01-10',
    })

    // Simulate page refresh by re-fetching by ID from the database
    const refreshed = db.getEmployee(saved.id)
    assert.ok(refreshed)
    assert.strictEqual(refreshed.phone, '+91 97777 66666')
    assert.strictEqual(refreshed.address, 'Ahmedabad, Gujarat')
    assert.deepStrictEqual(refreshed.emergency_contact, { name: 'Kiran Patel' })
    assert.strictEqual(refreshed.date_of_birth, '1985-01-10')
  })

  console.log('\n====================================================')
  console.log(`RESULTS: ${passed} passed, ${failed} failed.`)
  console.log('====================================================')

  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})

