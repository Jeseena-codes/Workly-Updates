s-- Migration 01: Employee Management & Leave Management Enhancements
-- Safe and idempotent: can be run repeatedly without data loss.

-- 1. Storage setup for Employee Documents (Private Bucket)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-documents',
  'employee-documents',
  false,
  20971520, -- 20MB limit
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520;

-- Storage object policies for authenticated Workly administrators
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

-- 2. Ensure all relevant employee fields exist
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

-- 3. Ensure document metadata table has full columns
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'admin';

-- 4. Ensure leave requests policy_exception and flag_reason columns exist
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS policy_exception BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS flag_reason TEXT;

-- 4b. Ensure leave balances tracks allocated_days and used_days
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS allocated_days NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS used_days NUMERIC(6,2) NOT NULL DEFAULT 0;

-- 5. Updated decide_leave_request function with policy exception & balanced tracking support
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
  
  UPDATE leave_requests SET
    status = p_decision,
    chargeable_days = p_chargeable_days,
    decision_reason = p_reason,
    decided_by = p_actor_id,
    decided_at = NOW(),
    policy_exception = COALESCE(p_policy_exception, FALSE)
  WHERE id = p_request_id RETURNING * INTO request_row;
  
  INSERT INTO leave_decisions (leave_request_id, decision, chargeable_days, reason, decided_by)
  VALUES (p_request_id, p_decision, p_chargeable_days, p_reason, p_actor_id);
  
  RETURN request_row;
END;
$$;

-- 6. Attendance check constraint: check_out must be strictly later than check_in
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_check_times;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_check_times CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in);
