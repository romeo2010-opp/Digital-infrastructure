const roleLabels: Record<string, string> = {
  super_admin: 'Super Admin',
  school_owner: 'School Owner',
  director: 'Director',
  owner: 'School Owner',
  headteacher: 'Headteacher',
  deputy_headteacher: 'Deputy Headteacher',
  admin_teacher: 'Admin Teacher',
  academic_coordinator: 'Academic Coordinator',
  exams_officer: 'Exams Officer',
  bursar: 'Bursar',
  librarian: 'Librarian',
  teacher: 'Teacher',
  parent: 'Parent',
  student: 'Student',
}

export function formatRoleLabel(value: any, fallback = 'School Administrator') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!normalized) return fallback
  if (roleLabels[normalized]) return roleLabels[normalized]
  return normalized
    .split('_')
    .filter(Boolean)
    .map((word) => ['ai', 'hr', 'ict', 'it'].includes(word) ? word.toUpperCase() : `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export function roleLabelFor(user: any, fallback = 'School Administrator') {
  const value = user?.roleDisplayName || user?.role_display_name || user?.roleName || user?.role_name || user?.role || user?.role_code
  return formatRoleLabel(value, fallback)
}
