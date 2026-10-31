import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createEvent,
  decideAttendanceCorrection,
  decideLeave,
  deleteEmployee,
  deleteRecord,
  emptyDashboard,
  getDashboard,
  inviteEmployee,
  saveRecord,
  uploadEmployeeDocument,
} from './lib/dashboard'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const navItems = [
  ['Overview', '⌂'],
  ['Employee details', '♙'],
  ['Leave management', '◷'],
  ['Attendance', '◫'],
  ['Project management', '▣'],
  ['Employee tasks', '✓'],
  ['Rewards', '✦'],
  ['Analytics', '◉'],
]

const number = (value) => Number(value || 0)
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—')

function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true)
      return undefined
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => subscription.unsubscribe()
  }, [])

  if (!isSupabaseConfigured) return <AuthScreen configurationRequired />
  if (!ready) return <div className="auth-shell">Loading secure workspace…</div>
  if (!session) return <AuthScreen />
  return <DashboardApp user={session.user} />
}

function DashboardApp({ user }) {
  const [active, setActive] = useState(() => {
    try {
      const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#\/?/, '').trim() : ''
      const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
      const tabParam = urlParams?.get('tab')
      const target = tabParam || hash
      const validTabs = [
        'Overview',
        'Employee details',
        'Leave management',
        'Attendance',
        'Project management',
        'Employee tasks',
        'Rewards',
        'Analytics',
      ]
      const matched = validTabs.find((t) => t.toLowerCase() === target?.toLowerCase())
      if (matched) return matched

      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('workly_active_tab') : null
      if (saved && validTabs.includes(saved)) {
        return saved
      }
    } catch {
      // fallback
    }
    return 'Overview'
  })

  useEffect(() => {
    try {
      if (active && typeof localStorage !== 'undefined') {
        localStorage.setItem('workly_active_tab', active)
      }
    } catch {
      // ignore
    }
  }, [active])
  const [dashboard, setDashboard] = useState(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [recordType, setRecordType] = useState(null)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [decision, setDecision] = useState(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [globalQuery, setGlobalQuery] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState(null)
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false)
  const [editingBalance, setEditingBalance] = useState(null)
  const [balanceModalOpen, setBalanceModalOpen] = useState(false)
  const [toast, setToast] = useState(null)

  const [editingProject, setEditingProject] = useState(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingReward, setEditingReward] = useState(null)
  const [rewardModalOpen, setRewardModalOpen] = useState(false)
  const [quickAttendanceOpen, setQuickAttendanceOpen] = useState(false)

  const autoCheckInAttemptedRef = useRef(false)

  const showToast = (message, type = 'info') => {
    setToast({ message, type })
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr))
    }, 4500)
  }

  const refreshDashboard = async () => {
    setLoading(true)
    try {
      const data = await getDashboard()
      setDashboard(data)
      setError('')
    } catch (requestError) {
      setDashboard(emptyDashboard)
      setError(requestError.message || 'Could not load data from Supabase.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshDashboard()
  }, [])

  // Identify logged in employee by matching user.email to employee.email
  const currentEmployee = useMemo(() => {
    if (!user?.email || !dashboard.employees?.length) return null
    return dashboard.employees.find((emp) => emp.email && emp.email.trim().toLowerCase() === user.email?.trim().toLowerCase()) || null
  }, [user, dashboard.employees])

  // Automatic attendance check-in on session load for identified employee
  useEffect(() => {
    if (!currentEmployee || autoCheckInAttemptedRef.current) return
    const today = new Date().toISOString().slice(0, 10)
    const existing = dashboard.attendance.find(
      (rec) => rec.employee_id === currentEmployee.id && String(rec.attendance_date).slice(0, 10) === today
    )
    if (!existing) {
      autoCheckInAttemptedRef.current = true
      const nowIso = new Date().toISOString()
      saveRecord('attendance_records', {
        employee_id: currentEmployee.id,
        attendance_date: today,
        check_in: nowIso,
        attendance_status: 'present',
        work_mode: 'office',
      })
        .then(() => {
          showToast(`Welcome, ${currentEmployee.full_name}! Check-in recorded automatically.`, 'success')
          refreshDashboard()
        })
        .catch((err) => {
          console.warn('[Attendance] Automatic check-in skipped:', err.message)
        })
    } else {
      autoCheckInAttemptedRef.current = true
    }
  }, [currentEmployee, dashboard.attendance])

  const handleSignOut = async () => {
    try {
      if (currentEmployee) {
        const today = new Date().toISOString().slice(0, 10)
        const todayRec = dashboard.attendance.find(
          (rec) => rec.employee_id === currentEmployee.id && String(rec.attendance_date).slice(0, 10) === today
        )
        if (todayRec && !todayRec.check_out && todayRec.check_in) {
          const now = new Date()
          const checkInTime = new Date(todayRec.check_in).getTime()
          const diffMs = now.getTime() - checkInTime
          if (diffMs > 0) {
            const totalWorkMinutes = Math.round(diffMs / (1000 * 60))
            await saveRecord(
              'attendance_records',
              {
                check_out: now.toISOString(),
                total_work_minutes: totalWorkMinutes,
              },
              todayRec.id
            )
          }
        }
      }
    } catch (e) {
      console.warn('Sign-out attendance recording error:', e)
    } finally {
      await supabase.auth.signOut()
    }
  }

  const handleOpenProjectModal = (project = null) => {
    setEditingProject(project)
    setProjectModalOpen(true)
  }

  const handleOpenTaskModal = (task = null) => {
    setEditingTask(task)
    setTaskModalOpen(true)
  }

  const handleOpenEmployeeModal = (employee = null) => {
    setEditingEmployee(employee)
    setEmployeeModalOpen(true)
  }

  const handleOpenRewardModal = (reward = null) => {
    setEditingReward(reward)
    setRewardModalOpen(true)
  }

  const handleDeleteReward = async (reward) => {
    if (!window.confirm(`Are you sure you want to delete the reward "${reward.title || reward.reason}" for ${reward.full_name}?`)) {
      return
    }
    try {
      await deleteRecord('rewards', reward.id)
      showToast('Reward deleted successfully.', 'success')
      refreshDashboard()
    } catch (err) {
      showToast(err.message || 'Could not delete reward.', 'error')
    }
  }

  const handleStatusChange = async (table, id, newStatus) => {
    try {
      const persistedStatus = table === 'projects' && newStatus === 'ongoing' ? 'in_progress' : newStatus
      await saveRecord(table, { status: persistedStatus }, id)
      const label = table === 'projects' && (newStatus === 'in_progress' || newStatus === 'ongoing') ? 'ongoing' : newStatus.replace('_', ' ')
      showToast(`${table === 'projects' ? 'Project' : 'Task'} status updated to ${label}.`, 'success')
      refreshDashboard()
    } catch (err) {
      showToast(err.message || 'Could not update status.', 'error')
    }
  }

  const handleRecordLogout = async (record) => {
    try {
      const now = new Date()
      if (record.check_in) {
        const checkInTime = new Date(record.check_in).getTime()
        if (now.getTime() <= checkInTime) {
          showToast('Check-out time must be later than check-in time.', 'error')
          return
        }
      }
      const checkOutIso = now.toISOString()
      let totalWorkMinutes = null
      if (record.check_in) {
        const checkInTime = new Date(record.check_in).getTime()
        const diffMs = now.getTime() - checkInTime
        if (diffMs > 0) {
          totalWorkMinutes = Math.round(diffMs / (1000 * 60))
        }
      }
      await saveRecord(
        'attendance_records',
        {
          check_out: checkOutIso,
          ...(totalWorkMinutes !== null ? { total_work_minutes: totalWorkMinutes } : {}),
        },
        record.id
      )
      showToast(`Recorded logout for ${record.full_name || 'employee'}.`, 'success')
      refreshDashboard()
    } catch (err) {
      showToast(err.message || 'Could not record logout.', 'error')
    }
  }

  const handleOpenBalanceModal = (employee = null) => {
    setEditingBalance(employee)
    setBalanceModalOpen(true)
  }

  const selectedProject = useMemo(
    () => dashboard.projects.find((project) => project.id === selectedEvent?.project_id),
    [dashboard.projects, selectedEvent]
  )

  const openProject = (projectId) => {
    setSelectedEvent(null)
    setActive('Project management')
    setTimeout(() => {
      document.getElementById(`project-${projectId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  const searchResults =
    globalQuery.trim().length < 2
      ? []
      : [
          ...dashboard.employees.map((record) => ({
            kind: 'Employee',
            label: record.full_name,
            detail: `${record.employee_code} · ${record.department || 'No department'}`,
            record,
          })),
          ...dashboard.projects.map((record) => ({
            kind: 'Project',
            label: record.name,
            detail: record.project_code,
            record,
          })),
          ...dashboard.tasks.map((record) => ({
            kind: 'Task',
            label: record.title,
            detail: `${record.project_name} · ${record.assignee_name}`,
            record,
          })),
          ...dashboard.leaveRequests.map((record) => ({
            kind: 'Leave',
            label: record.full_name,
            detail: `${record.leave_type} · ${record.status}`,
            record,
          })),
          ...dashboard.events.map((record) => ({
            kind: 'Event',
            label: record.title,
            detail: record.project_name,
            record,
          })),
        ]
          .filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(globalQuery.toLowerCase()))
          .slice(0, 8)

  const selectSearch = (item) => {
    setGlobalQuery('')
    if (item.kind === 'Employee') {
      setSelectedEmployee(item.record)
      return
    }
    if (item.kind === 'Project') {
      openProject(item.record.id)
      return
    }
    if (item.kind === 'Event') {
      setSelectedEvent(item.record)
      return
    }
    setActive(item.kind === 'Task' ? 'Employee tasks' : 'Leave management')
  }

  return (
    <div className="app-shell">
      {toast && (
        <div className={`toast-banner ${toast.type}`}>
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)}>×</button>
        </div>
      )}

      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">w</span>
          <span>workly</span>
        </div>
        <div className="workspace-label">ADMIN WORKSPACE</div>
        <nav>
          {navItems.map(([label, icon]) => (
            <button key={label} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => setActive(label)}>
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setHelpOpen(true)}>
            <span>?</span>Help centre
          </button>
          <div className="user-card">
            <div className="avatar">{(currentEmployee?.full_name || user.email)?.[0]?.toUpperCase()}</div>
            <div>
              <strong>{currentEmployee ? `${currentEmployee.full_name} (${currentEmployee.employee_code})` : 'Administrator'}</strong>
              <small>{user.email}</small>
            </div>
            <button className="signout" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="crumb">
            <span>Workspace</span>
            <b>/</b>
            <strong>{active}</strong>
          </div>
          <div className="top-actions">
            <div className="global-search">
              <label className="search">
                <span>⌕</span>
                <input
                  aria-label="Search"
                  value={globalQuery}
                  onChange={(event) => setGlobalQuery(event.target.value)}
                  placeholder="Search employees, projects, tasks…"
                />
              </label>
              {globalQuery.trim().length >= 2 && (
                <div className="search-results">
                  {searchResults.length ? (
                    searchResults.map((item, index) => (
                      <button key={`${item.kind}-${index}`} onClick={() => selectSearch(item)}>
                        <b>{item.label}</b>
                        <span>
                          {item.kind} · {item.detail}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p>No matching cloud records.</p>
                  )}
                </div>
              )}
            </div>
            <button className="icon-button" aria-label="Notifications" onClick={() => setNotificationsOpen(true)}>
              ♢
              {dashboard.notifications.filter((item) => !item.read_at).length ? (
                <i className="notification-count">{dashboard.notifications.filter((item) => !item.read_at).length}</i>
              ) : null}
            </button>
            <div className="avatar top-avatar">{(currentEmployee?.full_name || user.email)?.[0]?.toUpperCase()}</div>
          </div>
        </header>

        {error && (
          <div className="connection-banner">
            {error} <button onClick={refreshDashboard}>Try again</button>
          </div>
        )}

        <WorkspacePage
          active={active}
          dashboard={dashboard}
          loading={loading}
          onEventClick={setSelectedEvent}
          onCalendarOpen={() => setCalendarOpen(true)}
          onCreate={() => setCreateOpen(true)}
          onBack={() => setActive('Overview')}
          onCreateRecord={setRecordType}
          onOpenEmployeeModal={handleOpenEmployeeModal}
          onOpenBalanceModal={handleOpenBalanceModal}
          onSelectEmployee={setSelectedEmployee}
          onDecide={setDecision}
          onOpenProjectModal={handleOpenProjectModal}
          onOpenTaskModal={handleOpenTaskModal}
          onOpenRewardModal={handleOpenRewardModal}
          onDeleteReward={handleDeleteReward}
          onQuickAttendance={() => setQuickAttendanceOpen(true)}
          onRecordLogout={handleRecordLogout}
          onStatusChange={handleStatusChange}
        />
      </main>

      {selectedEvent && (
        <EventModal event={selectedEvent} project={selectedProject} onClose={() => setSelectedEvent(null)} onOpenProject={openProject} />
      )}
      {calendarOpen && (
        <CalendarModal
          events={dashboard.events}
          onClose={() => setCalendarOpen(false)}
          onEventClick={(event) => {
            setCalendarOpen(false)
            setSelectedEvent(event)
          }}
        />
      )}
      {createOpen && (
        <CreateEventModal
          projects={dashboard.projects}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            refreshDashboard()
          }}
        />
      )}
      {recordType && (
        <RecordModal
          type={recordType}
          dashboard={dashboard}
          onClose={() => setRecordType(null)}
          onSaved={() => {
            setRecordType(null)
            refreshDashboard()
          }}
        />
      )}
      {selectedEmployee && (
        <EmployeeProfile
          employee={dashboard.employees.find((e) => e.id === selectedEmployee.id) || selectedEmployee}
          dashboard={dashboard}
          onClose={() => setSelectedEmployee(null)}
          onEdit={handleOpenEmployeeModal}
        />
      )}
      {decision && (
        <DecisionModal
          decision={decision}
          onClose={() => setDecision(null)}
          onSaved={(toastInfo) => {
            setDecision(null)
            if (toastInfo?.message) showToast(toastInfo.message, toastInfo.type || 'info')
            refreshDashboard()
          }}
        />
      )}
      {(projectModalOpen || editingProject) && (
        <ProjectModal
          key={editingProject?.id || 'new-project'}
          project={editingProject}
          employees={dashboard.employees}
          onClose={() => {
            setProjectModalOpen(false)
            setEditingProject(null)
          }}
          onSaved={() => {
            setProjectModalOpen(false)
            setEditingProject(null)
            showToast(editingProject ? 'Project updated successfully.' : 'Project created successfully.', 'success')
            refreshDashboard()
          }}
        />
      )}
      {(taskModalOpen || editingTask) && (
        <TaskModal
          key={editingTask?.id || 'new-task'}
          task={editingTask}
          projects={dashboard.projects}
          employees={dashboard.employees}
          onClose={() => {
            setTaskModalOpen(false)
            setEditingTask(null)
          }}
          onSaved={() => {
            setTaskModalOpen(false)
            setEditingTask(null)
            showToast(editingTask ? 'Task updated successfully.' : 'Task created successfully.', 'success')
            refreshDashboard()
          }}
        />
      )}
      {(rewardModalOpen || editingReward) && (
        <RewardModal
          key={editingReward?.id || 'new-reward'}
          reward={editingReward}
          employees={dashboard.employees}
          onClose={() => {
            setRewardModalOpen(false)
            setEditingReward(null)
          }}
          onSaved={() => {
            setRewardModalOpen(false)
            setEditingReward(null)
            showToast(editingReward ? 'Reward updated successfully.' : 'Reward created successfully.', 'success')
            refreshDashboard()
          }}
        />
      )}
      {quickAttendanceOpen && (
        <QuickAttendanceModal
          dashboard={dashboard}
          onClose={() => setQuickAttendanceOpen(false)}
          onSaved={() => {
            setQuickAttendanceOpen(false)
            showToast('Attendance recorded successfully.', 'success')
            refreshDashboard()
          }}
        />
      )}
      {employeeModalOpen && (
        <EmployeeModal
          employee={editingEmployee}
          dashboard={dashboard}
          onClose={() => {
            setEmployeeModalOpen(false)
            setEditingEmployee(null)
          }}
          onSaved={() => {
            setEmployeeModalOpen(false)
            setEditingEmployee(null)
            showToast(editingEmployee ? 'Employee profile updated successfully.' : 'Employee profile saved successfully.', 'success')
            refreshDashboard()
          }}
        />
      )}
      {balanceModalOpen && (
        <BalanceModal
          employee={editingBalance}
          dashboard={dashboard}
          onClose={() => {
            setBalanceModalOpen(false)
            setEditingBalance(null)
          }}
          onSaved={() => {
            setBalanceModalOpen(false)
            setEditingBalance(null)
            showToast('Leave balances updated successfully.', 'success')
            refreshDashboard()
          }}
        />
      )}
      {notificationsOpen && (
        <NotificationsModal notifications={dashboard.notifications} onClose={() => setNotificationsOpen(false)} />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

function Overview({ dashboard, loading, onEventClick, onCalendarOpen, onCreate }) {
  const { summary, taskSummary, leaveRequests } = dashboard
  const count = (status) => number(taskSummary.find((item) => item.status === status)?.count)
  const totalTasks = taskSummary.reduce((total, item) => total + number(item.count), 0)

  return (
    <div className="page overview-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">ORGANISATION OVERVIEW</p>
          <h1>Overview</h1>
          <p className="subheading">Live information from your Workly PostgreSQL database.</p>
        </div>
        <button className="primary-button" onClick={onCreate}>
          <span>＋</span> Create event
        </button>
      </section>

      <section className="metric-grid">
        <Metric title="Total employees" value={summary.total_employees} detail={`${number(summary.on_leave)} currently on leave`} icon="♙" tone="blue" />
        <Metric title="Attendance today" value={dashboard.attendance.filter((r) => r.attendance_date === new Date().toISOString().slice(0, 10)).length} detail="Recorded today" icon="◫" tone="purple" />
        <Metric title="Pending approvals" value={summary.pending_leave_requests} detail="Leave requests awaiting review" icon="◷" tone="orange" />
        <Metric title="Active projects" value={summary.active_projects} detail="Upcoming and ongoing projects" icon="▣" tone="teal" />
      </section>

      <section className="dashboard-grid">
        <div className="panel calendar-panel">
          <div className="panel-heading">
            <div>
              <h2>Schedule</h2>
              <p>Project events and milestones</p>
            </div>
            <button className="text-button" onClick={onCalendarOpen}>
              View calendar <span>→</span>
            </button>
          </div>
          <Schedule events={dashboard.events} loading={loading} onEventClick={onEventClick} />
        </div>

        <div className="panel tasks-panel">
          <div className="panel-heading">
            <div>
              <h2>Tasks by status</h2>
              <p>Across all projects</p>
            </div>
          </div>
          <div className="donut-layout">
            <div className="donut neutral">
              <div>
                <strong>{totalTasks}</strong>
                <span>tasks</span>
              </div>
            </div>
            <div className="legend">
              <Legend color="orange" name="To do" value={count('pending')} />
              <Legend color="blue" name="In progress" value={count('in_progress')} />
              <Legend color="purple" name="In review" value={count('in_review')} />
              <Legend color="teal" name="Completed" value={count('completed')} />
            </div>
          </div>
        </div>

        <div className="panel leave-panel">
          <div className="panel-heading">
            <div>
              <h2>
                Pending leave requests <span className="count">{leaveRequests.filter((r) => r.status === 'pending').length}</span>
              </h2>
              <p>Requests waiting for your decision</p>
            </div>
          </div>
          <LeaveRows rows={leaveRequests.filter((r) => r.status === 'pending')} loading={loading} />
        </div>

        <div className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>Database status</h2>
              <p>Data is persisted in your Supabase backend.</p>
            </div>
          </div>
          <div className="empty-state">
            <span>◌</span>
            <strong>{loading ? 'Loading organisation data…' : 'Ready for your records'}</strong>
            <p>Create employees, projects, tasks, leave requests, and events through your application flows.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

const Metric = ({ title, value, detail, icon, tone }) => (
  <article className="metric-card">
    <div className={`metric-icon ${tone}`}>{icon}</div>
    <p>{title}</p>
    <strong>{value ?? 0}</strong>
    <small>{detail}</small>
  </article>
)

const Legend = ({ color, name, value }) => (
  <div>
    <span className={`legend-dot ${color}`} />
    {name}
    <b>{value}</b>
  </div>
)

const Empty = ({ text }) => (
  <div className="empty-state compact">
    <span>◌</span>
    <p>{text}</p>
  </div>
)

function WorkspacePage({
  active,
  dashboard,
  loading,
  onEventClick,
  onCalendarOpen,
  onCreate,
  onBack,
  onCreateRecord,
  onOpenEmployeeModal,
  onOpenBalanceModal,
  onSelectEmployee,
  onDecide,
  onOpenProjectModal,
  onOpenTaskModal,
  onOpenRewardModal,
  onDeleteReward,
  onQuickAttendance,
  onRecordLogout,
  onStatusChange,
}) {
  const [leaveTab, setLeaveTab] = useState('requests')
  const [attSearch, setAttSearch] = useState('')
  const [attEmp, setAttEmp] = useState('all')
  const [attMode, setAttMode] = useState('all')
  const [attStatus, setAttStatus] = useState('all')
  const [attFrom, setAttFrom] = useState('')
  const [attTo, setAttTo] = useState('')

  if (active === 'Overview') {
    return <Overview dashboard={dashboard} loading={loading} onEventClick={onEventClick} onCalendarOpen={onCalendarOpen} onCreate={onCreate} />
  }

  if (active === 'Project management') {
    return (
      <ProjectsPage
        projects={dashboard.projects}
        employees={dashboard.employees}
        loading={loading}
        onBack={onBack}
        onCreate={() => onOpenProjectModal(null)}
        onEdit={(proj) => onOpenProjectModal(proj)}
        onStatusChange={(id, status) => onStatusChange('projects', id, status)}
      />
    )
  }

  if (active === 'Employee tasks') {
    return (
      <TasksPage
        dashboard={dashboard}
        loading={loading}
        onCreate={() => onOpenTaskModal(null)}
        onEdit={(task) => onOpenTaskModal(task)}
        onStatusChange={(id, status) => onStatusChange('tasks', id, status)}
      />
    )
  }

  if (active === 'Rewards') {
    return (
      <RewardsPage
        dashboard={dashboard}
        loading={loading}
        onCreate={() => onOpenRewardModal(null)}
        onEdit={(reward) => onOpenRewardModal(reward)}
        onDelete={onDeleteReward}
        onDecide={onDecide}
      />
    )
  }

  if (active === 'Analytics') {
    return <AnalyticsPage dashboard={dashboard} loading={loading} onSelectEmployee={onSelectEmployee} />
  }

  if (active === 'Leave management') {
    return (
      <div className="page module-page">
        <section className="page-heading">
          <div>
            <p className="eyebrow">TIME OFF & ABSENCE</p>
            <h1>Leave management</h1>
            <p className="subheading">Track requests, verify calculated chargeable days, and maintain balances.</p>
          </div>
          <div className="page-actions">
            <button className="secondary-button" onClick={() => onOpenBalanceModal(null)}>
              ⚖ Balances
            </button>
            <button className="primary-button" onClick={() => onCreateRecord('leave_requests')}>
              ＋ Request leave
            </button>
          </div>
        </section>

        <section className="module-stat-grid">
          <article className="module-stat">
            <span>All requests</span>
            <b>{dashboard.leaveRequests.length}</b>
          </article>
          <article className="module-stat">
            <span>Pending</span>
            <b>{dashboard.leaveRequests.filter((x) => x.status === 'pending').length}</b>
          </article>
          <article className="module-stat">
            <span>Approved</span>
            <b>{dashboard.leaveRequests.filter((x) => x.status === 'approved').length}</b>
          </article>
        </section>

        <div className="view-toggle">
          <button className={leaveTab === 'requests' ? 'active' : ''} onClick={() => setLeaveTab('requests')}>
            Requests ({dashboard.leaveRequests.length})
          </button>
          <button className={leaveTab === 'balances' ? 'active' : ''} onClick={() => setLeaveTab('balances')}>
            Employee Balances ({dashboard.employees.length})
          </button>
        </div>

        {leaveTab === 'requests' ? (
          <section className="panel data-panel">
            <DataTable
              columns={['Employee', 'Leave type', 'Duration', 'Dates', 'Status']}
              rows={dashboard.leaveRequests.map((row) => [
                row.full_name,
                row.leave_type,
                `${row.chargeable_days ?? '—'} day(s)`,
                `${formatDate(row.start_date)} – ${formatDate(row.end_date)}`,
                row.status,
              ])}
              emptyText="No leave records match."
            />
          </section>
        ) : (
          <section className="panel data-panel">
            <div style={{ overflowX: 'auto' }}>
              <table className="profile-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Annual Paid Leave</th>
                    <th>Casual Leave</th>
                    <th>Sick Leave</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.employees.map((emp) => {
                    const annual = dashboard.leaveBalances.find((b) => b.employee_id === emp.id && b.leave_type === 'annual')
                    const casual = dashboard.leaveBalances.find((b) => b.employee_id === emp.id && b.leave_type === 'casual')
                    const sick = dashboard.leaveBalances.find((b) => b.employee_id === emp.id && b.leave_type === 'sick')
                    return (
                      <tr key={emp.id}>
                        <td>
                          <strong>{emp.full_name}</strong>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>{emp.employee_code}</div>
                        </td>
                        <td>{annual ? `${annual.balance_days ?? 0} days remaining` : 'Not set'}</td>
                        <td>{casual ? `${casual.balance_days ?? 0} days remaining` : 'Not set'}</td>
                        <td>{sick ? `${sick.balance_days ?? 0} days remaining` : 'Not set'}</td>
                        <td>
                          <button
                            className="secondary-button"
                            style={{ padding: '3px 8px', fontSize: '11px' }}
                            onClick={() => onOpenBalanceModal(emp)}
                          >
                            Edit Quotas
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <ModuleExtras
        active={active}
        dashboard={dashboard}
        onSelectEmployee={onSelectEmployee}
        onDecide={onDecide}
        onOpenEmployeeModal={onOpenEmployeeModal}
      />
      </div>
    )
  }

  if (active === 'Attendance') {
    const filteredAttendance = dashboard.attendance.filter((row) => {
      if (attEmp !== 'all' && row.employee_id !== attEmp) return false
      if (attSearch.trim()) {
        const q = attSearch.toLowerCase()
        const matchName = String(row.full_name || '').toLowerCase().includes(q)
        const emp = dashboard.employees.find((e) => e.id === row.employee_id)
        const matchCode = String(emp?.employee_code || '').toLowerCase().includes(q)
        if (!matchName && !matchCode) return false
      }
      if (attFrom && attTo && attFrom > attTo) return false
      const rowDate = String(row.attendance_date || '').slice(0, 10)
      if (attFrom && rowDate < attFrom) return false
      if (attTo && rowDate > attTo) return false
      if (attMode !== 'all' && row.work_mode !== attMode) return false
      if (attStatus !== 'all' && row.attendance_status !== attStatus) return false
      return true
    })

    return (
      <div className="page module-page">
        <section className="page-heading">
          <div>
            <p className="eyebrow">TIME & ATTENDANCE</p>
            <h1>Attendance</h1>
            <p className="subheading">Track daily check-ins, remote presence, and total working hours.</p>
          </div>
          <div className="page-actions">
            <button className="secondary-button" onClick={onQuickAttendance}>
              ⚡ Quick Check-in / Out
            </button>
            <button className="primary-button" onClick={() => onCreateRecord('attendance_records')}>
              ＋ Add Attendance
            </button>
          </div>
        </section>

        <section className="module-stat-grid">
          <article className="module-stat">
            <span>Total records</span>
            <b>{dashboard.attendance.length}</b>
          </article>
          <article className="module-stat">
            <span>Present today</span>
            <b>{dashboard.attendance.filter((x) => x.attendance_status === 'present').length}</b>
          </article>
          <article className="module-stat">
            <span>Remote</span>
            <b>{dashboard.attendance.filter((x) => x.work_mode === 'remote').length}</b>
          </article>
        </section>

        <section className="panel data-panel">
          <div className="filter-bar">
            <input
              type="text"
              placeholder="Search by employee name or code…"
              value={attSearch}
              onChange={(e) => setAttSearch(e.target.value)}
              style={{ minWidth: '220px' }}
            />
            <select aria-label="Filter by employee" value={attEmp} onChange={(e) => setAttEmp(e.target.value)}>
              <option value="all">All Employees</option>
              {dashboard.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
            <select value={attMode} onChange={(e) => setAttMode(e.target.value)}>
              <option value="all">All Modes</option>
              <option value="office">Office</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
            </select>
            <select value={attStatus} onChange={(e) => setAttStatus(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="half_day">Half Day</option>
              <option value="absent">Absent</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#64748b' }}>
              From:
              <input type="date" value={attFrom} onChange={(e) => setAttFrom(e.target.value)} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#64748b' }}>
              To:
              <input type="date" value={attTo} onChange={(e) => setAttTo(e.target.value)} />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10)
                setAttFrom(today)
                setAttTo(today)
              }}
            >
              Today
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setAttFrom('')
                setAttTo('')
                setAttEmp('all')
                setAttMode('all')
                setAttStatus('all')
                setAttSearch('')
              }}
            >
              Clear
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Work Mode</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttendance.map((row) => {
                  const checkInStr = row.check_in
                    ? new Date(row.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                    : '—'
                  const checkOutStr = row.check_out
                    ? new Date(row.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                    : '—'
                  let durStr = '—'
                  if (row.total_work_minutes) {
                    durStr = `${Math.floor(row.total_work_minutes / 60)}h ${row.total_work_minutes % 60}m`
                  } else if (row.check_in && row.check_out) {
                    const diffMins = Math.round((new Date(row.check_out) - new Date(row.check_in)) / (1000 * 60))
                    if (diffMins > 0) durStr = `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`
                  }
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.full_name}</strong>
                      </td>
                      <td>{formatDate(row.attendance_date)}</td>
                      <td>{checkInStr}</td>
                      <td>{checkOutStr}</td>
                      <td>{durStr}</td>
                      <td>
                        <span className={`status-badge ${row.attendance_status === 'present' ? 'active' : 'exited'}`}>
                          {row.attendance_status}
                        </span>
                      </td>
                      <td>{row.work_mode}</td>
                      <td>
                        {!row.check_out && row.check_in && onRecordLogout && (
                          <button
                            className="secondary-button"
                            style={{ padding: '3px 8px', fontSize: '11px' }}
                            onClick={() => onRecordLogout(row)}
                          >
                            Logout
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <ModuleExtras
        active={active}
        dashboard={dashboard}
        onSelectEmployee={onSelectEmployee}
        onDecide={onDecide}
        onOpenEmployeeModal={onOpenEmployeeModal}
      />
      </div>
    )
  }

  // Employee details page
  return (
    <div className="page module-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">PEOPLE & PROFILES</p>
          <h1>Employee details</h1>
          <p className="subheading">Directory, employment details, and individual staff profiles.</p>
        </div>
        <div className="page-actions">
          <button className="primary-button" onClick={onOpenEmployeeModal}>
            ＋ Add employee
          </button>
        </div>
      </section>

      <section className="module-stat-grid">
        <article className="module-stat">
          <span>Total employees</span>
          <b>{dashboard.employees.length}</b>
        </article>
        <article className="module-stat">
          <span>Active</span>
          <b>{dashboard.summary.total_employees}</b>
        </article>
        <article className="module-stat">
          <span>On leave</span>
          <b>{dashboard.summary.on_leave}</b>
        </article>
      </section>

      <section className="panel data-panel">
        <DataTable
          columns={['Employee', 'Email', 'Department', 'Designation', 'Status']}
          rows={dashboard.employees.map((row) => [
            row.full_name,
            row.email,
            row.department || '—',
            row.designation || '—',
            row.status,
          ])}
          emptyText="No employees found."
        />
      </section>

      <ModuleExtras
        active={active}
        dashboard={dashboard}
        onSelectEmployee={onSelectEmployee}
        onDecide={onDecide}
        onOpenEmployeeModal={onOpenEmployeeModal}
      />
    </div>
  )
}

function DataTable({ columns, rows, emptyText }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(0)
  const [ascending, setAscending] = useState(true)
  const [page, setPage] = useState(0)

  const filtered = rows
    .filter((row) => row.join(' ').toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => String(a[sort] || '').localeCompare(String(b[sort] || '')) * (ascending ? 1 : -1))

  const pageRows = filtered.slice(page * 10, page * 10 + 10)
  const pages = Math.max(1, Math.ceil(filtered.length / 10))

  const exportCsv = () => {
    const csv = [columns, ...filtered].map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'workly-export.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!rows.length) return <Empty text={emptyText} />

  return (
    <>
      <div className="table-tools">
        <input aria-label="Search records" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Search records" />
        <button className="secondary-button" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column}>
                <button className="sort-button" onClick={() => { setAscending(index === sort ? !ascending : true); setSort(index) }}>
                  {column}
                  {sort === index ? (ascending ? ' ↑' : ' ↓') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{String(cell ?? '—').replaceAll('_', ' ')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-pagination">
        <span>
          {filtered.length} result{filtered.length === 1 ? '' : 's'}
        </span>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page + 1} of {pages}
        </span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </>
  )
}

function ModuleExtras({ active, dashboard, onSelectEmployee, onDecide, onOpenEmployeeModal }) {
  if (active === 'Employee details') {
    return (
      <section className="extra-grid">
        <section className="panel extra-panel">
          <div className="panel-heading">
            <div>
              <h2>Employee profiles</h2>
              <p>Select an employee to view personal, employment, leave, attendance, project and document records.</p>
            </div>
          </div>
          <div className="profile-list">
            {dashboard.employees.map((employee) => (
              <div key={employee.id} style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                <button style={{ flex: 1 }} onClick={() => onSelectEmployee(employee)}>
                  <span className="avatar">{employee.full_name.slice(0, 2).toUpperCase()}</span>
                  <span>
                    <b>{employee.full_name}</b>
                    <small>
                      {employee.employee_code} · {employee.department || 'No department'}
                    </small>
                  </span>
                  <i>View →</i>
                </button>
                {onOpenEmployeeModal && (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: '0 12px', whiteSpace: 'nowrap' }}
                    onClick={() => onOpenEmployeeModal(employee)}
                    title="Edit employee"
                  >
                    ✎ Edit
                  </button>
                )}
              </div>
            )) || <Empty text="Employee profiles will appear here." />}
          </div>
        </section>
        <section className="panel extra-panel">
          <div className="panel-heading">
            <div>
              <h2>Document expiry alerts</h2>
              <p>Documents due within 30 days or already expired.</p>
            </div>
          </div>
          <ExpiryList documents={dashboard.documents} employees={dashboard.employees} />
        </section>
      </section>
    )
  }

  if (active === 'Leave management') {
    return (
      <section className="panel extra-panel">
        <div className="panel-heading">
          <div>
            <h2>Approval queue</h2>
            <p>Confirm manually calculated chargeable days before approving.</p>
          </div>
        </div>
        <div className="workflow-list">
          {dashboard.leaveRequests.filter((row) => row.status === 'pending').map((row) => (
            <div key={row.id}>
              <span>
                <b>{row.full_name}</b>
                <small>
                  {row.leave_type} · {formatDate(row.start_date)} – {formatDate(row.end_date)}
                </small>
              </span>
              <button className="secondary-button" onClick={() => onDecide({ kind: 'leave', record: row, outcome: 'rejected' })}>
                Reject
              </button>
              <button className="primary-button" onClick={() => onDecide({ kind: 'leave', record: row, outcome: 'approved' })}>
                Review
              </button>
            </div>
          )) || <Empty text="No leave decisions are waiting." />}
        </div>
      </section>
    )
  }

  if (active === 'Attendance') {
    return (
      <section className="panel extra-panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance corrections</h2>
            <p>Original records remain preserved in the audit history.</p>
          </div>
        </div>
        <div className="workflow-list">
          {dashboard.corrections.filter((row) => row.status === 'pending').map((row) => (
            <div key={row.id}>
              <span>
                <b>Correction request</b>
                <small>{row.reason}</small>
              </span>
              <button className="secondary-button" onClick={() => onDecide({ kind: 'correction', record: row, outcome: 'rejected' })}>
                Reject
              </button>
              <button className="primary-button" onClick={() => onDecide({ kind: 'correction', record: row, outcome: 'approved' })}>
                Review
              </button>
            </div>
          )) || <Empty text="No attendance corrections are waiting." />}
        </div>
      </section>
    )
  }

  return null
}

function ExpiryList({ documents, employees }) {
  const today = new Date()
  const deadline = new Date()
  deadline.setDate(today.getDate() + 30)
  const alerts = documents.filter((document) => document.expiry_date && new Date(document.expiry_date) <= deadline)
  if (!alerts.length) return <Empty text="No document expiry alerts yet." />
  return (
    <div className="audit-list">
      {alerts.map((document) => (
        <p key={document.id}>
          <b>{document.document_name}</b>
          <span>
            {employees.find((employee) => employee.id === document.employee_id)?.full_name || 'Employee'} · Expires {formatDate(document.expiry_date)}
          </span>
        </p>
      ))}
    </div>
  )
}

function EmployeeProfile({ employee, dashboard, onClose, onEdit }) {
  const [tab, setTab] = useState('Personal')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const emergencyName = typeof employee.emergency_contact === 'string'
    ? employee.emergency_contact
    : (employee.emergency_contact?.name || employee.emergency_contact?.contact || employee.emergency_contact?.phone || '')

  const related = {
    Personal: [
      ['Email', employee.email || '—'],
      ['Phone', employee.phone || '—'],
      ['Address', employee.address || '—'],
      ['Emergency contact', emergencyName || '—'],
      ['Date of birth', formatDate(employee.date_of_birth)],
    ],
    Employment: [
      ['Employee ID', employee.employee_code],
      ['Department', employee.department],
      ['Designation', employee.designation],
      ['Joining date', formatDate(employee.joined_on)],
      ['Employment type', employee.employment_type],
      ['Status', employee.status],
      ['Skills', employee.skills],
      ['Qualifications', employee.qualifications],
      ['Account status', employee.account_status],
    ],
    Documents: dashboard.documents.filter((item) => item.employee_id === employee.id).map((item) => [item.document_name, item.document_type, formatDate(item.expiry_date)]),
    Attendance: dashboard.attendance.filter((item) => item.employee_id === employee.id).map((item) => [formatDate(item.attendance_date), item.attendance_status, item.work_mode]),
    Leave: dashboard.leaveRequests.filter((item) => item.employee_id === employee.id).map((item) => [item.leave_type, item.status, `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`]),
    Projects: dashboard.projects.filter((project) => project.manager_id === employee.id || project.team_lead_id === employee.id).map((item) => [item.project_code, item.name, item.status]),
    Performance: dashboard.tasks.filter((task) => task.assignee_id === employee.id).map((item) => [item.title, item.status, formatDate(item.due_date)]),
  }

  const rows = related[tab]

  const invite = async () => {
    setBusy(true)
    try {
      await inviteEmployee(employee.id, window.location.origin)
      setMessage('Invitation sent. The activation link is handled securely by Supabase Auth.')
    } catch (error) {
      setMessage(error.message || 'Could not send the invitation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        <div className="profile-header">
          <span className="avatar">{employee.full_name.slice(0, 2).toUpperCase()}</span>
          <div>
            <p className="eyebrow">EMPLOYEE PROFILE</p>
            <h2>{employee.full_name}</h2>
            <small>
              {employee.employee_code} · {employee.designation || 'Employee'}
            </small>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {onEdit && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onEdit(employee)}
              >
                ✎ Edit Employee
              </button>
            )}
            <button className="secondary-button profile-invite" disabled={busy || employee.status === 'exited'} onClick={invite}>
              {busy ? 'Sending…' : 'Send / resend invite'}
            </button>
          </div>
        </div>
        {message && <p className="form-message">{message}</p>}
        <div className="profile-tabs">
          {Object.keys(related).map((name) => (
            <button className={tab === name ? 'selected' : ''} onClick={() => setTab(name)} key={name}>
              {name}
            </button>
          ))}
        </div>
        {rows.length ? (
          <table className="profile-table">
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{String(cell || '—')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text={`No ${tab.toLowerCase()} records for this employee.`} />
        )}
      </section>
    </div>
  )
}

function NotificationsModal({ notifications, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="profile-modal notification-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        <p className="eyebrow">ADMIN ALERTS</p>
        <h2>Notifications</h2>
        {notifications.length ? (
          <div className="audit-list">
            {notifications.map((item) => (
              <p key={item.id}>
                <b>{item.title}</b>
                <span>
                  {item.body} · {formatDate(item.created_at)}
                </span>
              </p>
            ))}
          </div>
        ) : (
          <Empty text="No in-app notifications yet. Notification rules can be configured in the cloud data model." />
        )}
      </section>
    </div>
  )
}

function HelpModal({ onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="profile-modal help-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        <p className="eyebrow">WORKLY SUPPORT</p>
        <h2>Help centre</h2>
        <div className="help-list">
          <article>
            <b>Getting started</b>
            <p>Create employees first, then create projects, tasks, leave requests, attendance records, and calendar events.</p>
          </article>
          <article>
            <b>Approvals</b>
            <p>Use Leave management and Attendance to review requests. Confirm chargeable leave days before approving leave.</p>
          </article>
          <article>
            <b>Find a record</b>
            <p>Use the top search field to find employees, projects, tasks, leave records, or calendar events from live cloud data.</p>
          </article>
          <article>
            <b>Cloud connection problem</b>
            <p>Use Try again in the message banner. Confirm the Vite app has the Supabase URL and publishable key configured in its local `.env` file.</p>
          </article>
          <article>
            <b>Account access</b>
            <p>Administrator access is invitation-only. Use Forgot password on the sign-in screen if needed.</p>
          </article>
        </div>
      </section>
    </div>
  )
}

function DecisionModal({ decision, onClose, onSaved }) {
  const [days, setDays] = useState(decision.record.chargeable_days ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      if (decision.kind === 'leave') {
        await decideLeave(decision.record.id, decision.outcome, Number(days), reason)
        onSaved({ type: 'success', message: `Leave request ${decision.outcome}.` })
      } else if (decision.kind === 'correction') {
        await decideAttendanceCorrection(decision.record.id, decision.outcome, reason)
        onSaved({ type: 'success', message: `Attendance correction ${decision.outcome}.` })
      } else {
        await saveRecord('rewards', { status: decision.outcome, decision_reason: reason }, decision.record.id)
        onSaved({ type: 'success', message: `Reward nomination ${decision.outcome}.` })
      }
    } catch (error) {
      setMessage(error.message || 'Could not save this decision.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner review">
          <span>✓</span>
          <div>
            <p>ADMIN DECISION</p>
            <h2>{decision.outcome === 'approved' ? 'Approve request' : 'Reject request'}</h2>
          </div>
        </div>
        <div className="form-fields">
          {decision.kind === 'leave' && (
            <label>
              Chargeable leave days
              <input required min="0" step="0.5" type="number" value={days} onChange={(event) => setDays(event.target.value)} />
            </label>
          )}
          <label>
            Decision note
            <textarea required value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {message && <p className="form-message">{message}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Confirm decision'}
          </button>
        </div>
      </form>
    </div>
  )
}

function AuthScreen({ configurationRequired = false }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const handleSignIn = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMessage(error.message)
    } catch (err) {
      setMessage(err.message || 'Sign in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSignIn}>
        <div className="brand">
          <span className="brand-mark">w</span>
          <span>workly</span>
        </div>
        <h1>HR Admin Dashboard</h1>
        {configurationRequired ? (
          <p className="form-message">Connect Supabase by setting your environment variables.</p>
        ) : (
          <>
            <label>
              Email address
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@workly.internal" />
            </label>
            <label>
              Password
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </label>
            {message && <p className="form-message">{message}</p>}
            <button className="primary-button" disabled={submitting}>
              {submitting ? 'Authenticating…' : 'Sign in'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}

function Schedule({ events, loading, onEventClick }) {
  if (loading) return <Empty text="Loading events." />
  if (!events.length) return <Empty text="No upcoming events." />
  return (
    <div className="schedule-list">
      {events.slice(0, 5).map((event) => (
        <button key={event.id} onClick={() => onEventClick(event)} className={`schedule-item ${event.event_type}`}>
          <strong>{event.title}</strong>
          <small>{new Date(event.starts_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
        </button>
      ))}
    </div>
  )
}

function LeaveRows({ rows, loading }) {
  if (loading) return <Empty text="Loading leave requests." />
  if (!rows.length) return <Empty text="No pending leave requests." />
  return (
    <div className="leave-list">
      {rows.slice(0, 5).map((row) => (
        <div key={row.id} className="leave-row">
          <strong>{row.full_name}</strong>
          <span>
            {row.leave_type} · {formatDate(row.start_date)} – {formatDate(row.end_date)}
          </span>
        </div>
      ))}
    </div>
  )
}

function RecordModal({ type, dashboard, onClose, onSaved }) {
  const definitions = {
    projects: {
      title: 'Create project',
      fields: [
        ['project_code', 'Project code', 'text'],
        ['name', 'Project title', 'text'],
        ['description', 'Description', 'textarea'],
        ['status', 'Status', 'select:upcoming|in_progress|completed|cancelled'],
        ['due_date', 'Due date', 'date'],
      ],
    },
    leave_requests: {
      title: 'Request time off',
      fields: [
        ['employee_id', 'Employee', 'employee'],
        ['leave_type', 'Leave type', 'select:annual|sick|casual|unpaid'],
        ['start_date', 'Start date', 'date'],
        ['end_date', 'End date', 'date'],
        ['reason', 'Reason', 'textarea'],
      ],
    },
    attendance_records: {
      title: 'Log attendance',
      fields: [
        ['employee_id', 'Employee', 'employee'],
        ['attendance_date', 'Date', 'date'],
        ['check_in', 'Check in time', 'time'],
        ['check_out', 'Check out time', 'time'],
        ['work_mode', 'Work mode', 'select:office|remote|hybrid'],
        ['attendance_status', 'Status', 'select:present|late|half_day|absent'],
      ],
    },
    rewards: {
      title: 'Nominate employee',
      fields: [
        ['employee_id', 'Employee', 'employee'],
        ['reason', 'Recognition reason', 'textarea'],
        ['nominated_at', 'Nomination date', 'date'],
        ['status', 'Status', 'select:pending|approved|rejected'],
      ],
    },
  }

  const definition = definitions[type]
  if (!definition) return null

  const [form, setForm] = useState({
    status: type === 'projects' ? 'upcoming' : 'pending',
    risk_level: 'normal',
    progress: '0',
    work_mode: 'office',
    attendance_status: 'present',
    nominated_at: new Date().toISOString().slice(0, 10),
    attendance_date: new Date().toISOString().slice(0, 10),
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const values = { ...form }
      let existingId = undefined
      if (type === 'attendance_records') {
        if (values.check_in) values.check_in = `${values.attendance_date}T${values.check_in}:00`
        if (values.check_out) values.check_out = `${values.attendance_date}T${values.check_out}:00`
        if (type === 'attendance_records' && values.check_in && values.check_out) {
          if (new Date(values.check_out).getTime() <= new Date(values.check_in).getTime()) {
            throw new Error('Check-out time must be later than check-in time.')
          }
        }
        if (type === 'attendance_records' && values.employee_id && values.attendance_date) {
          const matched = dashboard.attendance?.find(
            (rec) => rec.employee_id === values.employee_id && String(rec.attendance_date).slice(0, 10) === String(values.attendance_date).slice(0, 10)
          )
          if (matched) existingId = matched.id
        }
      }
      await saveRecord(type, values, existingId)
      onSaved()
    } catch (error) {
      setMessage(error.message || 'Could not save record.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form record-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner meeting">
          <span>＋</span>
          <div>
            <p>DATA ENTRY</p>
            <h2>{definition.title}</h2>
          </div>
        </div>
        <div className="form-fields">
          {definition.fields.map(([name, label, fieldType]) => (
            <label key={name}>
              {label}
              {fieldType === 'textarea' ? (
                <textarea required value={form[name] || ''} onChange={(e) => setForm({ ...form, [name]: e.target.value })} />
              ) : fieldType === 'employee' ? (
                <select required value={form[name] || ''} onChange={(e) => setForm({ ...form, [name]: e.target.value })}>
                  <option value="">Select an employee</option>
                  {dashboard.employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
              ) : fieldType.startsWith('select:') ? (
                <select value={form[name] || ''} onChange={(e) => setForm({ ...form, [name]: e.target.value })}>
                  {fieldType
                    .replace('select:', '')
                    .split('|')
                    .map((opt) => (
                      <option key={opt} value={opt}>
                        {opt.replace('_', ' ')}
                      </option>
                    ))}
                </select>
              ) : (
                <input required type={fieldType} value={form[name] || ''} onChange={(e) => setForm({ ...form, [name]: e.target.value })} />
              )}
            </label>
          ))}
          {message && <p className="form-message">{message}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? 'Saving…' : 'Create record'}
          </button>
        </div>
      </form>
    </div>
  )
}

function EventModal({ event, project, onClose, onOpenProject }) {
  const date = new Date(event.starts_at)
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="event-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        <div className={`event-banner ${event.event_type}`}>
          <span>{event.event_type === 'milestone' ? '◆' : event.event_type === 'review' ? '◌' : '◷'}</span>
          <div>
            <p>PROJECT EVENT</p>
            <h2>{event.title}</h2>
          </div>
        </div>
        <div className="event-details">
          <div>
            <span>◷</span>
            <p>
              <b>{date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</b>
              <small>
                {event.ends_at ? `Ends ${new Date(event.ends_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'No end time set'}
              </small>
            </p>
          </div>
          <div>
            <span>⌁</span>
            <p>
              <b>About this event</b>
              <small>{event.description || 'No description provided.'}</small>
            </p>
          </div>
        </div>
        <div className="linked-project">
          <div className="project-emblem blue">▣</div>
          <div>
            <p>LINKED PROJECT</p>
            <strong>{event.project_name}</strong>
            <small>
              {event.project_code} · Due {formatDate(event.due_date)}
            </small>
          </div>
          {project && (
            <button className="project-link" onClick={() => onOpenProject(project.id)}>
              Open project <span>→</span>
            </button>
          )}
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
          {project && (
            <button className="primary-button" onClick={() => onOpenProject(project.id)}>
              View project details <span>→</span>
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function CalendarModal({ events, onClose, onEventClick }) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const days = new Date(year, month + 1, 0).getDate()
  const starts = (new Date(year, month, 1).getDay() + 6) % 7
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="calendar-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="calendar-top">
          <div>
            <p className="eyebrow">PROJECT SCHEDULE</p>
            <h2>{now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h2>
          </div>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="week-labels">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {Array.from({ length: starts }, (_, index) => (
            <div className="calendar-day muted" key={`blank-${index}`} />
          ))}
          {Array.from({ length: days }, (_, index) => {
            const day = index + 1
            const dayEvents = events.filter((event) => {
              const eventDate = new Date(event.starts_at)
              return eventDate.getFullYear() === year && eventDate.getMonth() === month && eventDate.getDate() === day
            })
            return (
              <div className={`calendar-day ${day === now.getDate() ? 'today' : ''}`} key={day}>
                <b>{day}</b>
                {dayEvents.map((event) => (
                  <button key={event.id} onClick={() => onEventClick(event)} className={`calendar-event ${event.event_type}`}>
                    {new Date(event.starts_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} {event.title}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
        <p className="calendar-note">Events come from your PostgreSQL database. Select one to view details.</p>
      </section>
    </div>
  )
}

function CreateEventModal({ projects, onClose, onCreated }) {
  const [form, setForm] = useState({ projectId: '', title: '', description: '', eventType: 'meeting', startsAt: '' })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      await createEvent(form)
      onCreated()
    } catch (error) {
      setMessage(error.message || 'Could not create event.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner meeting">
          <span>＋</span>
          <div>
            <p>PROJECT SCHEDULE</p>
            <h2>Create an event</h2>
          </div>
        </div>
        <div className="form-fields">
          <label>
            Event title
            <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            Linked project
            <select required value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
              <option value="">Select a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.project_code} — {project.name}
                </option>
              ))}
            </select>
          </label>
          {!projects.length && <p className="form-message">Create a project first; events must be linked to a project.</p>}
          <div className="form-row">
            <label>
              Event type
              <select value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })}>
                <option value="meeting">Meeting</option>
                <option value="review">Review</option>
                <option value="milestone">Milestone</option>
              </select>
            </label>
            <label>
              Starts at
              <input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
            </label>
          </div>
          <label>
            Description
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          {message && <p className="form-message">{message}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={!projects.length || submitting} className="primary-button">
            {submitting ? 'Saving…' : 'Create event'}
          </button>
        </div>
      </form>
    </div>
  )
}

function QuickAttendanceModal({ dashboard, onClose, onSaved }) {
  const [employeeId, setEmployeeId] = useState(dashboard.employees[0]?.id || '')
  const [attendanceDate, setAttendanceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [entryType, setEntryType] = useState('both')
  const [checkInTime, setCheckInTime] = useState(() => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [checkOutTime, setCheckOutTime] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 8)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [workMode, setWorkMode] = useState('office')
  const [status, setStatus] = useState('present')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!employeeId) {
      setMessage('Please select an employee.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const existing = dashboard.attendance?.find(
        (a) => a.employee_id === employeeId && String(a.attendance_date).slice(0, 10) === attendanceDate
      )

      let inIso = null
      let outIso = null

      if (entryType === 'both' || entryType === 'login_only') {
        if (checkInTime) inIso = `${attendanceDate}T${checkInTime}:00`
      } else if (existing?.check_in) {
        inIso = existing.check_in
      }

      if (entryType === 'both' || entryType === 'logout_only') {
        if (checkOutTime) outIso = `${attendanceDate}T${checkOutTime}:00`
      } else if (existing?.check_out) {
        outIso = existing.check_out
      }

      if (inIso && outIso && new Date(outIso).getTime() <= new Date(inIso).getTime()) {
        setMessage('Check-out time must be later than check-in time.')
        setBusy(false)
        return
      }

      let totalWorkMinutes = null
      if (inIso && outIso) {
        const diffMs = new Date(outIso).getTime() - new Date(inIso).getTime()
        if (diffMs > 0) totalWorkMinutes = Math.round(diffMs / (1000 * 60))
      }

      const values = {
        employee_id: employeeId,
        attendance_date: attendanceDate,
        work_mode: workMode,
        attendance_status: status,
        check_in: inIso,
        check_out: outIso,
        ...(totalWorkMinutes !== null ? { total_work_minutes: totalWorkMinutes } : {}),
      }

      await saveRecord('attendance_records', values, existing?.id)
      onSaved()
    } catch (err) {
      setMessage(err.message || 'Could not save attendance.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form record-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner meeting">
          <span>⚡</span>
          <div>
            <p>QUICK RECORD</p>
            <h2>Quick Attendance Check-In / Out</h2>
          </div>
        </div>
        <div className="form-fields">
          <label style={{ gridColumn: '1 / -1' }}>
            Employee *
            <select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select an employee</option>
              {dashboard.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Attendance Date *
            <input required type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
          </label>
          <label>
            Entry Type
            <select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
              <option value="both">Both (Login & Logout)</option>
              <option value="login_only">Login Only</option>
              <option value="logout_only">Logout Only</option>
            </select>
          </label>
          <label>
            Check-in Time
            <input
              type="time"
              disabled={entryType === 'logout_only'}
              value={checkInTime}
              onChange={(e) => setCheckInTime(e.target.value)}
            />
          </label>
          <label>
            Check-out Time
            <input
              type="time"
              disabled={entryType === 'login_only'}
              value={checkOutTime}
              onChange={(e) => setCheckOutTime(e.target.value)}
            />
          </label>
          <label>
            Work Mode
            <select value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
              <option value="office">Office</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label>
            Attendance Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="half_day">Half Day</option>
              <option value="absent">Absent</option>
            </select>
          </label>
          {message && <p className="form-message" style={{ gridColumn: '1 / -1' }}>{message}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? 'Saving…' : 'Record Attendance'}
          </button>
        </div>
      </form>
    </div>
  )
}

function EmployeeModal({ employee = null, dashboard, onClose, onSaved }) {
  const isEdit = Boolean(employee?.id)
  const [form, setForm] = useState({
    employee_code: employee?.employee_code || `EMP-${Math.floor(100 + Math.random() * 900)}`,
    full_name: employee?.full_name || '',
    email: employee?.email || '',
    department: employee?.department || 'Engineering',
    designation: employee?.designation || 'Software Engineer',
    status: employee?.status || 'active',
    joined_on: employee?.joined_on ? String(employee.joined_on).slice(0, 10) : new Date().toISOString().slice(0, 10),
    phone: employee?.phone || '',
    address: employee?.address || '',
    emergency_contact: typeof employee?.emergency_contact === 'string'
      ? employee.emergency_contact
      : (employee?.emergency_contact?.name || employee?.emergency_contact?.phone || employee?.emergency_contact?.contact || ''),
    date_of_birth: employee?.date_of_birth ? String(employee.date_of_birth).slice(0, 10) : '',
  })
  const [stagedDocs, setStagedDocs] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const updatePendingDoc = (id, field, val) => {
    setStagedDocs((prev) => prev.map((doc) => (doc.id === id ? { ...doc, [field]: val } : doc)))
  }

  const removePendingDoc = (id) => {
    setStagedDocs((prev) => prev.filter((doc) => doc.id !== id))
  }

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || [])
    const newDocs = files.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
      file,
      name: file.name,
      documentName: file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '),
      documentType: 'other',
      expiryDate: '',
    }))
    setStagedDocs((prev) => [...prev, ...newDocs])
    e.target.value = ''
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const payload = {
        ...form,
        date_of_birth: form.date_of_birth ? form.date_of_birth : null,
        joined_on: form.joined_on ? form.joined_on : null,
        phone: form.phone ? form.phone.trim() : null,
        address: form.address ? form.address.trim() : null,
        emergency_contact: form.emergency_contact ? { name: form.emergency_contact.trim() } : null,
      }
      const res = await saveRecord('employees', payload, employee?.id)
      const savedEmployee = res.data || (dashboard.employees.find((emp) => emp.employee_code === form.employee_code) || { id: employee?.id || form.employee_code })
      const targetId = savedEmployee.id
      if (stagedDocs.length > 0 && targetId) {
        for (const doc of stagedDocs) {
          await uploadEmployeeDocument(targetId, doc.file, doc.documentType, doc.documentName, doc.expiryDate || null)
        }
      }
      onSaved()
    } catch (err) {
      setMessage(err.message || 'Could not save employee.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form record-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner meeting">
          <span>♙</span>
          <div>
            <p>PEOPLE & PROFILES</p>
            <h2>{isEdit ? 'Edit Employee' : 'Add New Employee'}</h2>
          </div>
        </div>
        <div className="form-fields">
          <label>
            Employee Code *
            <input required value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
          </label>
          <label>
            Full Name *
            <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Email Address *
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Phone Number
            <input type="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label>
            Department
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </label>
          <label>
            Designation
            <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="on_leave">On Leave</option>
              <option value="exited">Exited</option>
            </select>
          </label>
          <label>
            Joining Date
            <input type="date" value={form.joined_on} onChange={(e) => setForm({ ...form, joined_on: e.target.value })} />
          </label>
          <label>
            Date of Birth
            <input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
          </label>
          <label>
            Emergency Contact
            <input placeholder="Contact name or phone" value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Address
            <input placeholder="Residential address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>

          <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}>Employee Documents</label>
            <input
              id="employee-doc-upload-input"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => document.getElementById('employee-doc-upload-input')?.click()}
            >
              📎 Select Documents (.pdf,.jpg,.jpeg,.png)
            </button>
          </div>

          {stagedDocs.length > 0 && (
            <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>Staged Documents ({stagedDocs.length})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {stagedDocs.map((doc) => (
                  <div key={doc.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#f8fafc', padding: '6px 8px', borderRadius: '6px' }}>
                    <input
                      style={{ flex: 2 }}
                      placeholder="Document name"
                      value={doc.documentName}
                      onChange={(e) => updatePendingDoc(doc.id, 'documentName', e.target.value)}
                    />
                    <select
                      style={{ flex: 1 }}
                      value={doc.documentType}
                      onChange={(e) => updatePendingDoc(doc.id, 'documentType', e.target.value)}
                    >
                      <option value="resume">Resume</option>
                      <option value="id_proof">ID Proof</option>
                      <option value="certification">Certificate</option>
                      <option value="contract">Contract</option>
                      <option value="tax_form">Tax Form</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      type="date"
                      style={{ flex: 1 }}
                      value={doc.expiryDate}
                      onChange={(e) => updatePendingDoc(doc.id, 'expiryDate', e.target.value)}
                    />
                    <button
                      type="button"
                      className="danger-button"
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                      onClick={() => removePendingDoc(doc.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {message && <p className="form-message" style={{ gridColumn: '1 / -1' }}>{message}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Employee')}
          </button>
        </div>
      </form>
    </div>
  )
}

function BalanceModal({ employee, dashboard, onClose, onSaved }) {
  const [empId, setEmpId] = useState(employee?.id || dashboard.employees[0]?.id || '')
  const [annualDays, setAnnualDays] = useState('20')
  const [casualDays, setCasualDays] = useState('10')
  const [sickDays, setSickDays] = useState('12')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (empId) {
      const a = dashboard.leaveBalances.find((b) => b.employee_id === empId && b.leave_type === 'annual')
      const c = dashboard.leaveBalances.find((b) => b.employee_id === empId && b.leave_type === 'casual')
      const s = dashboard.leaveBalances.find((b) => b.employee_id === empId && b.leave_type === 'sick')
      if (a) setAnnualDays(String(a.balance_days ?? a.allocated_days ?? 20))
      if (c) setCasualDays(String(c.balance_days ?? c.allocated_days ?? 10))
      if (s) setSickDays(String(s.balance_days ?? s.allocated_days ?? 12))
    }
  }, [empId, dashboard.leaveBalances])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const quotas = [
        { leave_type: 'annual', allocated_days: Number(annualDays), balance_days: Number(annualDays), used_days: 0 },
        { leave_type: 'casual', allocated_days: Number(casualDays), balance_days: Number(casualDays), used_days: 0 },
        { leave_type: 'sick', allocated_days: Number(sickDays), balance_days: Number(sickDays), used_days: 0 },
      ]
      for (const q of quotas) {
        const existing = dashboard.leaveBalances.find((b) => b.employee_id === empId && b.leave_type === q.leave_type)
        await saveRecord('leave_balances', { employee_id: empId, ...q }, existing?.id)
      }
      onSaved()
    } catch (err) {
      setMessage(err.message || 'Could not update leave balances.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form record-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner meeting">
          <span>⚖</span>
          <div>
            <p>LEAVE ALLOCATIONS</p>
            <h2>Update Leave Quotas & Balances</h2>
          </div>
        </div>
        <div className="form-fields">
          <label style={{ gridColumn: '1 / -1' }}>
            Employee *
            <select required value={empId} onChange={(e) => setEmpId(e.target.value)}>
              {dashboard.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Annual Leave (Days)
            <input required type="number" min="0" value={annualDays} onChange={(e) => setAnnualDays(e.target.value)} />
          </label>
          <label>
            Casual Leave (Days)
            <input required type="number" min="0" value={casualDays} onChange={(e) => setCasualDays(e.target.value)} />
          </label>
          <label>
            Sick Leave (Days)
            <input required type="number" min="0" value={sickDays} onChange={(e) => setSickDays(e.target.value)} />
          </label>
          {message && <p className="form-message" style={{ gridColumn: '1 / -1' }}>{message}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? 'Saving…' : 'Save Quotas'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ProjectsPage({ projects, employees = [], loading, onBack, onCreate, onEdit, onStatusChange }) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const getStatusLabel = (status) => {
    if (status === 'in_progress' || status === 'ongoing') return 'Ongoing'
    if (status === 'upcoming') return 'Upcoming'
    if (status === 'completed') return 'Completed'
    if (status === 'cancelled') return 'Cancelled'
    return status ? status.replace('_', ' ') : 'Upcoming'
  }

  const counts = useMemo(
    () => ({
      all: projects.length,
      upcoming: projects.filter((p) => p.status === 'upcoming').length,
      ongoing: projects.filter((p) => p.status === 'in_progress' || p.status === 'ongoing').length,
      completed: projects.filter((p) => p.status === 'completed').length,
      cancelled: projects.filter((p) => p.status === 'cancelled').length,
      at_risk: projects.filter((p) => p.risk_level === 'at_risk' || p.risk_level === 'critical').length,
    }),
    [projects]
  )

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      if (statusFilter === 'at_risk') {
        if (project.risk_level !== 'at_risk' && project.risk_level !== 'critical') return false
      } else if (statusFilter === 'ongoing') {
        if (project.status !== 'in_progress' && project.status !== 'ongoing') return false
      } else if (statusFilter !== 'all' && project.status !== statusFilter) {
        return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchCode = String(project.project_code || '').toLowerCase().includes(q)
        const matchName = String(project.name || '').toLowerCase().includes(q)
        const matchMgr = String(project.manager_name || '').toLowerCase().includes(q)
        if (!matchCode && !matchName && !matchMgr) return false
      }
      return true
    })
  }, [projects, statusFilter, searchQuery])

  return (
    <div className="page projects-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">PROJECT PORTFOLIO</p>
          <h1>Project management</h1>
          <p className="subheading">Track upcoming, ongoing, completed, and cancelled projects from Supabase.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={onBack}>
            ← Overview
          </button>
          <button className="primary-button" onClick={onCreate}>
            ＋ Create project
          </button>
        </div>
      </section>

      <section className="module-stat-grid">
        <article className="module-stat">
          <span>All projects</span>
          <b>{counts.all}</b>
        </article>
        <article className="module-stat">
          <span>Upcoming</span>
          <b>{counts.upcoming}</b>
        </article>
        <article className="module-stat">
          <span>Ongoing</span>
          <b>{counts.ongoing}</b>
        </article>
        <article className="module-stat">
          <span>Completed</span>
          <b>{counts.completed}</b>
        </article>
        <article className="module-stat">
          <span>Cancelled</span>
          <b>{counts.cancelled}</b>
        </article>
      </section>

      <div className="view-toggle">
        <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>
          All ({counts.all})
        </button>
        <button className={statusFilter === 'upcoming' ? 'active' : ''} onClick={() => setStatusFilter('upcoming')}>
          Upcoming ({counts.upcoming})
        </button>
        <button className={statusFilter === 'ongoing' ? 'active' : ''} onClick={() => setStatusFilter('ongoing')}>
          Ongoing ({counts.ongoing})
        </button>
        <button className={statusFilter === 'completed' ? 'active' : ''} onClick={() => setStatusFilter('completed')}>
          Completed ({counts.completed})
        </button>
        <button className={statusFilter === 'cancelled' ? 'active' : ''} onClick={() => setStatusFilter('cancelled')}>
          Cancelled ({counts.cancelled})
        </button>
        <button className={statusFilter === 'at_risk' ? 'active' : ''} onClick={() => setStatusFilter('at_risk')}>
          At Risk ({counts.at_risk})
        </button>
      </div>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Filter by project code, title, or manager…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ minWidth: '320px' }}
        />
      </div>

      {loading ? (
        <Empty text="Loading projects…" />
      ) : !filteredProjects.length ? (
        <div className="panel no-projects">
          <Empty text="No projects match your filter. Use 'Create project' above to add one." />
        </div>
      ) : (
        <section className="project-cards">
          {filteredProjects.map((project) => {
            const isOngoing = project.status === 'in_progress' || project.status === 'ongoing'
            const currentStatusVal = isOngoing ? 'ongoing' : project.status
            return (
              <article id={`project-${project.id}`} key={project.id} className="project-card">
                <div className="project-card-top">
                  <div className="project-emblem blue">▣</div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span className={`status ${isOngoing ? 'ongoing' : project.status}`}>
                      {getStatusLabel(project.status)}
                    </span>
                    {project.risk_level && project.risk_level !== 'normal' && (
                      <span className="status risk">{project.risk_level === 'critical' ? 'Critical' : 'At Risk'}</span>
                    )}
                  </div>
                </div>
                <p className="project-id">{project.project_code}</p>
                <h2>{project.name}</h2>
                <p className="project-description">{project.description || 'No project description provided.'}</p>
                <div className="progress-label">
                  <span>Progress</span>
                  <b>{project.progress ?? 0}%</b>
                </div>
                <div className="progress">
                  <i style={{ width: `${Math.min(100, Math.max(0, project.progress ?? 0))}%` }} />
                </div>
                <div className="project-footer">
                  <p>
                    Manager <b>{project.manager_name || 'Unassigned'}</b>
                  </p>
                  <p>
                    Due <b>{formatDate(project.due_date)}</b>
                  </p>
                </div>
                <div className="project-card-actions">
                  <label style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Status:
                    <select
                      className="status-select"
                      value={currentStatusVal}
                      onChange={(e) => onStatusChange(project.id, e.target.value)}
                    >
                      <option value="upcoming">Upcoming</option>
                      <option value="ongoing">Ongoing</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    style={{ padding: '4px 10px', fontSize: '11px' }}
                    onClick={() => onEdit(project)}
                  >
                    ✎ Edit Project
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}

function ProjectModal({ project, employees, onClose, onSaved }) {
  const isEdit = Boolean(project?.id)
  const initialStatus = project?.status === 'in_progress' ? 'ongoing' : project?.status || 'upcoming'
  const [form, setForm] = useState({
    project_code: project?.project_code || `PRJ-${Math.floor(100 + Math.random() * 900)}`,
    name: project?.name || '',
    description: project?.description || '',
    manager_id: project?.manager_id || '',
    status: initialStatus,
    risk_level: project?.risk_level || 'normal',
    progress: project?.progress !== undefined && project?.progress !== null ? String(project.progress) : '0',
    start_date: project?.start_date ? String(project.start_date).slice(0, 10) : '',
    due_date: project?.due_date ? String(project.due_date).slice(0, 10) : '',
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const values = {
        project_code: form.project_code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        manager_id: form.manager_id || null,
        status: form.status === 'ongoing' ? 'in_progress' : form.status,
        risk_level: form.risk_level,
        progress: Math.min(100, Math.max(0, Number(form.progress || 0))),
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      }
      await saveRecord('projects', values, project?.id)
      onSaved()
    } catch (err) {
      setMessage(err.message || 'Could not save project.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form record-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner meeting">
          <span>▣</span>
          <div>
            <p>PROJECT PORTFOLIO</p>
            <h2>{isEdit ? `Edit Project: ${project.name}` : 'Create New Project'}</h2>
          </div>
        </div>

        <div className="form-fields">
          <label>
            Project Code *
            <input required value={form.project_code} onChange={(e) => setForm({ ...form, project_code: e.target.value })} />
          </label>
          <label>
            Project Name *
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Description
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label>
            Project Manager
            <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}>
              <option value="">Select manager</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="upcoming">Upcoming</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            Risk Level
            <select value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value })}>
              <option value="normal">Normal</option>
              <option value="at_risk">At Risk</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Progress (%)
            <input
              type="number"
              min="0"
              max="100"
              value={form.progress}
              onChange={(e) => setForm({ ...form, progress: e.target.value })}
            />
          </label>
          <label>
            Start Date
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </label>
          <label>
            Due Date
            <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </label>

          {message && <p className="form-message" style={{ gridColumn: '1 / -1' }}>{message}</p>}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? 'Saving project…' : isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  )
}

function TasksPage({ dashboard, loading, onCreate, onEdit, onStatusChange }) {
  const [timeframeTab, setTimeframeTab] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewLayout, setViewLayout] = useState('table')

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), [])

  const [selectedDay, setSelectedDay] = useState(todayStr)
  const [selectedWeekDate, setSelectedWeekDate] = useState(todayStr)
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr)

  const isOverdue = (task) => {
    if (!task.due_date || task.status === 'completed') return false
    const due = String(task.due_date).slice(0, 10)
    return due < todayStr
  }

  const weekRange = useMemo(() => {
    const base = new Date(selectedWeekDate + 'T00:00:00')
    const day = base.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const monday = new Date(base)
    monday.setDate(base.getDate() + diffToMonday)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return {
      startStr: monday.toISOString().slice(0, 10),
      endStr: sunday.toISOString().slice(0, 10),
    }
  }, [selectedWeekDate])

  const monthRange = useMemo(() => {
    const parts = selectedMonth.split('-').map(Number)
    const year = parts[0]
    const month = parts[1]
    const startStr = `${selectedMonth}-01`
    const lastDate = new Date(year, month, 0).getDate()
    const endStr = `${selectedMonth}-${String(lastDate).padStart(2, '0')}`
    return { startStr, endStr }
  }, [selectedMonth])

  const stepDay = (delta) => {
    const d = new Date(selectedDay + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    setSelectedDay(d.toISOString().slice(0, 10))
  }

  const stepWeek = (delta) => {
    const d = new Date(selectedWeekDate + 'T00:00:00')
    d.setDate(d.getDate() + delta * 7)
    setSelectedWeekDate(d.toISOString().slice(0, 10))
  }

  const stepMonth = (delta) => {
    const parts = selectedMonth.split('-').map(Number)
    const d = new Date(parts[0], parts[1] - 1 + delta, 1)
    const yearStr = d.getFullYear()
    const monthStr = String(d.getMonth() + 1).padStart(2, '0')
    setSelectedMonth(`${yearStr}-${monthStr}`)
  }

  const isTaskInDay = (task, dayStr) => {
    const due = task.due_date ? String(task.due_date).slice(0, 10) : null
    const start = task.start_date ? String(task.start_date).slice(0, 10) : null
    if (due === dayStr || start === dayStr) return true
    if (start && due && dayStr >= start && dayStr <= due) return true
    return false
  }

  const isTaskInWeek = (task, startStr, endStr) => {
    const due = task.due_date ? String(task.due_date).slice(0, 10) : null
    const start = task.start_date ? String(task.start_date).slice(0, 10) : null
    if (due && due >= startStr && due <= endStr) return true
    if (start && start >= startStr && start <= endStr) return true
    if (start && due && start <= endStr && due >= startStr) return true
    return false
  }

  const isTaskInMonth = (task, monthStr, startStr, endStr) => {
    const due = task.due_date ? String(task.due_date).slice(0, 10) : null
    const start = task.start_date ? String(task.start_date).slice(0, 10) : null
    if (due && (due.slice(0, 7) === monthStr || (due >= startStr && due <= endStr))) return true
    if (start && (start.slice(0, 7) === monthStr || (start >= startStr && start <= endStr))) return true
    if (start && due && start <= endStr && due >= startStr) return true
    return false
  }

  const counts = useMemo(() => {
    let daily = 0
    let weekly = 0
    let monthly = 0
    let overdue = 0

    for (const t of dashboard.tasks) {
      if (isOverdue(t)) overdue++
      if (isTaskInDay(t, selectedDay)) daily++
      if (isTaskInWeek(t, weekRange.startStr, weekRange.endStr)) weekly++
      if (isTaskInMonth(t, selectedMonth, monthRange.startStr, monthRange.endStr)) monthly++
    }

    return {
      all: dashboard.tasks.length,
      daily,
      weekly,
      monthly,
      overdue,
      completed: dashboard.tasks.filter((t) => t.status === 'completed').length,
      in_progress: dashboard.tasks.filter((t) => t.status === 'in_progress').length,
    }
  }, [dashboard.tasks, selectedDay, weekRange, selectedMonth, monthRange, todayStr])

  const filteredTasks = useMemo(() => {
    return dashboard.tasks.filter((task) => {
      if (timeframeTab === 'overdue') {
        if (!isOverdue(task)) return false
      } else if (timeframeTab === 'daily') {
        if (!isTaskInDay(task, selectedDay)) return false
      } else if (timeframeTab === 'weekly') {
        if (!isTaskInWeek(task, weekRange.startStr, weekRange.endStr)) return false
      } else if (timeframeTab === 'monthly') {
        if (!isTaskInMonth(task, selectedMonth, monthRange.startStr, monthRange.endStr)) return false
      }

      if (projectFilter !== 'all' && task.project_id !== projectFilter) return false
      if (assigneeFilter === 'unassigned') {
        if (task.assignee_id) return false
      } else if (assigneeFilter !== 'all' && task.assignee_id !== assigneeFilter) {
        return false
      }
      if (statusFilter !== 'all' && task.status !== statusFilter) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = String(task.title || '').toLowerCase().includes(q)
        const matchDesc = String(task.description || '').toLowerCase().includes(q)
        const matchProj = String(task.project_name || '').toLowerCase().includes(q)
        const matchAss = String(task.assignee_name || '').toLowerCase().includes(q)
        const matchCode = String(task.assignee_code || '').toLowerCase().includes(q)
        if (!matchTitle && !matchDesc && !matchProj && !matchAss && !matchCode) return false
      }

      return true
    })
  }, [
    dashboard.tasks,
    timeframeTab,
    selectedDay,
    weekRange,
    selectedMonth,
    monthRange,
    projectFilter,
    assigneeFilter,
    statusFilter,
    searchQuery,
    todayStr,
  ])

  const selectedEmployee = useMemo(() => {
    if (assigneeFilter === 'all' || assigneeFilter === 'unassigned') return null
    return dashboard.employees.find((e) => e.id === assigneeFilter) || null
  }, [dashboard.employees, assigneeFilter])

  const tasksByEmployee = useMemo(() => {
    const groups = new Map()
    for (const task of filteredTasks) {
      const empId = task.assignee_id || 'unassigned'
      if (!groups.has(empId)) {
        const emp = dashboard.employees.find((e) => e.id === empId) || null
        groups.set(empId, {
          employeeId: empId,
          employeeName: task.assignee_name || 'Unassigned',
          employeeCode: task.assignee_code || emp?.employee_code || '—',
          department: task.assignee_department || emp?.department || '',
          designation: task.assignee_designation || emp?.designation || '',
          tasks: [],
        })
      }
      groups.get(empId).tasks.push(task)
    }
    return Array.from(groups.values())
  }, [filteredTasks, dashboard.employees])

  return (
    <div className="page module-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">TASK MANAGEMENT</p>
          <h1>Employee tasks</h1>
          <p className="subheading">Track employee-wise tasks across daily, weekly, monthly, and overdue schedules.</p>
        </div>
        <div className="page-actions">
          <button className="primary-button" onClick={onCreate}>
            ＋ Add task
          </button>
        </div>
      </section>

      <section className="module-stat-grid">
        <article className="module-stat">
          <span>All tasks</span>
          <b>{counts.all}</b>
        </article>
        <article className="module-stat">
          <span>In progress</span>
          <b>{counts.in_progress}</b>
        </article>
        <article className="module-stat">
          <span>Overdue</span>
          <b style={{ color: counts.overdue > 0 ? '#dc2626' : 'inherit' }}>{counts.overdue}</b>
        </article>
      </section>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div className="view-toggle">
          <button className={timeframeTab === 'all' ? 'active' : ''} onClick={() => setTimeframeTab('all')}>
            All Tasks ({counts.all})
          </button>
          <button className={timeframeTab === 'daily' ? 'active' : ''} onClick={() => setTimeframeTab('daily')}>
            Daily View ({counts.daily})
          </button>
          <button className={timeframeTab === 'weekly' ? 'active' : ''} onClick={() => setTimeframeTab('weekly')}>
            Weekly View ({counts.weekly})
          </button>
          <button className={timeframeTab === 'monthly' ? 'active' : ''} onClick={() => setTimeframeTab('monthly')}>
            Monthly View ({counts.monthly})
          </button>
          <button className={timeframeTab === 'overdue' ? 'active' : ''} onClick={() => setTimeframeTab('overdue')}>
            ⚠️ Overdue ({counts.overdue})
          </button>
        </div>

        <div className="view-toggle">
          <button className={viewLayout === 'table' ? 'active' : ''} onClick={() => setViewLayout('table')}>
            📋 Table View
          </button>
          <button className={viewLayout === 'employee' ? 'active' : ''} onClick={() => setViewLayout('employee')}>
            👤 Employee-wise View
          </button>
        </div>
      </div>

      {timeframeTab === 'daily' && (
        <div className="date-filter-bar">
          <span>Selected Day:</span>
          <button type="button" className="secondary-button" onClick={() => stepDay(-1)}>
            ← Previous Day
          </button>
          <input type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} />
          <button type="button" className="secondary-button" onClick={() => setSelectedDay(todayStr)}>
            Today
          </button>
          <button type="button" className="secondary-button" onClick={() => stepDay(1)}>
            Next Day →
          </button>
          <span style={{ marginLeft: 'auto', fontWeight: 600 }}>
            Viewing: {formatDate(selectedDay)} ({counts.daily} relevant task{counts.daily === 1 ? '' : 's'})
          </span>
        </div>
      )}

      {timeframeTab === 'weekly' && (
        <div className="date-filter-bar">
          <span>Selected Week:</span>
          <button type="button" className="secondary-button" onClick={() => stepWeek(-1)}>
            ← Previous Week
          </button>
          <input type="date" value={selectedWeekDate} onChange={(e) => setSelectedWeekDate(e.target.value)} />
          <button type="button" className="secondary-button" onClick={() => setSelectedWeekDate(todayStr)}>
            Current Week
          </button>
          <button type="button" className="secondary-button" onClick={() => stepWeek(1)}>
            Next Week →
          </button>
          <span style={{ marginLeft: 'auto', fontWeight: 600 }}>
            Week of {formatDate(weekRange.startStr)} – {formatDate(weekRange.endStr)} ({counts.weekly} relevant task{counts.weekly === 1 ? '' : 's'})
          </span>
        </div>
      )}

      {timeframeTab === 'monthly' && (
        <div className="date-filter-bar">
          <span>Selected Month:</span>
          <button type="button" className="secondary-button" onClick={() => stepMonth(-1)}>
            ← Previous Month
          </button>
          <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
          <button type="button" className="secondary-button" onClick={() => setSelectedMonth(currentMonthStr)}>
            Current Month
          </button>
          <button type="button" className="secondary-button" onClick={() => stepMonth(1)}>
            Next Month →
          </button>
          <span style={{ marginLeft: 'auto', fontWeight: 600 }}>
            Month: {selectedMonth} ({counts.monthly} relevant task{counts.monthly === 1 ? '' : 's'})
          </span>
        </div>
      )}

      {selectedEmployee && (
        <div className="employee-summary-banner">
          <div>
            <strong>Assigned Employee:</strong> {selectedEmployee.full_name} ({selectedEmployee.employee_code})
            {selectedEmployee.designation ? ` — ${selectedEmployee.designation}` : ''}
            {selectedEmployee.department ? ` (${selectedEmployee.department})` : ''}
          </div>
          <button
            type="button"
            className="secondary-button"
            style={{ padding: '3px 8px', fontSize: '11px' }}
            onClick={() => setAssigneeFilter('all')}
          >
            Show All Employees
          </button>
        </div>
      )}

      <section className="panel data-panel">
        <div className="filter-bar">
          <input
            type="text"
            placeholder="Search tasks, assignees, or projects…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ minWidth: '240px' }}
          />
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="all">All Projects</option>
            {dashboard.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_code} — {p.name}
              </option>
            ))}
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
            <option value="all">All Employees ({dashboard.employees.length})</option>
            {dashboard.employees.map((e) => {
              const empTaskCount = dashboard.tasks.filter((t) => t.assignee_id === e.id).length
              return (
                <option key={e.id} value={e.id}>
                  {e.full_name} ({e.employee_code}) — {empTaskCount} task{empTaskCount === 1 ? '' : 's'}
                </option>
              )
            })}
            <option value="unassigned">Unassigned Tasks</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        {loading ? (
          <Empty text="Loading tasks…" />
        ) : !filteredTasks.length ? (
          <Empty text="No tasks found matching current filters." />
        ) : viewLayout === 'employee' ? (
          <div className="employee-task-groups">
            {tasksByEmployee.map((group) => (
              <article key={group.employeeId} className="employee-task-section">
                <div className="employee-task-header">
                  <div className="employee-task-header-info">
                    <span className="avatar" style={{ width: '28px', height: '28px', fontSize: '11px' }}>
                      {(group.employeeName || 'U').slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <strong style={{ fontSize: '13px' }}>{group.employeeName}</strong>
                      <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '6px' }}>
                        ({group.employeeCode}){group.designation ? ` • ${group.designation}` : ''}
                      </span>
                    </div>
                  </div>
                  <span className="status-badge" style={{ background: '#e2e8f0', color: '#334155' }}>
                    {group.tasks.length} task{group.tasks.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Task Title</th>
                        <th>Project</th>
                        <th>Due Date</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tasks.map((task) => {
                        const overdue = isOverdue(task)
                        return (
                          <tr key={task.id}>
                            <td>
                              <strong>{task.title}</strong>
                              {task.description && (
                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                  {task.description.slice(0, 60)}
                                  {task.description.length > 60 ? '…' : ''}
                                </div>
                              )}
                            </td>
                            <td>{task.project_name || '—'}</td>
                            <td>
                              <div>
                                <span>{task.due_date ? formatDate(task.due_date) : 'No due date'}</span>
                                {overdue && (
                                  <div style={{ marginTop: '3px' }}>
                                    <span className="overdue-badge">⚠️ Overdue</span>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className="status-badge">{task.priority || 'medium'}</span>
                            </td>
                            <td>
                              <select
                                className="status-select"
                                value={task.status || 'pending'}
                                onChange={(e) => onStatusChange(task.id, e.target.value)}
                              >
                                <option value="pending">Pending</option>
                                <option value="in_progress">In Progress</option>
                                <option value="in_review">In Review</option>
                                <option value="completed">Completed</option>
                              </select>
                            </td>
                            <td>
                              <button
                                className="secondary-button"
                                style={{ padding: '3px 8px', fontSize: '11px' }}
                                onClick={() => onEdit(task)}
                              >
                                ✎ Edit
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Task Title</th>
                  <th>Project</th>
                  <th>Assigned Employee</th>
                  <th>Due Date</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((task) => {
                  const overdue = isOverdue(task)
                  return (
                    <tr key={task.id}>
                      <td>
                        <strong>{task.title}</strong>
                        {task.description && (
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                            {task.description.slice(0, 60)}
                            {task.description.length > 60 ? '…' : ''}
                          </div>
                        )}
                      </td>
                      <td>{task.project_name || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="avatar" style={{ width: '24px', height: '24px', fontSize: '10px' }}>
                            {(task.assignee_name || 'U').slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <span style={{ fontWeight: 600, display: 'block', fontSize: '12px' }}>
                              {task.assignee_name || 'Unassigned'}
                            </span>
                            {task.assignee_code && (
                              <span style={{ fontSize: '10.5px', color: '#64748b' }}>{task.assignee_code}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div>
                          <span>{task.due_date ? formatDate(task.due_date) : 'No due date'}</span>
                          {overdue && (
                            <div style={{ marginTop: '3px' }}>
                              <span className="overdue-badge">⚠️ Overdue</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="status-badge">{task.priority || 'medium'}</span>
                      </td>
                      <td>
                        <select
                          className="status-select"
                          value={task.status || 'pending'}
                          onChange={(e) => onStatusChange(task.id, e.target.value)}
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="in_review">In Review</option>
                          <option value="completed">Completed</option>
                        </select>
                      </td>
                      <td>
                        <button
                          className="secondary-button"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => onEdit(task)}
                        >
                          ✎ Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function TaskModal({ task, projects, employees, onClose, onSaved }) {
  const isEdit = Boolean(task?.id)
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    project_id: task?.project_id || projects[0]?.id || '',
    assignee_id: task?.assignee_id || employees[0]?.id || '',
    priority: task?.priority || 'medium',
    status: task?.status || 'pending',
    start_date: task?.start_date ? String(task.start_date).slice(0, 10) : '',
    due_date: task?.due_date ? String(task.due_date).slice(0, 10) : '',
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const values = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        project_id: form.project_id,
        assignee_id: form.assignee_id,
        priority: form.priority,
        status: form.status,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      }
      await saveRecord('tasks', values, task?.id)
      onSaved()
    } catch (err) {
      setMessage(err.message || 'Could not save task.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form record-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner meeting">
          <span>✓</span>
          <div>
            <p>TASK MANAGEMENT</p>
            <h2>{isEdit ? `Edit Task: ${task.title}` : 'Add New Task'}</h2>
          </div>
        </div>

        <div className="form-fields">
          <label style={{ gridColumn: '1 / -1' }}>
            Task Title *
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Description
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label>
            Project *
            <select required value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee *
            <select required value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
              <option value="">Select assignee</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="in_review">In Review</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label>
            Start Date
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </label>
          <label>
            Due Date
            <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </label>

          {message && <p className="form-message" style={{ gridColumn: '1 / -1' }}>{message}</p>}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? 'Saving task…' : isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  )
}

function RewardModal({ reward, employees, onClose, onSaved }) {
  const isEdit = Boolean(reward?.id)
  const [form, setForm] = useState({
    employee_id: reward?.employee_id || employees[0]?.id || '',
    title: reward?.title || '',
    description: reward?.description || '',
    reward_date: reward?.reward_date || reward?.nominated_at || new Date().toISOString().slice(0, 10),
    status: reward?.status || 'approved',
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setMessage('')

    if (!form.employee_id || !form.title.trim() || !form.description.trim() || !form.reward_date) {
      if (!form.employee_id) setMessage('Please select an employee.')
      else if (!form.title.trim()) setMessage('Reward title is required.')
      else if (!form.description.trim()) setMessage('Reward description is required.')
      else setMessage('Reward date is required.')
      return
    }

    setBusy(true)
    try {
      const titleClean = form.title.trim()
      const descClean = form.description.trim()
      const reasonCombined = descClean ? `${titleClean}\n\n${descClean}` : titleClean

      const values = {
        employee_id: form.employee_id,
        reason: reasonCombined,
        nominated_at: form.reward_date,
        status: form.status,
      }
      await saveRecord('rewards', values, reward?.id)
      onSaved()
    } catch (err) {
      setMessage(err.message || 'Could not save reward record.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="event-modal create-form record-form" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <div className="event-banner meeting">
          <span>🏆</span>
          <div>
            <p>TALENT & RECOGNITION</p>
            <h2>{isEdit ? 'Edit Reward' : 'Create Employee Reward'}</h2>
          </div>
        </div>

        <div className="form-fields">
          <label style={{ gridColumn: '1 / -1' }}>
            Employee *
            <select
              required
              value={form.employee_id}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            >
              <option value="">Select an employee</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            Reward Title *
            <input
              required
              placeholder="e.g. Employee of the Month, Spot Excellence Award"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            Description *
            <textarea
              required
              placeholder="Provide context or achievements that earned this recognition…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>

          <label>
            Reward Date *
            <input
              required
              type="date"
              value={form.reward_date}
              onChange={(e) => setForm({ ...form, reward_date: e.target.value })}
            />
          </label>

          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>

          {message && <p className="form-message" style={{ gridColumn: '1 / -1' }}>{message}</p>}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? 'Saving reward…' : isEdit ? 'Save Changes' : 'Create Reward'}
          </button>
        </div>
      </form>
    </div>
  )
}

function RewardsPage({ dashboard, loading, onCreate, onEdit, onDelete, onDecide }) {
  const [tab, setTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('all')

  const pending = useMemo(() => dashboard.rewards.filter((r) => r.status === 'pending'), [dashboard.rewards])
  const approved = useMemo(() => dashboard.rewards.filter((r) => r.status === 'approved'), [dashboard.rewards])
  const all = dashboard.rewards

  const displayed = useMemo(() => {
    let list = tab === 'pending' ? pending : tab === 'approved' ? approved : all
    if (employeeFilter !== 'all') {
      list = list.filter((r) => r.employee_id === employeeFilter)
    }
    if (!searchQuery.trim()) return list
    const q = searchQuery.toLowerCase()
    return list.filter((r) =>
      String(r.full_name || '').toLowerCase().includes(q) ||
      String(r.title || '').toLowerCase().includes(q) ||
      String(r.description || '').toLowerCase().includes(q)
    )
  }, [tab, pending, approved, all, employeeFilter, searchQuery])

  return (
    <div className="page module-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">TALENT & RECOGNITION</p>
          <h1>Reward Management</h1>
          <p className="subheading">Create, view, edit, and manage employee awards, achievements, and recognition records.</p>
        </div>
        <div className="page-actions">
          <button className="primary-button" onClick={onCreate}>
            ＋ Create reward
          </button>
        </div>
      </section>

      <section className="module-stat-grid">
        <article className="module-stat">
          <span>Total Rewards</span>
          <b>{all.length}</b>
        </article>
        <article className="module-stat">
          <span>Approved</span>
          <b>{approved.length}</b>
        </article>
        <article className="module-stat">
          <span>Pending Review</span>
          <b style={{ color: pending.length ? '#d97706' : 'inherit' }}>{pending.length}</b>
        </article>
      </section>

      <div className="view-toggle">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          All Rewards ({all.length})
        </button>
        <button className={tab === 'approved' ? 'active' : ''} onClick={() => setTab('approved')}>
          Approved ({approved.length})
        </button>
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          Pending Review ({pending.length})
        </button>
      </div>

      <section className="panel data-panel">
        <div className="filter-bar">
          <input
            type="text"
            placeholder="Search rewards by employee, title, or description…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ minWidth: '280px' }}
          />
          <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
            <option value="all">All Employees ({dashboard.employees.length})</option>
            {dashboard.employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name} ({emp.employee_code})
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Empty text="Loading employee rewards…" />
        ) : !displayed.length ? (
          <Empty text="No rewards found matching current filters. Click 'Create reward' to add one." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee Name</th>
                  <th>Reward Title</th>
                  <th>Description</th>
                  <th>Reward Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="avatar" style={{ width: '28px', height: '28px', fontSize: '11px' }}>
                          {(row.full_name || 'E').slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <strong>{row.full_name || 'Employee'}</strong>
                          {row.employee_code && (
                            <div style={{ fontSize: '10.5px', color: '#64748b' }}>{row.employee_code}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{row.title || 'Recognition Award'}</strong>
                    </td>
                    <td style={{ maxWidth: '320px', whiteSpace: 'pre-wrap', fontSize: '11.5px', color: '#475569' }}>
                      {row.description || '—'}
                    </td>
                    <td>{formatDate(row.reward_date)}</td>
                    <td>
                      <span className={`status-badge ${row.status}`}>{row.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button
                          className="secondary-button"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                          onClick={() => onEdit(row)}
                        >
                          ✎ Edit
                        </button>
                        <button
                          className="danger-button"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                          onClick={() => onDelete(row)}
                        >
                          🗑 Delete
                        </button>
                        {row.status === 'pending' && onDecide && (
                          <button
                            className="primary-button"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => onDecide({ kind: 'reward', record: row, outcome: 'approved' })}
                          >
                            Approve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function AnalyticsPage({ dashboard, loading, onSelectEmployee }) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [selectedEmpId, setSelectedEmpId] = useState('')

  // 1. Overall Analytics calculations based on actual database records
  const overall = useMemo(() => {
    const totalTasks = dashboard.tasks.length
    const totalTasksAssigned = dashboard.tasks.filter((t) => Boolean(t.assignee_id)).length
    const completedTasks = dashboard.tasks.filter((t) => t.status === 'completed').length
    const taskCompletionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0

    const totalProjects = dashboard.projects.length
    const completedProjects = dashboard.projects.filter((p) => p.status === 'completed').length
    const activeProjects = dashboard.projects.filter((p) => p.status === 'in_progress' || p.status === 'ongoing').length

    // Projects lagging behind their expected progress based on dates, progress, and status
    const today = new Date(todayStr + 'T00:00:00')
    const laggingProjects = dashboard.projects
      .filter((project) => {
        if (project.status === 'completed' || project.status === 'cancelled') return false

        const currentProgress = Number(project.progress || 0)

        // Condition 1: Overdue project due date
        if (project.due_date && String(project.due_date).slice(0, 10) < todayStr) {
          return true
        }

        // Condition 2: Explicitly marked as critical or at_risk
        if (project.risk_level === 'at_risk' || project.risk_level === 'critical') {
          return true
        }

        // Condition 3: Expected progress based on elapsed timeline vs actual progress
        if (project.start_date && project.due_date) {
          const start = new Date(String(project.start_date).slice(0, 10) + 'T00:00:00')
          const due = new Date(String(project.due_date).slice(0, 10) + 'T00:00:00')
          const totalDuration = due.getTime() - start.getTime()
          const elapsed = today.getTime() - start.getTime()

          if (totalDuration > 0 && elapsed > 0) {
            const expectedPct = Math.min(100, Math.round((elapsed / totalDuration) * 100))
            if (expectedPct - currentProgress >= 15) {
              return true
            }
          }
        }

        return false
      })
      .map((project) => {
        let lagReason = 'Timeline slippage'
        const currentProgress = Number(project.progress || 0)
        let expectedProgress = null

        if (project.start_date && project.due_date) {
          const start = new Date(String(project.start_date).slice(0, 10) + 'T00:00:00')
          const due = new Date(String(project.due_date).slice(0, 10) + 'T00:00:00')
          const totalDuration = due.getTime() - start.getTime()
          const elapsed = today.getTime() - start.getTime()
          if (totalDuration > 0 && elapsed > 0) {
            expectedProgress = Math.min(100, Math.round((elapsed / totalDuration) * 100))
          }
        }

        if (project.due_date && String(project.due_date).slice(0, 10) < todayStr) {
          lagReason = `Past due date (${formatDate(project.due_date)})`
        } else if (expectedProgress !== null && expectedProgress - currentProgress >= 15) {
          lagReason = `Actual progress (${currentProgress}%) lags expected (${expectedProgress}%)`
        } else if (project.risk_level === 'critical' || project.risk_level === 'at_risk') {
          lagReason = `Flagged as ${project.risk_level === 'critical' ? 'Critical' : 'At Risk'}`
        }

        return { ...project, lagReason, expectedProgress }
      })

    const overdueTasks = dashboard.tasks.filter(
      (t) => t.due_date && String(t.due_date).slice(0, 10) < todayStr && t.status !== 'completed'
    )

    const activeEmployees = dashboard.employees.filter((e) => e.status === 'active').length
    const onLeaveEmployees = dashboard.employees.filter((e) => e.status === 'on_leave').length

    // Individual employee summary contributions
    const employeeContributions = dashboard.employees
      .map((emp) => {
        const assigned = dashboard.tasks.filter((t) => t.assignee_id === emp.id)
        const done = assigned.filter((t) => t.status === 'completed')
        const overdue = assigned.filter(
          (t) => t.due_date && String(t.due_date).slice(0, 10) < todayStr && t.status !== 'completed'
        ).length
        const rate = assigned.length ? Math.round((done.length / assigned.length) * 100) : 0
        const projectIds = new Set(assigned.map((t) => t.project_id).filter(Boolean))

        let perfBadge = 'neutral'
        let perfLabel = 'No Tasks'
        if (assigned.length > 0) {
          if (rate >= 80 && overdue === 0) {
            perfBadge = 'high'
            perfLabel = 'High Performer'
          } else if (rate >= 50) {
            perfBadge = 'mid'
            perfLabel = 'Consistent'
          } else {
            perfBadge = 'low'
            perfLabel = 'Needs Focus'
          }
        }

        return {
          ...emp,
          assignedCount: assigned.length,
          doneCount: done.length,
          overdueCount: overdue,
          completionRate: rate,
          projectCount: projectIds.size,
          perfBadge,
          perfLabel,
        }
      })
      .sort((a, b) => b.doneCount - a.doneCount || b.completionRate - a.completionRate)

    return {
      totalTasks,
      totalTasksAssigned,
      completedTasks,
      taskCompletionRate,
      totalProjects,
      completedProjects,
      activeProjects,
      laggingProjects,
      overdueTasks,
      activeEmployees,
      onLeaveEmployees,
      employeeContributions,
    }
  }, [dashboard.tasks, dashboard.projects, dashboard.employees, todayStr])

  // 2. Employee-wise Analytics for selected employee
  const selectedEmployeeData = useMemo(() => {
    if (!selectedEmpId) return null
    const emp = dashboard.employees.find((e) => e.id === selectedEmpId)
    if (!emp) return null

    const assignedTasks = dashboard.tasks.filter((t) => t.assignee_id === emp.id)
    const completedTasks = assignedTasks.filter((t) => t.status === 'completed')
    const inProgressTasks = assignedTasks.filter((t) => t.status === 'in_progress')
    const pendingTasks = assignedTasks.filter((t) => t.status === 'pending')
    const completionRate = assignedTasks.length ? Math.round((completedTasks.length / assignedTasks.length) * 100) : 0

    // Relevant projects using employee-project relationships:
    // - manager_id === emp.id
    // - team_lead_id === emp.id
    // - employee has tasks assigned in project
    const empTaskProjectIds = new Set(assignedTasks.map((t) => t.project_id).filter(Boolean))
    const relevantProjects = dashboard.projects
      .filter((p) => p.manager_id === emp.id || p.team_lead_id === emp.id || empTaskProjectIds.has(p.id))
      .map((p) => {
        const roles = []
        if (p.manager_id === emp.id) roles.push('Project Manager')
        if (p.team_lead_id === emp.id) roles.push('Team Lead')
        if (empTaskProjectIds.has(p.id) && !roles.length) roles.push('Task Contributor')
        return {
          ...p,
          role: roles.join(' & ') || 'Contributor',
        }
      })

    // Tasks needing attention: overdue, high/urgent priority not done, or in review
    const tasksNeedingAttention = assignedTasks
      .filter((task) => {
        if (task.status === 'completed') return false
        const isPastDue = task.due_date && String(task.due_date).slice(0, 10) < todayStr
        const isPriority = task.priority === 'urgent' || task.priority === 'high'
        return isPastDue || isPriority || task.status === 'in_review'
      })
      .map((task) => {
        const reasons = []
        if (task.due_date && String(task.due_date).slice(0, 10) < todayStr) reasons.push('Overdue')
        if (task.priority === 'urgent' || task.priority === 'high') reasons.push(`${task.priority} Priority`)
        if (task.status === 'in_review') reasons.push('Awaiting Review')
        return {
          ...task,
          attentionReason: reasons.join(', ') || 'Action Required',
        }
      })

    // Projects needing attention: past due, at risk/critical, or lagging
    const projectsNeedingAttention = relevantProjects
      .filter((p) => {
        if (p.status === 'completed' || p.status === 'cancelled') return false
        const isPastDue = p.due_date && String(p.due_date).slice(0, 10) < todayStr
        const isAtRisk = p.risk_level === 'at_risk' || p.risk_level === 'critical'
        const isLagging = overall.laggingProjects.some((lp) => lp.id === p.id)
        return isPastDue || isAtRisk || isLagging
      })
      .map((p) => {
        const reasons = []
        if (p.due_date && String(p.due_date).slice(0, 10) < todayStr) reasons.push('Past Due Date')
        if (p.risk_level === 'critical') reasons.push('Critical Risk Level')
        if (p.risk_level === 'at_risk') reasons.push('At Risk Level')
        if (overall.laggingProjects.some((lp) => lp.id === p.id)) reasons.push('Lagging Behind Schedule')
        return {
          ...p,
          attentionReason: reasons.join(', ') || 'Needs Attention',
        }
      })

    return {
      employee: emp,
      totalTasks: assignedTasks.length,
      completedTasks: completedTasks.length,
      inProgressTasks: inProgressTasks.length,
      pendingTasks: pendingTasks.length,
      completionRate,
      assignedTasks,
      relevantProjects,
      tasksNeedingAttention,
      projectsNeedingAttention,
    }
  }, [selectedEmpId, dashboard.employees, dashboard.tasks, dashboard.projects, overall.laggingProjects, todayStr])

  return (
    <div className="page module-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">EXECUTIVE & PERFORMANCE METRICS</p>
          <h1>Analytics Dashboard</h1>
          <p className="subheading">Comprehensive overall delivery insights, project health tracking, and employee-wise analytics.</p>
        </div>
      </section>

      {/* OVERALL ANALYTICS SECTION */}
      <h2 style={{ fontSize: '15px', color: '#1e293b', margin: '14px 0 10px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        Overall Workforce & Project Analytics
      </h2>
      <div className="kpi-grid">
        <div className="kpi-card">
          <h3>Total Tasks Assigned</h3>
          <div className="kpi-value">{overall.totalTasksAssigned}</div>
          <div className="kpi-sub">
            {overall.totalTasksAssigned} assigned of {overall.totalTasks} total created tasks
          </div>
        </div>

        <div className="kpi-card">
          <h3>Completed Tasks</h3>
          <div className="kpi-value" style={{ color: '#059669' }}>
            {overall.completedTasks}
          </div>
          <div className="kpi-sub">
            {overall.taskCompletionRate}% task completion rate across all projects
          </div>
          <div className="mini-progress" style={{ width: '100%', height: '7px', marginTop: '8px' }}>
            <div className="mini-progress-fill" style={{ width: `${overall.taskCompletionRate}%`, background: '#059669' }} />
          </div>
        </div>

        <div className="kpi-card">
          <h3>Completed Projects</h3>
          <div className="kpi-value" style={{ color: '#2563eb' }}>
            {overall.completedProjects}
          </div>
          <div className="kpi-sub">
            {overall.completedProjects} completed of {overall.totalProjects} total · {overall.activeProjects} ongoing/active
          </div>
        </div>

        <div className="kpi-card">
          <h3>Lagging Behind Progress</h3>
          <div className="kpi-value" style={{ color: overall.laggingProjects.length ? '#dc2626' : '#059669' }}>
            {overall.laggingProjects.length} Project{overall.laggingProjects.length === 1 ? '' : 's'}
          </div>
          <div className="kpi-sub">
            {overall.laggingProjects.length
              ? 'Projects lagging behind timeline or flagged at risk'
              : 'All active projects currently on schedule'}
          </div>
        </div>
      </div>

      {/* PROJECTS LAGGING BEHIND EXPECTED PROGRESS BREAKDOWN */}
      <section className="panel data-panel" style={{ marginTop: '16px' }}>
        <div className="panel-heading">
          <div>
            <h2>Projects Lagging Behind Expected Progress</h2>
            <p>Calculated based on actual project start dates, due dates, recorded progress (%), and active status.</p>
          </div>
        </div>

        {overall.laggingProjects.length === 0 ? (
          <div style={{ padding: '16px', background: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0', color: '#065f46' }}>
            ✓ <strong>All clear!</strong> No active projects are currently lagging behind their expected delivery schedules.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Project Code & Name</th>
                  <th>Manager</th>
                  <th>Status</th>
                  <th>Current Progress</th>
                  <th>Expected Progress</th>
                  <th>Due Date</th>
                  <th>Lag Reason</th>
                </tr>
              </thead>
              <tbody>
                {overall.laggingProjects.map((proj) => (
                  <tr key={proj.id}>
                    <td>
                      <strong>{proj.project_code}</strong> — {proj.name}
                    </td>
                    <td>{proj.manager_name || 'Unassigned'}</td>
                    <td>
                      <span className={`status ${proj.status}`}>{proj.status}</span>
                    </td>
                    <td>
                      <div>
                        <span>{proj.progress ?? 0}%</span>
                        <div className="mini-progress">
                          <div className="mini-progress-fill" style={{ width: `${proj.progress ?? 0}%`, background: '#dc2626' }} />
                        </div>
                      </div>
                    </td>
                    <td>{proj.expectedProgress !== null ? `${proj.expectedProgress}%` : 'N/A (Dates missing)'}</td>
                    <td>{formatDate(proj.due_date)}</td>
                    <td>
                      <span className="overdue-badge">{proj.lagReason}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* EMPLOYEE-WISE ANALYTICS SECTION */}
      <section className="panel data-panel" style={{ marginTop: '22px' }}>
        <div className="panel-heading">
          <div>
            <h2>Employee-wise Analytics & Deep Dive</h2>
            <p>Select any employee to view their assigned tasks, completed tasks, relevant project statuses, and items needing attention.</p>
          </div>
        </div>

        <div className="filter-bar" style={{ padding: '12px 0 16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
            Select Employee:
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              style={{ minWidth: '320px', padding: '8px 12px', fontSize: '13px', border: '1px solid #cbd5e1' }}
            >
              <option value="">-- Choose an employee to inspect ({dashboard.employees.length} available) --</option>
              {dashboard.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code}) — {emp.designation || 'Staff'} ({emp.department || 'General'})
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedEmployeeData ? (
          <div className="employee-analytics-detail" style={{ background: '#f8fafc', padding: '18px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            {/* Header banner */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="avatar" style={{ width: '38px', height: '38px', fontSize: '14px' }}>
                  {selectedEmployeeData.employee.full_name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>
                    {selectedEmployeeData.employee.full_name} ({selectedEmployeeData.employee.employee_code})
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                    {selectedEmployeeData.employee.designation || 'Employee'} • {selectedEmployeeData.employee.department || 'No department'} • Status: <strong style={{ textTransform: 'capitalize' }}>{selectedEmployeeData.employee.status}</strong>
                  </p>
                </div>
              </div>
              <button className="secondary-button" onClick={() => setSelectedEmpId('')}>
                Clear Selection
              </button>
            </div>

            {/* KPI grid for selected employee */}
            <div className="kpi-grid" style={{ margin: '0 0 18px' }}>
              <div className="kpi-card" style={{ background: '#fff' }}>
                <h3>Total Assigned Tasks</h3>
                <div className="kpi-value">{selectedEmployeeData.totalTasks}</div>
                <div className="kpi-sub">Assigned to this employee</div>
              </div>
              <div className="kpi-card" style={{ background: '#fff' }}>
                <h3>Completed Tasks</h3>
                <div className="kpi-value" style={{ color: '#059669' }}>
                  {selectedEmployeeData.completedTasks}
                </div>
                <div className="kpi-sub">{selectedEmployeeData.completionRate}% completion rate</div>
                <div className="mini-progress" style={{ width: '100%', marginTop: '6px' }}>
                  <div className="mini-progress-fill" style={{ width: `${selectedEmployeeData.completionRate}%`, background: '#059669' }} />
                </div>
              </div>
              <div className="kpi-card" style={{ background: '#fff' }}>
                <h3>In Progress / Pending</h3>
                <div className="kpi-value" style={{ color: '#2563eb' }}>
                  {selectedEmployeeData.inProgressTasks + selectedEmployeeData.pendingTasks}
                </div>
                <div className="kpi-sub">{selectedEmployeeData.inProgressTasks} in progress · {selectedEmployeeData.pendingTasks} pending</div>
              </div>
              <div className="kpi-card" style={{ background: '#fff' }}>
                <h3>Associated Projects</h3>
                <div className="kpi-value" style={{ color: '#7c3aed' }}>
                  {selectedEmployeeData.relevantProjects.length}
                </div>
                <div className="kpi-sub">Manager, lead, or task contributor</div>
              </div>
            </div>

            {/* Relevant Project Statuses Table */}
            <div style={{ background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#1e293b' }}>
                Relevant Project Statuses ({selectedEmployeeData.relevantProjects.length})
              </h4>
              {selectedEmployeeData.relevantProjects.length === 0 ? (
                <Empty text="This employee is not currently linked to any projects as a manager, lead, or task contributor." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Employee Role</th>
                        <th>Current Status</th>
                        <th>Progress</th>
                        <th>Due Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEmployeeData.relevantProjects.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.project_code}</strong> — {p.name}
                          </td>
                          <td>
                            <span className="status-badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                              {p.role}
                            </span>
                          </td>
                          <td>
                            <span className={`status ${p.status === 'in_progress' ? 'ongoing' : p.status}`}>
                              {p.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td>
                            <div>
                              <span>{p.progress ?? 0}%</span>
                              <div className="mini-progress">
                                <div className="mini-progress-fill" style={{ width: `${p.progress ?? 0}%` }} />
                              </div>
                            </div>
                          </td>
                          <td>{formatDate(p.due_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Items Needing Attention Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
              {/* Tasks Needing Attention */}
              <div style={{ background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚠️</span> Tasks Needing Attention ({selectedEmployeeData.tasksNeedingAttention.length})
                </h4>
                {selectedEmployeeData.tasksNeedingAttention.length === 0 ? (
                  <p style={{ fontSize: '12px', color: '#059669', margin: '6px 0' }}>
                    ✓ No assigned tasks currently require urgent attention.
                  </p>
                ) : (
                  <div className="workflow-list">
                    {selectedEmployeeData.tasksNeedingAttention.map((task) => (
                      <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                        <div>
                          <strong style={{ fontSize: '12px', display: 'block' }}>{task.title}</strong>
                          <small style={{ fontSize: '11px', color: '#64748b' }}>
                            Project: {task.project_name} · Due: {formatDate(task.due_date)}
                          </small>
                        </div>
                        <span className="overdue-badge" style={{ fontSize: '10px' }}>
                          {task.attentionReason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Projects Needing Attention */}
              <div style={{ background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#d97706', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>▣</span> Projects Needing Attention ({selectedEmployeeData.projectsNeedingAttention.length})
                </h4>
                {selectedEmployeeData.projectsNeedingAttention.length === 0 ? (
                  <p style={{ fontSize: '12px', color: '#059669', margin: '6px 0' }}>
                    ✓ All associated projects are operating on schedule without elevated risk.
                  </p>
                ) : (
                  <div className="workflow-list">
                    {selectedEmployeeData.projectsNeedingAttention.map((p) => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                        <div>
                          <strong style={{ fontSize: '12px', display: 'block' }}>
                            {p.project_code} — {p.name}
                          </strong>
                          <small style={{ fontSize: '11px', color: '#64748b' }}>
                            Role: {p.role} · Progress: {p.progress ?? 0}% · Due: {formatDate(p.due_date)}
                          </small>
                        </div>
                        <span className="overdue-badge" style={{ fontSize: '10px' }}>
                          {p.attentionReason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '24px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '13px' }}>
            👆 Select an employee from the dropdown above to inspect their task delivery rate, associated projects, and active priorities.
          </div>
        )}
      </section>

      {/* ALL EMPLOYEES CONTRIBUTIONS OVERVIEW TABLE */}
      <section className="panel data-panel" style={{ marginTop: '22px' }}>
        <div className="panel-heading">
          <div>
            <h2>All Employee Workloads & Completion Rates</h2>
            <p>High-level directory breakdown of assigned tasks, completions, and performance across the company.</p>
          </div>
        </div>

        {loading ? (
          <Empty text="Loading employee analytics…" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Tasks Assigned</th>
                  <th>Completed</th>
                  <th>Completion Rate</th>
                  <th>Active Projects</th>
                  <th>Performance Rating</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {overall.employeeContributions.map((emp) => (
                  <tr key={emp.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="avatar" style={{ width: '28px', height: '28px', fontSize: '11px' }}>
                          {(emp.full_name || 'E').slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <strong>{emp.full_name}</strong>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>{emp.employee_code}</div>
                        </div>
                      </div>
                    </td>
                    <td>{emp.department || '—'}</td>
                    <td>
                      <b>{emp.assignedCount}</b>
                    </td>
                    <td>
                      <span style={{ color: '#059669', fontWeight: 600 }}>{emp.doneCount}</span>
                    </td>
                    <td>
                      <div>
                        <span>{emp.completionRate}%</span>
                        <div className="mini-progress">
                          <div className="mini-progress-fill" style={{ width: `${emp.completionRate}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>{emp.projectCount}</td>
                    <td>
                      <span className={`perf-badge ${emp.perfBadge}`}>{emp.perfLabel}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          className="secondary-button"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => {
                            setSelectedEmpId(emp.id)
                            window.scrollTo({ top: 300, behavior: 'smooth' })
                          }}
                        >
                          📊 Inspect
                        </button>
                        <button
                          className="secondary-button"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => onSelectEmployee(emp)}
                        >
                          Profile →
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default App
