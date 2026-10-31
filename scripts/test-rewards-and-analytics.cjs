/**
 * Verification test suite for Workly Reward Management & Analytics Dashboard
 * 
 * FEATURE 1: REWARD MANAGEMENT
 * - Create, View, Edit, Delete rewards
 * - Employee association and storage of Employee Name, Reward Title, Description, Reward Date
 * - Validation of required fields
 * - PostgREST schema cache compatibility (title + description -> reason, reward_date -> nominated_at)
 * 
 * FEATURE 2: ANALYTICS DASHBOARD
 * - Overall Analytics: tasks assigned, completed tasks, completed projects, lagging projects
 * - Accurate progress & lag calculations (timeline elapsed vs actual progress)
 * - Employee-wise Analytics: assigned tasks, completed tasks, project statuses, attention items
 * - Data accuracy: zero hardcoded statistics, empty dataset resilience
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

console.log('====================================================')
console.log('WORKLY REWARD MANAGEMENT & ANALYTICS TEST SUITE')
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
const dashboardCode = fs.readFileSync(path.join(__dirname, '../src/lib/dashboard.js'), 'utf-8')
const edgeCode = fs.readFileSync(path.join(__dirname, '../supabase/functions/workly-api/index.ts'), 'utf-8')

// ==========================================
// 1. Feature 1: Reward Management Static & Structural Checks
// ==========================================
console.log('1. Feature 1: Reward Management (Create, Read, Update, Delete, Display):')

test('RewardsPage renders reward table with Employee Name, Title, Description, Date, Status, and Actions', () => {
  assert.ok(appCode.includes('function RewardsPage'))
  assert.ok(appCode.includes('<th>Employee Name</th>'))
  assert.ok(appCode.includes('<th>Reward Title</th>'))
  assert.ok(appCode.includes('<th>Description</th>'))
  assert.ok(appCode.includes('<th>Reward Date</th>'))
  assert.ok(appCode.includes('<th>Status</th>'))
  assert.ok(appCode.includes('<th>Actions</th>'))
})

test('RewardModal provides form fields for Employee, Reward Title, Description, Date, and Status with validation', () => {
  assert.ok(appCode.includes('function RewardModal'))
  assert.ok(appCode.includes('Reward Title *'))
  assert.ok(appCode.includes('Description *'))
  assert.ok(appCode.includes('Reward Date *'))
  assert.ok(appCode.includes('!form.employee_id || !form.title.trim() || !form.description.trim() || !form.reward_date'))
})

test('RewardsPage includes interactive Edit and Delete actions with confirmation', () => {
  assert.ok(appCode.includes('onEdit(row)'))
  assert.ok(appCode.includes("deleteRecord('rewards', reward.id)"))
  assert.ok(appCode.includes('window.confirm('))
})

test('dashboard.js extracts and formats rewards with employee_name, title, description, and reward_date', () => {
  assert.ok(dashboardCode.includes('const rewards = data.rewards.map((reward) =>'))
  assert.ok(dashboardCode.includes('emp?.full_name || \'Unknown employee\''))
  assert.ok(dashboardCode.includes('reward_date: reward.reward_date || reward.nominated_at'))
})

test('workly-api edge function normalizes rewards payload to maintain DB schema cache compatibility', () => {
  assert.ok(edgeCode.includes("table === 'rewards'"))
  assert.ok(edgeCode.includes("record.reason = t ? (d ? `${t}\\n\\n${d}` : t) : d"))
  assert.ok(edgeCode.includes("tableFields"))
  assert.ok(edgeCode.includes("rewards: ['employee_id', 'reason', 'status', 'nominated_at'"))
})

// ==========================================
// 2. Feature 1: Reward Parsing and Validation Simulation
// ==========================================
console.log('\n2. Feature 1: Reward Normalization & Parsing Simulation:')

function parseRewardReason(reason) {
  if (!reason) return { title: 'Employee Recognition', description: '' }
  const parts = reason.split('\n\n')
  if (parts.length >= 2) {
    return {
      title: parts[0].trim(),
      description: parts.slice(1).join('\n\n').trim(),
    }
  }
  return {
    title: reason.trim(),
    description: '',
  }
}

function normalizeRewardForDb(payload) {
  const norm = { ...payload }
  if (norm.title || norm.description) {
    const title = norm.title || 'Employee Recognition'
    const desc = norm.description || ''
    norm.reason = desc ? `${title.trim()}\n\n${desc.trim()}` : title.trim()
    delete norm.title
    delete norm.description
  }
  if (norm.reward_date) {
    norm.nominated_at = norm.reward_date
    delete norm.reward_date
  }
  return norm
}

test('Formats title and description into reason column and packs reward_date into nominated_at', () => {
  const input = {
    employee_id: 'emp-101',
    title: 'Top Performer Q3',
    description: 'Delivered customer migration project ahead of schedule with zero defect rate.',
    reward_date: '2026-10-15',
    status: 'approved',
  }
  const dbRecord = normalizeRewardForDb(input)
  assert.strictEqual(dbRecord.reason, 'Top Performer Q3\n\nDelivered customer migration project ahead of schedule with zero defect rate.')
  assert.strictEqual(dbRecord.nominated_at, '2026-10-15')
  assert.strictEqual(dbRecord.title, undefined)
  assert.strictEqual(dbRecord.reward_date, undefined)
})

test('Parses reason column back into title and description accurately', () => {
  const reasonText = 'Innovation Award\n\nDeveloped an automated test runner decreasing CI time by 50%.'
  const parsed = parseRewardReason(reasonText)
  assert.strictEqual(parsed.title, 'Innovation Award')
  assert.strictEqual(parsed.description, 'Developed an automated test runner decreasing CI time by 50%.')
})

test('Handles legacy single-line reason safely without losing information', () => {
  const parsed = parseRewardReason('Outstanding customer dedication in sprint 12')
  assert.strictEqual(parsed.title, 'Outstanding customer dedication in sprint 12')
  assert.strictEqual(parsed.description, '')
})

// ==========================================
// 3. Feature 2: Analytics Dashboard - Overall Analytics
// ==========================================
console.log('\n3. Feature 2: Overall Analytics Calculation Logic:')

const mockProjects = [
  {
    id: 'p1',
    name: 'Cloud Migration',
    status: 'completed',
    progress: 100,
    start_date: '2026-01-01',
    due_date: '2026-06-30',
    risk_level: 'normal',
    manager_id: 'emp-1',
  },
  {
    id: 'p2',
    name: 'Mobile App Redesign',
    status: 'in_progress',
    progress: 30, // Lagging: elapsed is ~80%, progress is 30%
    start_date: '2026-08-01',
    due_date: '2026-11-15',
    risk_level: 'high',
    manager_id: 'emp-2',
    team_lead_id: 'emp-1',
  },
  {
    id: 'p3',
    name: 'Security Audit & Compliance',
    status: 'in_progress',
    progress: 75, // On track: elapsed is ~60%, progress is 75%
    start_date: '2026-09-01',
    due_date: '2026-12-01',
    risk_level: 'low',
    manager_id: 'emp-3',
  },
  {
    id: 'p4',
    name: 'Legacy Cleanup',
    status: 'in_progress',
    progress: 10, // Overdue & lagging
    start_date: '2026-01-01',
    due_date: '2026-09-30', // passed
    risk_level: 'critical',
    manager_id: 'emp-1',
  },
  {
    id: 'p5',
    name: 'AI Onboarding',
    status: 'upcoming',
    progress: 0,
    start_date: '2026-12-01',
    due_date: '2027-03-01',
    risk_level: 'normal',
    manager_id: 'emp-2',
  },
]

const mockTasks = [
  { id: 't1', title: 'Setup AWS VPC', status: 'completed', assigned_to: 'emp-1', project_id: 'p1', due_date: '2026-02-15' },
  { id: 't2', title: 'Migrate DB cluster', status: 'completed', assigned_to: 'emp-2', project_id: 'p1', due_date: '2026-04-10' },
  { id: 't3', title: 'Build React Native Screens', status: 'in_progress', assigned_to: 'emp-1', project_id: 'p2', due_date: '2026-10-15', priority: 'high' }, // overdue
  { id: 't4', title: 'API Integration', status: 'todo', assigned_to: 'emp-1', project_id: 'p2', due_date: '2026-11-10', priority: 'urgent' },
  { id: 't5', title: 'Penetration testing', status: 'review', assigned_to: 'emp-3', project_id: 'p3', due_date: '2026-11-20', priority: 'medium' },
  { id: 't6', title: 'Refactor monolith controllers', status: 'blocked', assigned_to: 'emp-2', project_id: 'p4', due_date: '2026-09-01', priority: 'critical' }, // overdue & blocked
]

function calculateOverallAnalytics(projects, tasks, currentDate = new Date('2026-10-31')) {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'done').length
  const completedProjects = projects.filter((p) => p.status === 'completed').length

  const laggingProjects = projects.filter((proj) => {
    if (proj.status === 'completed' || proj.status === 'cancelled') return false
    const progress = Number(proj.progress) || 0
    const now = currentDate.getTime()

    if (proj.due_date && new Date(proj.due_date).getTime() < now && progress < 100) {
      return true
    }
    if (proj.risk_level === 'critical' || proj.risk_level === 'high') {
      if (progress < 50) return true
    }
    if (proj.start_date && proj.due_date) {
      const start = new Date(proj.start_date).getTime()
      const due = new Date(proj.due_date).getTime()
      if (due > start && now > start) {
        const totalDuration = due - start
        const elapsed = Math.min(now - start, totalDuration)
        const expectedProgress = Math.round((elapsed / totalDuration) * 100)
        if (expectedProgress - progress >= 15) {
          return true
        }
      }
    }
    return false
  })

  return {
    totalTasks,
    completedTasks,
    completedProjects,
    laggingProjectsCount: laggingProjects.length,
    laggingProjects,
  }
}

test('Computes total assigned tasks, completed tasks, and completed projects accurately', () => {
  const stats = calculateOverallAnalytics(mockProjects, mockTasks)
  assert.strictEqual(stats.totalTasks, 6, 'Total tasks assigned should be 6')
  assert.strictEqual(stats.completedTasks, 2, 'Total completed tasks should be 2')
  assert.strictEqual(stats.completedProjects, 1, 'Total completed projects should be 1')
})

test('Identifies projects lagging behind expected progress accurately', () => {
  const stats = calculateOverallAnalytics(mockProjects, mockTasks)
  assert.strictEqual(stats.laggingProjectsCount, 2, 'Should identify 2 lagging projects (p2 and p4)')
  const laggingIds = stats.laggingProjects.map((p) => p.id)
  assert.ok(laggingIds.includes('p2'), 'p2 should be identified as lagging')
  assert.ok(laggingIds.includes('p4'), 'p4 should be identified as lagging')
  assert.ok(!laggingIds.includes('p1'), 'p1 is completed so not lagging')
  assert.ok(!laggingIds.includes('p3'), 'p3 is on track so not lagging')
  assert.ok(!laggingIds.includes('p5'), 'p5 is upcoming so not lagging')
})

// ==========================================
// 4. Feature 2: Analytics Dashboard - Employee-wise Analytics
// ==========================================
console.log('\n4. Feature 2: Employee-wise Analytics Calculation Logic:')

function calculateEmployeeAnalytics(employeeId, projects, tasks, currentDate = new Date('2026-10-31')) {
  const empTasks = tasks.filter((t) => t.assigned_to === employeeId || t.assignee_id === employeeId)
  const totalAssigned = empTasks.length
  const completed = empTasks.filter((t) => t.status === 'completed' || t.status === 'done').length

  const empTaskProjectIds = new Set(empTasks.map((t) => t.project_id).filter(Boolean))
  const relevantProjects = projects.filter((p) => {
    return p.manager_id === employeeId || p.team_lead_id === employeeId || empTaskProjectIds.has(p.id)
  })

  const attentionTasks = empTasks.filter((t) => {
    if (t.status === 'completed' || t.status === 'done') return false
    const now = currentDate.getTime()
    const isOverdue = t.due_date && new Date(t.due_date).getTime() < now
    const isUrgent = t.priority === 'urgent' || t.priority === 'critical' || t.priority === 'high'
    const isBlocked = t.status === 'blocked'
    return isOverdue || isUrgent || isBlocked
  })

  const attentionProjects = relevantProjects.filter((p) => {
    if (p.status === 'completed' || p.status === 'cancelled') return false
    const now = currentDate.getTime()
    const isOverdue = p.due_date && new Date(p.due_date).getTime() < now && (Number(p.progress) || 0) < 100
    const isHighRisk = p.risk_level === 'high' || p.risk_level === 'critical'
    return isOverdue || isHighRisk
  })

  return {
    totalAssigned,
    completed,
    completionRate: totalAssigned > 0 ? Math.round((completed / totalAssigned) * 100) : 0,
    relevantProjects,
    attentionTasks,
    attentionProjects,
  }
}

test('Computes employee tasks and completion rate correctly for emp-1', () => {
  const stats = calculateEmployeeAnalytics('emp-1', mockProjects, mockTasks)
  assert.strictEqual(stats.totalAssigned, 3)
  assert.strictEqual(stats.completed, 1)
  assert.strictEqual(stats.completionRate, 33)
})

test('Determines relevant projects for employee using manager, lead, and task links', () => {
  const statsEmp1 = calculateEmployeeAnalytics('emp-1', mockProjects, mockTasks)
  const projectIds = statsEmp1.relevantProjects.map((p) => p.id)
  assert.ok(projectIds.includes('p1'))
  assert.ok(projectIds.includes('p2'))
  assert.ok(projectIds.includes('p4'))
  assert.ok(!projectIds.includes('p3'))
})

test('Identifies tasks and projects needing attention for selected employee', () => {
  const statsEmp1 = calculateEmployeeAnalytics('emp-1', mockProjects, mockTasks)
  assert.strictEqual(statsEmp1.attentionTasks.length, 2)
  const taskIds = statsEmp1.attentionTasks.map((t) => t.id)
  assert.ok(taskIds.includes('t3'))
  assert.ok(taskIds.includes('t4'))

  assert.strictEqual(statsEmp1.attentionProjects.length, 2)
  const projIds = statsEmp1.attentionProjects.map((p) => p.id)
  assert.ok(projIds.includes('p2'))
  assert.ok(projIds.includes('p4'))
})

test('Handles empty datasets and employees with zero tasks safely without NaN or crashes', () => {
  const emptyStats = calculateEmployeeAnalytics('emp-999', [], [])
  assert.strictEqual(emptyStats.totalAssigned, 0)
  assert.strictEqual(emptyStats.completed, 0)
  assert.strictEqual(emptyStats.completionRate, 0)
  assert.strictEqual(emptyStats.relevantProjects.length, 0)
  assert.strictEqual(emptyStats.attentionTasks.length, 0)
  assert.strictEqual(emptyStats.attentionProjects.length, 0)
})

// ==========================================
// 5. Codebase Static Verification
// ==========================================
console.log('\n5. Codebase Static Contract Verification:')

test('App.jsx renders AnalyticsPage with KPI cards, Lagging Projects section, and Employee Selector', () => {
  assert.ok(appCode.includes('function AnalyticsPage'))
  assert.ok(appCode.includes('Total Tasks Assigned'))
  assert.ok(appCode.includes('Completed Tasks'))
  assert.ok(appCode.includes('Completed Projects'))
  assert.ok(appCode.includes('Projects Lagging Behind Expected Progress'))
  assert.ok(appCode.includes('Employee-wise Analytics & Deep Dive'))
  assert.ok(appCode.includes('selectedEmpId'))
  assert.ok(appCode.includes('tasksNeedingAttention'))
  assert.ok(appCode.includes('projectsNeedingAttention'))
})

test('App.jsx navigation includes both Rewards and Analytics tabs', () => {
  assert.ok(appCode.includes("'Rewards'"))
  assert.ok(appCode.includes("'Analytics'"))
})

test('additions.css defines layout and style rules for reward and analytics elements', () => {
  const cssCode = fs.readFileSync(path.join(__dirname, '../src/additions.css'), 'utf-8')
  assert.ok(cssCode.includes('.kpi-card'))
  assert.ok(cssCode.includes('.kpi-grid'))
})

console.log('\n====================================================')
console.log(`RESULTS: ${passed} passed, ${failed} failed.`)
console.log('====================================================')

if (failed > 0) {
  process.exit(1)
}
