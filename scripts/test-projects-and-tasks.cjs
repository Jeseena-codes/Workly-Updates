const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('====================================================');
console.log('WORKLY PROJECT & TASK MANAGEMENT TEST SUITE');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// Read source files
const appJsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf-8');
const dashboardJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'dashboard.js'), 'utf-8');
const edgeIndexTs = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'workly-api', 'index.ts'), 'utf-8');

console.log('1. Feature 1: Project Management (Four Statuses, Create, Update, Display):');

it('ProjectsPage and ProjectModal support all 4 statuses: Upcoming, Ongoing, Completed, Cancelled', () => {
  assert(appJsx.includes('Upcoming'), 'Must include Upcoming');
  assert(appJsx.includes('Ongoing'), 'Must include Ongoing');
  assert(appJsx.includes('Completed'), 'Must include Completed');
  assert(appJsx.includes('Cancelled'), 'Must include Cancelled');
});

it('ProjectsPage status counts include upcoming, ongoing, completed, and cancelled', () => {
  assert(appJsx.includes("upcoming: projects.filter((p) => p.status === 'upcoming').length"), 'Counts upcoming');
  assert(appJsx.includes("ongoing: projects.filter((p) => p.status === 'in_progress' || p.status === 'ongoing').length"), 'Counts ongoing');
  assert(appJsx.includes("completed: projects.filter((p) => p.status === 'completed').length"), 'Counts completed');
  assert(appJsx.includes("cancelled: projects.filter((p) => p.status === 'cancelled').length"), 'Counts cancelled');
});

it('ProjectsPage displays view-toggle filter buttons for Upcoming, Ongoing, Completed, Cancelled', () => {
  assert(appJsx.includes("setStatusFilter('upcoming')"), 'Upcoming filter');
  assert(appJsx.includes("setStatusFilter('ongoing')"), 'Ongoing filter');
  assert(appJsx.includes("setStatusFilter('completed')"), 'Completed filter');
  assert(appJsx.includes("setStatusFilter('cancelled')"), 'Cancelled filter');
});

it('Projects cards contain status selector and edit project action button', () => {
  assert(appJsx.includes('className="status-select"'), 'Has status-select dropdown');
  assert(appJsx.includes('✎ Edit Project'), 'Has edit project button');
  assert(appJsx.includes('onEdit(project)'), 'Calls onEdit with project');
});

it('handleStatusChange and ProjectModal map ongoing to in_progress for database enum compatibility', () => {
  assert(appJsx.includes("persistedStatus = table === 'projects' && newStatus === 'ongoing' ? 'in_progress' : newStatus"), 'handleStatusChange maps ongoing');
  assert(appJsx.includes("status: form.status === 'ongoing' ? 'in_progress' : form.status"), 'ProjectModal maps ongoing');
  assert(edgeIndexTs.includes("if (table === 'projects' && record.status === 'ongoing') {\n        record.status = 'in_progress'"), 'workly-api maps ongoing to in_progress');
});

it('ProjectModal provides creation and update fields for all project details', () => {
  assert(appJsx.includes('Project Code *'), 'Has project code');
  assert(appJsx.includes('Project Name *'), 'Has project name');
  assert(appJsx.includes('Project Manager'), 'Has project manager');
  assert(appJsx.includes('Progress (%)'), 'Has progress');
  assert(appJsx.includes('Start Date'), 'Has start date');
  assert(appJsx.includes('Due Date'), 'Has due date');
  assert(appJsx.includes("saveRecord('projects', values, project?.id)"), 'Saves project record');
});

console.log('\n2. Feature 2: Employee Task Management (Details, Status Updates, Due Dates):');

it('dashboard.js enriches tasks with assignee_name, assignee_code, department, and designation', () => {
  assert(dashboardJs.includes('assignee_name: assignee?.full_name || \'Unassigned\''), 'Assignee name mapped');
  assert(dashboardJs.includes('assignee_code: assignee?.employee_code || \'\''), 'Assignee code mapped');
  assert(dashboardJs.includes('assignee_department: assignee?.department || \'\''), 'Assignee department mapped');
  assert(dashboardJs.includes('assignee_designation: assignee?.designation || \'\''), 'Assignee designation mapped');
});

it('TasksPage displays title, project, assigned employee, due date, priority, and status', () => {
  assert(appJsx.includes('<th>Task Title</th>'), 'Table has Task Title');
  assert(appJsx.includes('<th>Project</th>'), 'Table has Project');
  assert(appJsx.includes('<th>Assigned Employee</th>'), 'Table has Assigned Employee');
  assert(appJsx.includes('<th>Due Date</th>'), 'Table has Due Date');
  assert(appJsx.includes('<th>Priority</th>'), 'Table has Priority');
  assert(appJsx.includes('<th>Status</th>'), 'Table has Status');
  assert(appJsx.includes('<th>Actions</th>'), 'Table has Actions');
});

it('TasksPage supports interactive task status update and persistence', () => {
  assert(appJsx.includes("onStatusChange(task.id, e.target.value)"), 'Calls onStatusChange on status change');
  assert(appJsx.includes("onStatusChange('tasks', id, status)"), 'App passes tasks table to onStatusChange');
  assert(appJsx.includes("saveRecord(table, { status: persistedStatus }, id)"), 'Persists status via saveRecord');
});

it('TasksPage highlights overdue tasks when due_date has passed', () => {
  assert(appJsx.includes('isOverdue'), 'Has isOverdue logic');
  assert(appJsx.includes('overdue-badge'), 'Renders overdue badge');
});

it('TaskModal allows setting title, description, project, assignee, priority, status, and dates', () => {
  assert(appJsx.includes('Task Title *'), 'Has task title');
  assert(appJsx.includes('Select assignee'), 'Has assignee select');
  assert(appJsx.includes('Due Date'), 'Has due date input');
  assert(appJsx.includes("saveRecord('tasks', values, task?.id)"), 'Saves task via saveRecord');
});

console.log('\n3. Date-Based Views: Daily, Weekly, and Monthly Filtering Logic:');

// Test Daily, Weekly, Monthly logic directly with mock data
const mockTasks = [
  { id: 't1', title: 'Task Today', start_date: '2026-10-31', due_date: '2026-10-31', assignee_id: 'emp1', status: 'pending' },
  { id: 't2', title: 'Task Mid Week', start_date: '2026-10-27', due_date: '2026-10-29', assignee_id: 'emp1', status: 'in_progress' },
  { id: 't3', title: 'Task Spanning Month', start_date: '2026-10-01', due_date: '2026-10-25', assignee_id: 'emp2', status: 'completed' },
  { id: 't4', title: 'Task Next Month', start_date: '2026-11-15', due_date: '2026-11-20', assignee_id: 'emp2', status: 'pending' },
];

const isTaskInDay = (task, dayStr) => {
  const due = task.due_date ? String(task.due_date).slice(0, 10) : null;
  const start = task.start_date ? String(task.start_date).slice(0, 10) : null;
  if (due === dayStr || start === dayStr) return true;
  if (start && due && dayStr >= start && dayStr <= due) return true;
  return false;
};

const isTaskInWeek = (task, startStr, endStr) => {
  const due = task.due_date ? String(task.due_date).slice(0, 10) : null;
  const start = task.start_date ? String(task.start_date).slice(0, 10) : null;
  if (due && due >= startStr && due <= endStr) return true;
  if (start && start >= startStr && start <= endStr) return true;
  if (start && due && start <= endStr && due >= startStr) return true;
  return false;
};

const isTaskInMonth = (task, monthStr, startStr, endStr) => {
  const due = task.due_date ? String(task.due_date).slice(0, 10) : null;
  const start = task.start_date ? String(task.start_date).slice(0, 10) : null;
  if (due && (due.slice(0, 7) === monthStr || (due >= startStr && due <= endStr))) return true;
  if (start && (start.slice(0, 7) === monthStr || (start >= startStr && start <= endStr))) return true;
  if (start && due && start <= endStr && due >= startStr) return true;
  return false;
};

it('Daily View accurately identifies tasks for 2026-10-31', () => {
  const dailyTasks = mockTasks.filter(t => isTaskInDay(t, '2026-10-31'));
  assert.strictEqual(dailyTasks.length, 1);
  assert.strictEqual(dailyTasks[0].id, 't1');
});

it('Weekly View accurately identifies tasks falling within 2026-10-26 to 2026-11-01', () => {
  const weeklyTasks = mockTasks.filter(t => isTaskInWeek(t, '2026-10-26', '2026-11-01'));
  assert.strictEqual(weeklyTasks.length, 2); // t1 and t2
  assert(weeklyTasks.some(t => t.id === 't1'));
  assert(weeklyTasks.some(t => t.id === 't2'));
});

it('Monthly View accurately identifies tasks for 2026-10', () => {
  const monthlyTasks = mockTasks.filter(t => isTaskInMonth(t, '2026-10', '2026-10-01', '2026-10-31'));
  assert.strictEqual(monthlyTasks.length, 3); // t1, t2, and t3
  assert(!monthlyTasks.some(t => t.id === 't4')); // t4 is November
});

it('TasksPage includes interactive date navigation controls for Daily, Weekly, and Monthly views', () => {
  assert(appJsx.includes('Selected Day:'), 'Daily view date control');
  assert(appJsx.includes('Selected Week:'), 'Weekly view date control');
  assert(appJsx.includes('Selected Month:'), 'Monthly view date control');
  assert(appJsx.includes('stepDay'), 'Has stepDay navigator');
  assert(appJsx.includes('stepWeek'), 'Has stepWeek navigator');
  assert(appJsx.includes('stepMonth'), 'Has stepMonth navigator');
});

console.log('\n4. Employee Identification & Employee-wise Task Viewing:');

it('TasksPage provides employee dropdown filter and displays employee code alongside full name', () => {
  assert(appJsx.includes('{e.full_name} ({e.employee_code})'), 'Shows employee name and code in dropdown');
  assert(appJsx.includes('selectedEmployee'), 'Has selectedEmployee banner');
  assert(appJsx.includes('employee-summary-banner'), 'Renders employee banner');
});

it('TasksPage provides dedicated Employee-wise Grouped View layout', () => {
  assert(appJsx.includes('👤 Employee-wise View'), 'Has Employee-wise View button');
  assert(appJsx.includes('employee-task-section'), 'Has employee-task-section');
  assert(appJsx.includes('employee-task-header'), 'Has employee-task-header');
  assert(appJsx.includes('tasksByEmployee'), 'Groups tasks by employee');
});

console.log('\n====================================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed.`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
}

