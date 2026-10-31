import { supabase } from './supabase'

const requireClient = () => {
  if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.')
  return supabase
}

const emptyDashboard = {
  summary: { total_employees: 0, on_leave: 0, active_projects: 0, pending_leave_requests: 0 },
  employees: [],
  events: [],
  projects: [],
  tasks: [],
  leaveRequests: [],
  attendance: [],
  rewards: [],
  documents: [],
  corrections: [],
  auditLogs: [],
  notifications: [],
  invitations: [],
  leaveBalances: [],
  taskSummary: [],
}

async function api(action, payload = {}) {
  const { data, error } = await requireClient().functions.invoke('workly-api', { body: { action, ...payload } })
  if (error) {
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
          // Keep the Supabase client error when the response has no readable body.
        }
      }
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function getDashboard() {
  const data = await api('dashboard')
  const employeeById = new Map(data.employees.map((employee) => [employee.id, employee]))
  const projectById = new Map(data.projects.map((project) => [project.id, project]))
  const projects = data.projects.map((project) => ({
    ...project,
    manager_name: employeeById.get(project.manager_id)?.full_name || null,
  }))
  const events = data.events.map((event) => ({
    ...event,
    project_name: projectById.get(event.project_id)?.name || 'Unassigned project',
    project_code: projectById.get(event.project_id)?.project_code || '—',
    due_date: projectById.get(event.project_id)?.due_date || null,
  }))
  const leaveRequests = data.leaveRequests.map((request) => ({
    ...request,
    full_name: employeeById.get(request.employee_id)?.full_name || 'Unknown employee',
    employee_code: employeeById.get(request.employee_id)?.employee_code || '—',
  }))
  const tasks = data.tasks.map((task) => {
    const assignee = employeeById.get(task.assignee_id)
    return {
      ...task,
      project_name: projectById.get(task.project_id)?.name || 'Unknown project',
      assignee_name: assignee?.full_name || 'Unassigned',
      assignee_code: assignee?.employee_code || '',
      assignee_department: assignee?.department || '',
      assignee_designation: assignee?.designation || '',
    }
  })
  const attendance = data.attendance.map((record) => ({
    ...record,
    full_name: employeeById.get(record.employee_id)?.full_name || 'Unknown employee',
  }))
  const rewards = data.rewards.map((reward) => {
    let title = reward.title
    let description = reward.description || reward.reason
    if (!title && reward.reason) {
      if (reward.reason.includes('\n\n')) {
        const parts = reward.reason.split('\n\n')
        title = parts[0]
        description = parts.slice(1).join('\n\n')
      } else if (reward.reason.includes(' — ')) {
        const parts = reward.reason.split(' — ')
        title = parts[0]
        description = parts.slice(1).join(' — ')
      } else {
        title = reward.reason
        description = reward.reason
      }
    }
    const emp = employeeById.get(reward.employee_id)
    return {
      ...reward,
      full_name: emp?.full_name || 'Unknown employee',
      employee_code: emp?.employee_code || '',
      title: title || reward.reason || 'Reward',
      description: description || reward.reason || '',
      reward_date: reward.reward_date || reward.nominated_at || (reward.created_at ? String(reward.created_at).slice(0, 10) : ''),
    }
  })
  const taskSummary = ['pending', 'in_progress', 'in_review', 'completed'].map((status) => ({
    status,
    count: tasks.filter((task) => task.status === status).length,
  }))

  return {
    summary: {
      total_employees: data.employees.filter((employee) => employee.status === 'active').length,
      on_leave: data.employees.filter((employee) => employee.status === 'on_leave').length,
      active_projects: projects.filter((project) => ['upcoming', 'in_progress', 'ongoing'].includes(project.status)).length,
      pending_leave_requests: leaveRequests.filter((request) => request.status === 'pending').length,
    },
    employees: data.employees,
    events,
    projects,
    tasks,
    leaveRequests,
    attendance,
    rewards,
    documents: data.documents || [],
    corrections: data.corrections || [],
    auditLogs: data.auditLogs || [],
    notifications: data.notifications || [],
    invitations: data.invitations || [],
    leaveBalances: data.leaveBalances || [],
    taskSummary,
  }
}

export const createEvent = (values) =>
  api('create', {
    table: 'calendar_events',
    values: {
      project_id: values.projectId,
      title: values.title,
      description: values.description,
      event_type: values.eventType,
      starts_at: new Date(values.startsAt).toISOString(),
    },
  })

export const saveRecord = (table, values, id) => api(id ? 'update' : 'create', { table, values, id })
export const deleteRecord = (table, id) => api('delete', { table, id })
export const deleteEmployee = (employeeId) => api('delete', { table: 'employees', id: employeeId })

export const decideLeave = (requestId, decision, chargeableDays, reason, policyException = false) =>
  api('decide_leave', { requestId, decision, chargeableDays, reason, policyException })

export const setLeaveBalance = (employeeId, leaveType, balanceDays, allocatedDays, usedDays) =>
  api('set_leave_balance', {
    employee_id: employeeId,
    leave_type: leaveType,
    balance_days: balanceDays,
    allocated_days: allocatedDays,
    used_days: usedDays,
  })

export const decideAttendanceCorrection = (correctionId, decision, reason) =>
  api('decide_attendance_correction', { correctionId, decision, reason })

export const inviteAdmin = (email, redirectTo) => api('invite', { email, redirectTo })
export const inviteEmployee = (employeeId, redirectTo) => api('invite_employee', { employeeId, redirectTo })

// Secure document operations
export async function getDocumentDownloadUrl(storagePath) {
  if (!storagePath) throw new Error('Storage path is required.')
  const client = requireClient()
  try {
    const { data, error } = await client.storage.from('employee-documents').createSignedUrl(storagePath, 300)
    if (!error && data?.signedUrl) return data.signedUrl
  } catch {
    // Fall back to server-side signed URL generation
  }
  const res = await api('get_document_url', { path: storagePath })
  return res.signedUrl
}

export async function uploadEmployeeDocument(employeeId, file, documentType = 'other', documentName = '', expiryDate = null) {
  if (!file) throw new Error('A file is required.')
  if (!employeeId) throw new Error('Employee ID is required.')

  const client = requireClient()
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const storagePath = `${employeeId}/${Date.now()}_${sanitizedName}`

  let directUploadSuccess = false

  try {
    const { error: uploadError } = await client.storage
      .from('employee-documents')
      .upload(storagePath, file, { cacheControl: '3600', upsert: false })

    if (!uploadError) {
      directUploadSuccess = true
    }
  } catch (clientErr) {
    console.warn('Direct storage upload failed, attempting Edge Function upload:', clientErr)
  }

  if (directUploadSuccess) {
    return await saveRecord('employee_documents', {
      employee_id: employeeId,
      document_name: documentName.trim() || file.name,
      document_type: documentType,
      storage_path: storagePath,
      expiry_date: expiryDate || null,
      file_size: file.size,
      mime_type: file.type || 'application/octet-stream',
    })
  }

  // Fallback to secure server-side upload via workly-api edge function
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const base64Data = typeof result === 'string' && result.includes(',') ? result.split(',')[1] : result
      resolve(base64Data)
    }
    reader.onerror = (err) => reject(err)
    reader.readAsDataURL(file)
  })

  const res = await api('upload_document', {
    employee_id: employeeId,
    file_name: file.name,
    document_name: documentName.trim() || file.name,
    document_type: documentType,
    expiry_date: expiryDate || null,
    file_size: file.size,
    mime_type: file.type || 'application/octet-stream',
    file_base64: base64,
  })

  return res.data
}

export const deleteDocument = (documentId) => api('delete_document', { id: documentId })

export { emptyDashboard }
