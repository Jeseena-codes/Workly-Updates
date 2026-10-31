import { withSupabase } from 'npm:@supabase/server@1'
import nodemailer from 'npm:nodemailer@6.9.16'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const tableFields: Record<string, string[]> = {
  employees: ['employee_code', 'full_name', 'email', 'department', 'designation', 'status', 'joined_on', 'photo_path', 'date_of_birth', 'phone', 'address', 'emergency_contact', 'employment_type', 'probation_end', 'notice_period_days', 'reporting_manager_id', 'qualifications', 'skills', 'experience_summary', 'work_history', 'assigned_assets', 'custom_fields', 'account_status'],
  projects: ['project_code', 'name', 'description', 'manager_id', 'team_lead_id', 'status', 'risk_level', 'start_date', 'due_date', 'progress', 'cancelled_at'],
  tasks: ['project_id', 'assignee_id', 'assigned_by', 'title', 'description', 'status', 'start_date', 'due_date', 'priority', 'milestone_id', 'dependency_note', 'blocker_note', 'deliverable_url'],
  leave_requests: ['employee_id', 'leave_type', 'start_date', 'end_date', 'status', 'reason', 'day_portion', 'supporting_document_path', 'handover_information', 'emergency_contact', 'chargeable_days', 'decision_reason', 'policy_exception', 'flag_reason'],
  attendance_records: ['employee_id', 'attendance_date', 'check_in', 'check_out', 'work_mode', 'attendance_status', 'correction_reason', 'shift_name', 'break_minutes', 'overtime_minutes', 'total_work_minutes'],
  rewards: ['employee_id', 'reason', 'status', 'nominated_at', 'decision_reason'],
  calendar_events: ['project_id', 'title', 'description', 'event_type', 'starts_at', 'ends_at'],
  employee_documents: ['employee_id', 'document_name', 'document_type', 'storage_path', 'expiry_date', 'access_level', 'file_size', 'mime_type', 'uploaded_by'],
  leave_balances: ['employee_id', 'leave_type', 'allocated_days', 'used_days', 'balance_days'],
  departments: ['name'],
  designations: ['name'],
  project_members: ['project_id', 'employee_id', 'role_name'],
  project_milestones: ['project_id', 'title', 'due_date', 'status'],
  task_comments: ['task_id', 'body'],
  notification_preferences: ['event_name', 'delivery_channel', 'enabled', 'recipient_rule'],
}

const safeRecord = (table: string, values: Record<string, unknown>) => Object.fromEntries(
  tableFields[table].filter((field) => values[field] !== undefined).map((field) => [field, values[field]]),
)

// Universal server-side email dispatcher powered by Nodemailer
async function dispatchEmail(params: {
  to: string
  subject: string
  html: string
}) {
  const nodeEmailUrl = Deno.env.get('NODE_EMAIL_SERVICE_URL')
  if (nodeEmailUrl) {
    try {
      const res = await fetch(`${nodeEmailUrl.replace(/\/$/, '')}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (res.ok) {
        const data = await res.json()
        return { sent: true, provider: 'node_service', ...data }
      }
    } catch (e: any) {
      console.warn('[workly-api] Node email service failed, falling back to direct Nodemailer:', e.message)
    }
  }

  const smtpHost = Deno.env.get('SMTP_HOST')
  const smtpPort = Number(Deno.env.get('SMTP_PORT') || 587)
  const smtpUser = Deno.env.get('SMTP_USER')
  const smtpPass = Deno.env.get('SMTP_PASS')
  const fromEmail = Deno.env.get('SMTP_FROM') || Deno.env.get('WORKLY_FROM_EMAIL') || 'Workly HR <no-reply@workly.internal>'

  if (!smtpHost || !smtpUser || !smtpPass) {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (resendApiKey) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [params.to],
            subject: params.subject,
            html: params.html,
          }),
        })
        const data = await res.json()
        if (!res.ok) return { sent: false, error: data }
        return { sent: true, id: data?.id, provider: 'resend_fallback' }
      } catch (err: any) {
        return { sent: false, error: err.message }
      }
    }
    console.warn('[workly-api] Nodemailer SMTP configuration (SMTP_HOST, SMTP_USER, SMTP_PASS) not configured in server environment; skipping outbound email.')
    return { sent: false, reason: 'Nodemailer SMTP configuration (SMTP_HOST, SMTP_USER, SMTP_PASS) not configured in server environment' }
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465 || Deno.env.get('SMTP_SECURE') === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })

    const info = await transporter.sendMail({
      from: fromEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
    })

    return { sent: true, id: info.messageId, provider: 'nodemailer' }
  } catch (err: any) {
    console.error('[workly-api] Nodemailer exception:', err)
    return { sent: false, error: err.message }
  }
}

// Server-side email notification for leave submission
async function sendLeaveSubmissionEmail(params: {
  to: string
  employeeName: string
  leaveType: string
  startDate: string
  endDate: string
  requestedDays: number
  isFlagged: boolean
  flagReason?: string
  reason?: string
}) {
  const subject = params.isFlagged
    ? `Leave Request Submitted (Flagged for HR Review): ${params.leaveType} (${params.startDate} to ${params.endDate})`
    : `Leave Request Submitted: ${params.leaveType} (${params.startDate} to ${params.endDate})`

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="margin-bottom: 20px;">
        <span style="display: inline-block; background: #102455; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px;">WORKLY HR</span>
      </div>
      <h2 style="color: ${params.isFlagged ? '#d97706' : '#2563eb'}; margin: 0 0 12px; font-size: 20px;">
        Leave Request Submitted ${params.isFlagged ? '(Pending HR Review)' : ''}
      </h2>
      <p style="color: #2d3748; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        Dear <strong>${params.employeeName}</strong>,
      </p>
      <p style="color: #4a5568; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
        Your request for <strong>${params.leaveType}</strong> leave has been received and recorded in the Workly HR portal.
      </p>
      ${params.isFlagged ? `
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin: 16px 0; color: #92400e; font-size: 13px;">
        <strong>⚠️ Flagged for HR Review:</strong> ${params.flagReason || 'This request requires an HR Policy Exception review.'}
      </div>` : ''}
      <div style="background: #f7fafc; border: 1px solid #edf2f7; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0; color: #718096; width: 140px;">Leave Type:</td>
            <td style="padding: 6px 0; color: #1a202c; font-weight: 600;">${params.leaveType}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #718096;">Duration:</td>
            <td style="padding: 6px 0; color: #1a202c; font-weight: 600;">${params.startDate} to ${params.endDate} (${params.requestedDays} day(s))</td>
          </tr>
          ${params.reason ? `
          <tr>
            <td style="padding: 6px 0; color: #718096; vertical-align: top;">Reason:</td>
            <td style="padding: 6px 0; color: #1a202c;">${params.reason}</td>
          </tr>` : ''}
        </table>
      </div>
      <p style="color: #a0aec0; font-size: 12px; margin-top: 24px; border-top: 1px solid #edf2f7; padding-top: 16px;">
        This is an automated notification from Workly HR Administrator portal powered by Nodemailer.
      </p>
    </div>
  `

  return await dispatchEmail({ to: params.to, subject, html })
}

// Server-side email notification for leave decisions
async function sendLeaveDecisionEmail(params: {
  to: string
  employeeName: string
  decision: 'approved' | 'rejected'
  leaveType: string
  startDate: string
  endDate: string
  chargeableDays?: number
  remainingBalance?: number
  reason?: string
}) {
  const isApproved = params.decision === 'approved'
  const subject = isApproved
    ? `Leave Request Approved: ${params.leaveType} (${params.startDate} to ${params.endDate})`
    : `Leave Request Declined: ${params.leaveType} (${params.startDate} to ${params.endDate})`

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="margin-bottom: 20px;">
        <span style="display: inline-block; background: #102455; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px;">WORKLY HR</span>
      </div>
      <h2 style="color: ${isApproved ? '#0f897b' : '#c53030'}; margin: 0 0 12px; font-size: 20px;">
        Leave Request ${isApproved ? 'Approved' : 'Declined'}
      </h2>
      <p style="color: #2d3748; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        Dear <strong>${params.employeeName}</strong>,
      </p>
      <p style="color: #4a5568; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
        Your request for <strong>${params.leaveType}</strong> leave has been reviewed and ${isApproved ? 'approved' : 'declined'} by HR administration.
      </p>
      <div style="background: #f7fafc; border: 1px solid #edf2f7; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0; color: #718096; width: 140px;">Leave Type:</td>
            <td style="padding: 6px 0; color: #1a202c; font-weight: 600;">${params.leaveType}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #718096;">Duration:</td>
            <td style="padding: 6px 0; color: #1a202c; font-weight: 600;">${params.startDate} to ${params.endDate}</td>
          </tr>
          ${isApproved && params.chargeableDays !== undefined ? `
          <tr>
            <td style="padding: 6px 0; color: #718096;">Chargeable Days:</td>
            <td style="padding: 6px 0; color: #1a202c; font-weight: 600;">${params.chargeableDays} day(s)</td>
          </tr>` : ''}
          ${isApproved && params.remainingBalance !== undefined ? `
          <tr>
            <td style="padding: 6px 0; color: #718096;">Remaining Balance:</td>
            <td style="padding: 6px 0; color: #0f897b; font-weight: 600;">${params.remainingBalance} day(s)</td>
          </tr>` : ''}
          ${params.reason ? `
          <tr>
            <td style="padding: 6px 0; color: #718096; vertical-align: top;">Decision Note:</td>
            <td style="padding: 6px 0; color: #1a202c;">${params.reason}</td>
          </tr>` : ''}
        </table>
      </div>
      <p style="color: #a0aec0; font-size: 12px; margin-top: 24px; border-top: 1px solid #edf2f7; padding-top: 16px;">
        This is an automated notification from Workly HR Administrator portal powered by Nodemailer.
      </p>
    </div>
  `

  return await dispatchEmail({ to: params.to, subject, html })
}

export default {
  fetch: withSupabase({ auth: ['user', 'none'] }, async (request, ctx) => {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
    let body: any = {}
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON request body.' }, 400)
    }
    const authRes = await ctx.supabase.auth.getUser()
    const user = authRes?.data?.user
    if (!user) return json({ error: 'Authentication required.' }, 401)
    const { data: admin } = await ctx.supabaseAdmin.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle()
    if (!admin) return json({ error: 'Administrator access is required.' }, 403)
    const action = body?.action

    if (action === 'dashboard') {
      const [
        employees, projects, events, tasks, leaveRequests, attendance,
        rewards, documents, corrections, auditLogs, notifications, invitations, leaveBalances
      ] = await Promise.all([
        ctx.supabaseAdmin.from('employees').select('*'),
        ctx.supabaseAdmin.from('projects').select('*'),
        ctx.supabaseAdmin.from('calendar_events').select('*').order('starts_at'),
        ctx.supabaseAdmin.from('tasks').select('*'),
        ctx.supabaseAdmin.from('leave_requests').select('*').order('created_at', { ascending: false }),
        ctx.supabaseAdmin.from('attendance_records').select('*').order('attendance_date', { ascending: false }),
        ctx.supabaseAdmin.from('rewards').select('*').order('created_at', { ascending: false }),
        ctx.supabaseAdmin.from('employee_documents').select('*').order('expiry_date'),
        ctx.supabaseAdmin.from('attendance_corrections').select('*').order('created_at', { ascending: false }),
        ctx.supabaseAdmin.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50),
        ctx.supabaseAdmin.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
        ctx.supabaseAdmin.from('employee_invitations').select('*').order('created_at', { ascending: false }),
        ctx.supabaseAdmin.from('leave_balances').select('*'),
      ])

      const failed = [employees, projects, events, tasks, leaveRequests, attendance, rewards].find((result) => result.error)
      if (failed?.error) return json({ error: failed.error.message }, 400)

      return json({
        employees: employees.data,
        projects: projects.data,
        events: events.data,
        tasks: tasks.data,
        leaveRequests: leaveRequests.data,
        attendance: attendance.data,
        rewards: rewards.data,
        documents: documents.error ? [] : documents.data,
        corrections: corrections.error ? [] : corrections.data,
        auditLogs: auditLogs.error ? [] : auditLogs.data,
        notifications: notifications.error ? [] : notifications.data,
        invitations: invitations.error ? [] : invitations.data,
        leaveBalances: leaveBalances.error ? [] : leaveBalances.data,
      })
    }

    if (action === 'create' || action === 'update') {
      const { table, values, id } = body
      if (!tableFields[table] || !values || (action === 'update' && !id)) return json({ error: 'Invalid record request.' }, 400)
      const record = safeRecord(table, values)
      if (table === 'employees') {
        if (record.date_of_birth === '') record.date_of_birth = null
        if (record.joined_on === '') record.joined_on = null
        if (record.emergency_contact === '') record.emergency_contact = null
        else if (typeof record.emergency_contact === 'string' && record.emergency_contact.trim()) {
          record.emergency_contact = { name: record.emergency_contact.trim() }
        }
      }
      if (table === 'projects' && record.status === 'ongoing') {
        record.status = 'in_progress'
      }
      if (table === 'rewards') {
        if (!record.reason && (values.title || values.description)) {
          const t = String(values.title || '').trim()
          const d = String(values.description || '').trim()
          record.reason = t ? (d ? `${t}\n\n${d}` : t) : d
        }
        if (!record.nominated_at && values.reward_date) {
          record.nominated_at = values.reward_date
        }
      }
      if (table === 'leave_requests') {
        if (action === 'create') {
          record.status = 'pending'
          // Validate requested days against employee's available leave balance
          if (record.employee_id && record.leave_type && record.leave_type !== 'unpaid') {
            const { data: bal } = await ctx.supabaseAdmin
              .from('leave_balances')
              .select('balance_days')
              .eq('employee_id', record.employee_id)
              .eq('leave_type', record.leave_type)
              .maybeSingle()

            const remaining = Number(bal?.balance_days ?? 0)
            const requested = Number(record.chargeable_days || 1)
            if (requested > remaining) {
              record.policy_exception = true
              if (!record.flag_reason) {
                record.flag_reason = `Requested duration of ${requested} day(s) exceeds available balance of ${remaining} day(s).`
              }
            }
          }
        }
        if (action === 'update') delete record.status
      }
      if (table === 'rewards' && action === 'update' && ['approved', 'rejected'].includes(String(values.status))) {
        record.decided_by = user.id
        record.decided_at = new Date().toISOString()
      }
      const previous = action === 'update' ? await ctx.supabaseAdmin.from(table).select('*').eq('id', id).maybeSingle() : { data: null, error: null }
      if (previous.error || (action === 'update' && !previous.data)) return json({ error: 'The record was not found.' }, 404)

      // Strict validation for attendance records: check_out must be strictly later than check_in
      if (table === 'attendance_records') {
        const inTime = record.check_in !== undefined ? record.check_in : previous.data?.check_in
        const outTime = record.check_out !== undefined ? record.check_out : previous.data?.check_out
        if (inTime && outTime) {
          const inMs = new Date(String(inTime)).getTime()
          const outMs = new Date(String(outTime)).getTime()
          if (isNaN(inMs) || isNaN(outMs)) {
            return json({ error: 'Invalid check-in or check-out timestamp format.' }, 400)
          }
          if (outMs <= inMs) {
            return json({ error: 'Check-out time must be later than check-in time.' }, 400)
          }
          if (record.total_work_minutes === undefined) {
            record.total_work_minutes = Math.round((outMs - inMs) / (1000 * 60))
          }
        }
      }

      let query
      if (table === 'attendance_records' && action === 'create' && record.employee_id && record.attendance_date) {
        query = ctx.supabaseAdmin
          .from('attendance_records')
          .upsert(record, { onConflict: 'employee_id,attendance_date' })
          .select()
          .single()
      } else if (action === 'create') {
        query = ctx.supabaseAdmin.from(table).insert(record).select().single()
      } else {
        query = ctx.supabaseAdmin.from(table).update(record).eq('id', id).select().single()
      }
      const { data, error } = await query
      if (error) return json({ error: error.message }, 400)
      if (table === 'tasks' && action === 'update' && previous.data.assignee_id !== data.assignee_id) {
        await ctx.supabaseAdmin.from('task_reassignments').insert({ task_id: data.id, previous_assignee_id: previous.data.assignee_id, new_assignee_id: data.assignee_id, reason: String(values.reassignment_reason || 'Reassigned by administrator'), changed_by: user.id })
      }
      await ctx.supabaseAdmin.from('audit_logs').insert({ actor_id: user.id, action, module: table, record_id: data.id, previous_value: previous.data, new_value: data })

      // Outbound email notification when a leave request is submitted
      let emailNotification = undefined
      if (table === 'leave_requests' && action === 'create') {
        const { data: emp } = await ctx.supabaseAdmin
          .from('employees')
          .select('full_name, email')
          .eq('id', data.employee_id)
          .maybeSingle()

        if (emp?.email) {
          try {
            emailNotification = await sendLeaveSubmissionEmail({
              to: emp.email,
              employeeName: emp.full_name || 'Employee',
              leaveType: data.leave_type || 'Leave',
              startDate: data.start_date,
              endDate: data.end_date,
              requestedDays: Number(data.chargeable_days || 1),
              isFlagged: Boolean(data.policy_exception),
              flagReason: data.flag_reason,
              reason: data.reason,
            })
          } catch (mailErr: any) {
            console.warn('[workly-api] Leave submission email notification error:', mailErr)
            emailNotification = { sent: false, error: mailErr.message }
          }
        }
      }

      return json({ data, emailNotification }, action === 'create' ? 201 : 200)
    }

    if (action === 'decide_leave') {
      const requestId = String(body?.requestId || '')
      const decision = body?.decision
      const chargeableDays = Number(body?.chargeableDays)
      const policyException = Boolean(body?.policyException)
      if (!requestId || !['approved', 'rejected'].includes(decision) || !Number.isFinite(chargeableDays) || chargeableDays < 0) {
        return json({ error: 'A valid leave decision and chargeable-day value are required.' }, 400)
      }

      // Fetch request and employee info for email notification
      const { data: requestRow } = await ctx.supabaseAdmin.from('leave_requests')
        .select('*, employees(full_name, email)')
        .eq('id', requestId)
        .maybeSingle()

      const { data, error } = await ctx.supabaseAdmin.rpc('decide_leave_request', {
        p_request_id: requestId,
        p_decision: decision,
        p_chargeable_days: chargeableDays,
        p_reason: String(body?.reason || ''),
        p_actor_id: user.id,
        p_policy_exception: policyException,
      })
      if (error) return json({ error: error.message }, 400)

      await ctx.supabaseAdmin.from('audit_logs').insert({
        actor_id: user.id,
        action: decision,
        module: 'leave_requests',
        record_id: requestId,
        new_value: { ...data, policy_exception: policyException }
      })

      // Fetch updated remaining balance for employee
      const { data: updatedBal } = await ctx.supabaseAdmin
        .from('leave_balances')
        .select('*')
        .eq('employee_id', requestRow?.employee_id)
        .eq('leave_type', requestRow?.leave_type)
        .maybeSingle()

      // Send outbound email notification if employee email exists
      let emailNotification = { sent: false, reason: 'Employee email not found' }
      const emp = Array.isArray(requestRow?.employees) ? requestRow.employees[0] : requestRow?.employees
      const employeeEmail = emp?.email
      if (employeeEmail) {
        emailNotification = await sendLeaveDecisionEmail({
          to: employeeEmail,
          employeeName: emp?.full_name || 'Employee',
          decision,
          leaveType: requestRow?.leave_type || 'Leave',
          startDate: requestRow?.start_date,
          endDate: requestRow?.end_date,
          chargeableDays,
          remainingBalance: updatedBal?.balance_days !== undefined ? Number(updatedBal.balance_days) : undefined,
          reason: String(body?.reason || ''),
        })
      }

      return json({ data, emailNotification })
    }

    if (action === 'set_leave_balance') {
      const employeeId = String(body?.employee_id || '')
      const leaveType = String(body?.leave_type || '')
      const balanceDays = Number(body?.balance_days)
      const allocatedDays = body?.allocated_days !== undefined ? Number(body.allocated_days) : balanceDays
      const usedDays = body?.used_days !== undefined ? Number(body.used_days) : 0
      if (!employeeId || !leaveType || !Number.isFinite(balanceDays)) {
        return json({ error: 'Employee ID, leave type, and valid balance days are required.' }, 400)
      }
      const { data, error } = await ctx.supabaseAdmin.from('leave_balances').upsert({
        employee_id: employeeId,
        leave_type: leaveType,
        allocated_days: allocatedDays,
        used_days: usedDays,
        balance_days: balanceDays
      }, { onConflict: 'employee_id,leave_type' }).select().single()

      if (error) return json({ error: error.message }, 400)
      await ctx.supabaseAdmin.from('audit_logs').insert({
        actor_id: user.id,
        action: 'set_leave_balance',
        module: 'leave_balances',
        record_id: data.id,
        new_value: data
      })
      return json({ data })
    }

    if (action === 'upload_document') {
      const employeeId = String(body?.employee_id || '')
      const fileName = String(body?.file_name || 'document')
      const documentName = String(body?.document_name || fileName)
      const documentType = String(body?.document_type || 'other')
      const expiryDate = body?.expiry_date || null
      const mimeType = String(body?.mime_type || 'application/octet-stream')
      const fileSize = Number(body?.file_size || 0)
      const fileBase64 = String(body?.file_base64 || '')

      if (!employeeId || !fileBase64) {
        return json({ error: 'Employee ID and file content are required.' }, 400)
      }

      const binaryString = atob(fileBase64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
      const storagePath = `${employeeId}/${Date.now()}_${sanitizedName}`

      const { error: storageError } = await ctx.supabaseAdmin.storage
        .from('employee-documents')
        .upload(storagePath, bytes, {
          contentType: mimeType,
          upsert: true
        })

      if (storageError) {
        return json({ error: `Storage upload failed: ${storageError.message}` }, 400)
      }

      const { data, error: dbError } = await ctx.supabaseAdmin.from('employee_documents').insert({
        employee_id: employeeId,
        document_name: documentName,
        document_type: documentType,
        storage_path: storagePath,
        expiry_date: expiryDate,
        file_size: fileSize || bytes.length,
        mime_type: mimeType,
        uploaded_by: user.id
      }).select().single()

      if (dbError) {
        return json({ error: dbError.message }, 400)
      }

      await ctx.supabaseAdmin.from('audit_logs').insert({
        actor_id: user.id,
        action: 'upload_document',
        module: 'employee_documents',
        record_id: data.id,
        new_value: data
      })

      return json({ data }, 201)
    }

    if (action === 'get_document_url') {
      const path = String(body?.path || '')
      if (!path) return json({ error: 'Document storage path is required.' }, 400)
      const { data, error } = await ctx.supabaseAdmin.storage.from('employee-documents').createSignedUrl(path, 300)
      if (error) return json({ error: error.message }, 400)
      return json({ signedUrl: data.signedUrl })
    }

    if (action === 'delete_document') {
      const id = String(body?.id || '')
      if (!id) return json({ error: 'Document ID is required.' }, 400)
      const { data: doc } = await ctx.supabaseAdmin.from('employee_documents').select('*').eq('id', id).maybeSingle()
      if (doc?.storage_path) {
        try {
          await ctx.supabaseAdmin.storage.from('employee-documents').remove([doc.storage_path])
        } catch (storageErr) {
          console.warn('[workly-api] Storage remove warning:', storageErr)
        }
      }
      const { error } = await ctx.supabaseAdmin.from('employee_documents').delete().eq('id', id)
      if (error) return json({ error: error.message }, 400)
      await ctx.supabaseAdmin.from('audit_logs').insert({
        actor_id: user.id,
        action: 'delete_document',
        module: 'employee_documents',
        record_id: id,
        previous_value: doc
      })
      return json({ success: true })
    }

    if (action === 'decide_attendance_correction') {
      const correctionId = String(body?.correctionId || '')
      const decision = body?.decision
      if (!correctionId || !['approved', 'rejected'].includes(decision)) return json({ error: 'A valid attendance correction decision is required.' }, 400)
      const { data: correction, error: correctionError } = await ctx.supabaseAdmin.from('attendance_corrections').select('*').eq('id', correctionId).single()
      if (correctionError || correction.status !== 'pending') return json({ error: 'This correction request is unavailable for decision.' }, 400)
      if (decision === 'approved') {
        const { data: original } = await ctx.supabaseAdmin.from('attendance_records').select('*').eq('id', correction.attendance_record_id).single()
        const { data: updated, error: updateError } = await ctx.supabaseAdmin.from('attendance_records').update({ check_in: correction.requested_check_in, check_out: correction.requested_check_out, correction_reason: correction.reason }).eq('id', correction.attendance_record_id).select().single()
        if (updateError) return json({ error: updateError.message }, 400)
        await ctx.supabaseAdmin.from('audit_logs').insert({ actor_id: user.id, action: 'approve_correction', module: 'attendance_records', record_id: updated.id, previous_value: original, new_value: updated })
      }
      const { data, error } = await ctx.supabaseAdmin.from('attendance_corrections').update({ status: decision, decided_by: user.id, decided_at: new Date().toISOString(), decision_reason: String(body?.reason || '') }).eq('id', correctionId).select().single()
      if (error) return json({ error: error.message }, 400)
      return json({ data })
    }

    if (action === 'delete') {
      const { table, id } = body
      if (!tableFields[table] || !id) return json({ error: 'Invalid delete request.' }, 400)

      if (table === 'projects') {
        const { count } = await ctx.supabaseAdmin.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', id)
        if (count) return json({ error: 'This project cannot be deleted because it has related tasks. Close or reassign its tasks first.' }, 409)
      }

      if (table === 'employees') {
        const { count: taskCount } = await ctx.supabaseAdmin.from('tasks').select('id', { count: 'exact', head: true }).eq('assignee_id', id)
        const { count: projectCount } = await ctx.supabaseAdmin.from('projects').select('id', { count: 'exact', head: true }).or(`manager_id.eq.${id},team_lead_id.eq.${id}`)
        if (taskCount || projectCount) {
          return json({ error: 'Cannot delete employee while they are assigned to active tasks or managing projects. Please reassign those first.' }, 409)
        }

        const { count: leaveCount } = await ctx.supabaseAdmin.from('leave_requests').select('id', { count: 'exact', head: true }).eq('employee_id', id)
        const { count: attendanceCount } = await ctx.supabaseAdmin.from('attendance_records').select('id', { count: 'exact', head: true }).eq('employee_id', id)
        const { count: rewardCount } = await ctx.supabaseAdmin.from('rewards').select('id', { count: 'exact', head: true }).eq('employee_id', id)
        if (leaveCount || attendanceCount || rewardCount) {
          return json({ error: 'This employee has historical leave, attendance, or recognition records. To preserve compliance and audit history, change their status to "Exited" instead of deleting.' }, 409)
        }

        // Set reporting_manager_id to null for reportees so self-referential foreign keys don't block
        await ctx.supabaseAdmin.from('employees').update({ reporting_manager_id: null }).eq('reporting_manager_id', id)

        // Clean up linked dependencies and remove physical files from storage
        const { data: docs } = await ctx.supabaseAdmin.from('employee_documents').select('storage_path').eq('employee_id', id)
        if (docs && docs.length) {
          const paths = docs.map((d: any) => d.storage_path).filter(Boolean)
          if (paths.length) {
            try {
              await ctx.supabaseAdmin.storage.from('employee-documents').remove(paths)
            } catch (storageErr) {
              console.warn('[workly-api] Storage remove warning:', storageErr)
            }
          }
        }
        await ctx.supabaseAdmin.from('employee_documents').delete().eq('employee_id', id)
        await ctx.supabaseAdmin.from('leave_balances').delete().eq('employee_id', id)
        await ctx.supabaseAdmin.from('employee_invitations').delete().eq('employee_id', id)
        await ctx.supabaseAdmin.from('project_members').delete().eq('employee_id', id)
      }

      const { data: previous } = await ctx.supabaseAdmin.from(table).select('*').eq('id', id).maybeSingle()
      const { error } = await ctx.supabaseAdmin.from(table).delete().eq('id', id)
      if (error) return json({ error: error.message }, 400)
      await ctx.supabaseAdmin.from('audit_logs').insert({ actor_id: user.id, action: 'delete', module: table, record_id: id, previous_value: previous })
      return json({ success: true })
    }

    if (action === 'invite') {
      const email = String(body?.email || '').trim().toLowerCase()
      if (!email) return json({ error: 'Email is required.' }, 400)
      const { data, error } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo: body?.redirectTo })
      if (error) return json({ error: error.message }, 400)
      await ctx.supabaseAdmin.from('admin_invitations').upsert({ email, invited_by: user.id })
      await ctx.supabaseAdmin.from('audit_logs').insert({ actor_id: user.id, action: 'invite', module: 'admin_invitations', new_value: { email } })
      return json({ data }, 201)
    }

    if (action === 'invite_employee') {
      const employeeId = String(body?.employeeId || '')
      const { data: employee, error: employeeError } = await ctx.supabaseAdmin.from('employees').select('id,email,full_name').eq('id', employeeId).single()
      if (employeeError || !employee?.email) return json({ error: 'A valid employee with an email address is required.' }, 400)
      const { data, error } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(employee.email, { redirectTo: body?.redirectTo })
      if (error) return json({ error: error.message }, 400)
      await ctx.supabaseAdmin.from('employee_invitations').insert({ employee_id: employee.id, email: employee.email, invited_by: user.id })
      await ctx.supabaseAdmin.from('employees').update({ account_status: 'invited' }).eq('id', employee.id)
      await ctx.supabaseAdmin.from('audit_logs').insert({ actor_id: user.id, action: 'invite_employee', module: 'employees', record_id: employee.id, new_value: { email: employee.email } })
      return json({ data }, 201)
    }

    return json({ error: 'Unknown action.' }, 400)
  }),
}
