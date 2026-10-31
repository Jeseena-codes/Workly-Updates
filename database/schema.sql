-- Workly baseline schema. This creates structure only; it deliberately inserts no sample records.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE employee_status AS ENUM ('active', 'on_leave', 'exited'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE project_status AS ENUM ('upcoming', 'in_progress', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'in_review', 'completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE calendar_event_type AS ENUM ('meeting', 'review', 'milestone'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reward_status AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  department TEXT,
  designation TEXT,
  status employee_status NOT NULL DEFAULT 'active',
  joined_on DATE,
  phone TEXT,
  address TEXT,
  emergency_contact JSONB,
  date_of_birth DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  status project_status NOT NULL DEFAULT 'upcoming',
  risk_level TEXT NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('normal', 'at_risk', 'overdue')),
  start_date DATE,
  due_date DATE,
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  assignee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status task_status NOT NULL DEFAULT 'pending',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status leave_status NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  event_type calendar_event_type NOT NULL DEFAULT 'meeting',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  work_mode TEXT NOT NULL DEFAULT 'office' CHECK (work_mode IN ('office', 'remote', 'hybrid')),
  attendance_status TEXT NOT NULL DEFAULT 'present' CHECK (attendance_status IN ('present', 'late', 'half_day', 'absent')),
  correction_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  status reward_status NOT NULL DEFAULT 'pending',
  nominated_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calendar_events_starts_at_idx ON calendar_events(starts_at);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON leave_requests(status);
CREATE INDEX IF NOT EXISTS attendance_records_date_idx ON attendance_records(attendance_date);

CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  document_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  storage_path TEXT,
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL,
  balance_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type)
);

CREATE TABLE IF NOT EXISTS admin_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_id UUID,
  previous_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Baseline HR detail.  Every statement is additive so existing cloud records remain intact.
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS designations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact JSONB;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notice_period_days INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS reporting_manager_id UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS skills TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS experience_summary TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS assigned_assets JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'not_invited';

ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES employee_documents(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS mime_type TEXT;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_lead_id UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  role_name TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, employee_id)
);
CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES project_milestones(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dependency_note TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocker_note TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deliverable_url TEXT;
CREATE TABLE IF NOT EXISTS task_reassignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  previous_assignee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  new_assignee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS day_portion TEXT NOT NULL DEFAULT 'full_day';
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS supporting_document_path TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS handover_information TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS emergency_contact JSONB;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS chargeable_days NUMERIC(6,2);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS decision_reason TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS policy_exception BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS flag_reason TEXT;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS allocated_days NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS used_days NUMERIC(6,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS leave_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  chargeable_days NUMERIC(6,2),
  reason TEXT,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id UUID NOT NULL REFERENCES attendance_records(id) ON DELETE RESTRICT,
  requested_check_in TIMESTAMPTZ,
  requested_check_out TIMESTAMPTZ,
  reason TEXT NOT NULL,
  status leave_status NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rewards ADD COLUMN IF NOT EXISTS nominated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS decision_reason TEXT;
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  delivery_channel TEXT NOT NULL CHECK (delivery_channel IN ('in_app', 'email')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recipient_rule TEXT NOT NULL,
  UNIQUE (event_name, delivery_channel, recipient_rule)
);

CREATE TABLE IF NOT EXISTS employee_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'revoked', 'accepted', 'expired')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS shift_name TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS total_work_minutes INTEGER;
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_check_times;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_check_times CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in);

CREATE INDEX IF NOT EXISTS employee_documents_expiry_idx ON employee_documents(expiry_date);
CREATE INDEX IF NOT EXISTS task_reassignments_task_idx ON task_reassignments(task_id);
CREATE INDEX IF NOT EXISTS attendance_corrections_status_idx ON attendance_corrections(status);
CREATE INDEX IF NOT EXISTS audit_logs_module_created_idx ON audit_logs(module, created_at DESC);
CREATE INDEX IF NOT EXISTS employee_invitations_employee_idx ON employee_invitations(employee_id, created_at DESC);

-- Atomic leave decision: approval history and the balance update commit together.
CREATE OR REPLACE FUNCTION public.decide_leave_request(
  p_request_id UUID,
  p_decision leave_status,
  p_chargeable_days NUMERIC,
  p_reason TEXT,
  p_actor_id UUID,
  p_policy_exception BOOLEAN DEFAULT FALSE
) RETURNS leave_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE request_row leave_requests;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected'; END IF;
  SELECT * INTO request_row FROM leave_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF request_row.status <> 'pending' THEN RAISE EXCEPTION 'Only pending leave requests can be decided'; END IF;
  IF p_chargeable_days IS NULL OR p_chargeable_days < 0 THEN RAISE EXCEPTION 'Chargeable leave days must be zero or more'; END IF;
  IF p_decision = 'approved' AND request_row.leave_type <> 'unpaid' THEN
    INSERT INTO leave_balances (employee_id, leave_type, allocated_days, used_days, balance_days)
    VALUES (request_row.employee_id, request_row.leave_type, 0, p_chargeable_days, -p_chargeable_days)
    ON CONFLICT (employee_id, leave_type)
    DO UPDATE SET
      used_days = COALESCE(leave_balances.used_days, 0) + p_chargeable_days,
      balance_days = leave_balances.balance_days - p_chargeable_days;
  END IF;
  UPDATE leave_requests SET status = p_decision, chargeable_days = p_chargeable_days,
    decision_reason = p_reason, decided_by = p_actor_id, decided_at = NOW(),
    policy_exception = COALESCE(p_policy_exception, FALSE)
  WHERE id = p_request_id RETURNING * INTO request_row;
  INSERT INTO leave_decisions (leave_request_id, decision, chargeable_days, reason, decided_by)
  VALUES (p_request_id, p_decision, p_chargeable_days, p_reason, p_actor_id);
  RETURN request_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_workly_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid()) $$;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_reassignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage employees" ON employees;
DROP POLICY IF EXISTS "admins manage projects" ON projects;
DROP POLICY IF EXISTS "admins manage tasks" ON tasks;
DROP POLICY IF EXISTS "admins manage leave" ON leave_requests;
DROP POLICY IF EXISTS "admins manage events" ON calendar_events;
DROP POLICY IF EXISTS "admins manage attendance" ON attendance_records;
DROP POLICY IF EXISTS "admins manage rewards" ON rewards;
DROP POLICY IF EXISTS "admins manage documents" ON employee_documents;
DROP POLICY IF EXISTS "admins manage balances" ON leave_balances;
DROP POLICY IF EXISTS "admins manage invitations" ON admin_invitations;
DROP POLICY IF EXISTS "admins read audit logs" ON audit_logs;
DROP POLICY IF EXISTS "admins read notifications" ON notifications;
DROP POLICY IF EXISTS "admins manage departments" ON departments;
DROP POLICY IF EXISTS "admins manage designations" ON designations;
DROP POLICY IF EXISTS "admins manage project members" ON project_members;
DROP POLICY IF EXISTS "admins manage milestones" ON project_milestones;
DROP POLICY IF EXISTS "admins manage task reassignments" ON task_reassignments;
DROP POLICY IF EXISTS "admins manage task comments" ON task_comments;
DROP POLICY IF EXISTS "admins manage leave decisions" ON leave_decisions;
DROP POLICY IF EXISTS "admins manage attendance corrections" ON attendance_corrections;
DROP POLICY IF EXISTS "admins manage notification preferences" ON notification_preferences;
DROP POLICY IF EXISTS "admins manage employee invitations" ON employee_invitations;

CREATE POLICY "admins manage employees" ON employees FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage projects" ON projects FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage tasks" ON tasks FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage leave" ON leave_requests FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage events" ON calendar_events FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage attendance" ON attendance_records FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage rewards" ON rewards FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage documents" ON employee_documents FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage balances" ON leave_balances FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage invitations" ON admin_invitations FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins read audit logs" ON audit_logs FOR SELECT TO authenticated USING (public.is_workly_admin());
CREATE POLICY "admins read notifications" ON notifications FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage departments" ON departments FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage designations" ON designations FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage project members" ON project_members FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage milestones" ON project_milestones FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage task reassignments" ON task_reassignments FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage task comments" ON task_comments FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage leave decisions" ON leave_decisions FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage attendance corrections" ON attendance_corrections FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage notification preferences" ON notification_preferences FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());
CREATE POLICY "admins manage employee invitations" ON employee_invitations FOR ALL TO authenticated USING (public.is_workly_admin()) WITH CHECK (public.is_workly_admin());

-- Storage setup for Employee Documents (Private Bucket)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-documents',
  'employee-documents',
  false,
  20971520,
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520;

DROP POLICY IF EXISTS "Admin upload employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Admin read employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Admin update employee documents" ON storage.objects;

CREATE POLICY "Admin upload employee documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-documents' AND public.is_workly_admin());

CREATE POLICY "Admin read employee documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'employee-documents' AND public.is_workly_admin());

CREATE POLICY "Admin delete employee documents" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'employee-documents' AND public.is_workly_admin());

CREATE POLICY "Admin update employee documents" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'employee-documents' AND public.is_workly_admin())
  WITH CHECK (bucket_id = 'employee-documents' AND public.is_workly_admin());
