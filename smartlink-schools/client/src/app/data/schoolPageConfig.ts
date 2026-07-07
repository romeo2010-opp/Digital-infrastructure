export type SchoolPageKey =
  | 'classes'
  | 'students'
  | 'fees'
  | 'attendance'
  | 'homework'
  | 'results'
  | 'assessmentInsights'
  | 'examBuilder'
  | 'dailyDrill'
  | 'examForecast'
  | 'messages'
  | 'parents'
  | 'reports'

export const schoolPages: Record<SchoolPageKey, {
  title: string
  subtitle: string
  action: string
  columns: Array<{ key: string; label: string }>
  sideTitle: string
  sideItems: Array<{ label: string; value: string; detail: string }>
}> = {
  classes: {
    title: 'Classes',
    subtitle: 'Class setup, assigned teachers and learner lists inside each class.',
    action: 'Create class',
    columns: [
      { key: 'className', label: 'Class' },
      { key: 'gradeLevel', label: 'Grade' },
      { key: 'classTeacher', label: 'Class Teacher' },
      { key: 'studentCount', label: 'Students' },
    ],
    sideTitle: 'Class Controls',
    sideItems: [
      { label: 'Create classes', value: 'Headteacher', detail: 'Headteachers and owners can add new classes.' },
      { label: 'Student lists', value: 'Visible', detail: 'Each class row includes learners currently assigned to it.' },
      { label: 'Teacher scope', value: 'Enforced', detail: 'Teachers only see the classes assigned to them.' },
    ],
  },
  students: {
    title: 'Students',
    subtitle: 'Student registry, profiles, guardians, fee status and academic summaries.',
    action: 'Add student',
    columns: [
      { key: 'student', label: 'Student' },
      { key: 'className', label: 'Class' },
      { key: 'streamSection', label: 'Stream' },
      { key: 'admissionNo', label: 'Admission No.' },
      { key: 'guardianPhone', label: 'Guardian Phone' },
      { key: 'feeBalance', label: 'Fee Balance' },
      { key: 'status', label: 'Status' },
    ],
    sideTitle: 'Profile Checks',
    sideItems: [
      { label: 'Class scope', value: 'Live', detail: 'Teachers only see assigned class learners.' },
      { label: 'Fee link', value: 'Live', detail: 'Balances come from fee accounts.' },
      { label: 'Admissions', value: 'Ready', detail: 'New learners can be added by leadership.' },
    ],
  },
  fees: {
    title: 'Fees',
    subtitle: 'Balances, payment recording, receipt history and parent reminders.',
    action: 'Record payment',
    columns: [
      { key: 'student', label: 'Student' },
      { key: 'className', label: 'Class' },
      { key: 'termName', label: 'Term' },
      { key: 'balance', label: 'Balance' },
      { key: 'status', label: 'Status' },
    ],
    sideTitle: 'Reminder Queue',
    sideItems: [
      { label: 'Outstanding balances', value: 'Live', detail: 'Calculated from database fee accounts.' },
      { label: 'Receipts', value: 'Ready', detail: 'Payments create receipt records.' },
      { label: 'Bursar review', value: 'Active', detail: 'Bursars and leadership can post payments.' },
    ],
  },
  attendance: {
    title: 'Attendance',
    subtitle: 'Daily class register with present, absent, late and sick states.',
    action: 'Save register',
    columns: [
      { key: 'student', label: 'Student' },
      { key: 'className', label: 'Class' },
      { key: 'date', label: 'Date' },
      { key: 'status', label: 'Status' },
      { key: 'note', label: 'Note' },
    ],
    sideTitle: 'Attendance Actions',
    sideItems: [
      { label: 'Teacher scope', value: 'Enforced', detail: 'Teachers can only mark their classes.' },
      { label: 'Parent alerts', value: 'Ready', detail: 'Absence messages can be queued.' },
      { label: 'Daily register', value: 'Live', detail: 'Rows are loaded from attendance records.' },
    ],
  },
  homework: {
    title: 'Homework',
    subtitle: 'Teacher assignments, due dates, completion tracking and parent reminders.',
    action: 'Create homework',
    columns: [
      { key: 'assignment', label: 'Assignment' },
      { key: 'className', label: 'Class' },
      { key: 'subject', label: 'Subject' },
      { key: 'due', label: 'Due' },
      { key: 'assigned', label: 'Assigned' },
      { key: 'submitted', label: 'Submitted' },
      { key: 'status', label: 'Status' },
    ],
    sideTitle: 'Teacher Queue',
    sideItems: [
      { label: 'Due work', value: 'Live', detail: 'Assignments load from the database.' },
      { label: 'Class scope', value: 'Enforced', detail: 'Teachers create work for their classes only.' },
      { label: 'Reminders', value: 'Ready', detail: 'Use messages to notify parents.' },
    ],
  },
  results: {
    title: 'Results',
    subtitle: 'Marks entry, report-card summaries and academic progress review.',
    action: 'Enter marks',
    columns: [
      { key: 'assessment', label: 'Assessment' },
      { key: 'examSession', label: 'Exam Session' },
      { key: 'className', label: 'Class' },
      { key: 'subject', label: 'Subject' },
      { key: 'average', label: 'Average' },
      { key: 'markedStudents', label: 'Marked' },
    ],
    sideTitle: 'Academic Review',
    sideItems: [
      { label: 'Averages', value: 'Live', detail: 'Calculated from assessment topic marks.' },
      { label: 'Reports', value: 'Ready', detail: 'Use reports to prepare exports.' },
      { label: 'Teacher scope', value: 'Enforced', detail: 'Teachers see their assessment classes.' },
    ],
  },
  assessmentInsights: {
    title: 'Assessment Insights',
    subtitle: 'Weak-topic analysis and AI-assisted support recommendations.',
    action: 'Generate insights',
    columns: [
      { key: 'subject', label: 'Subject' },
      { key: 'topic', label: 'Topic' },
      { key: 'average', label: 'Average' },
      { key: 'support', label: 'Support' },
      { key: 'recommendation', label: 'Recommendation' },
    ],
    sideTitle: 'Recommendations',
    sideItems: [
      { label: 'Weak topics', value: 'Live', detail: 'Loaded from assessment topic summaries.' },
      { label: 'Support plans', value: 'Ready', detail: 'Generate a focused teacher review.' },
      { label: 'Difficulty', value: 'Calculated', detail: 'Easy, medium and hard come from scores.' },
    ],
  },
  examBuilder: {
    title: 'Assessment Builder',
    subtitle: 'Exam metadata, topics tested, marks per topic and difficulty review.',
    action: 'Create assessment',
    columns: [
      { key: 'assessment', label: 'Assessment' },
      { key: 'examSession', label: 'Exam Session' },
      { key: 'className', label: 'Class' },
      { key: 'subject', label: 'Subject' },
      { key: 'termName', label: 'Term' },
      { key: 'totalMarks', label: 'Marks' },
    ],
    sideTitle: 'Assessment Setup',
    sideItems: [
      { label: 'Topic tagging', value: 'Ready', detail: 'Starter topics are saved with assessments.' },
      { label: 'Teacher classes', value: 'Scoped', detail: 'Teachers only create assessments for assigned classes.' },
      { label: 'Difficulty', value: 'Medium', detail: 'Default difficulty can be reviewed later.' },
    ],
  },
  dailyDrill: {
    title: 'Daily Drill',
    subtitle: 'Short personalized practice from weak topics for primary learners.',
    action: 'Generate drills',
    columns: [
      { key: 'student', label: 'Student' },
      { key: 'className', label: 'Class' },
      { key: 'topic', label: 'Weak Topic' },
      { key: 'drill', label: 'Drill' },
      { key: 'status', label: 'Status' },
    ],
    sideTitle: 'Practice Modes',
    sideItems: [
      { label: 'Drills', value: 'Live', detail: 'Loaded from daily drill records.' },
      { label: 'Scores', value: 'Tracked', detail: 'Scores show completed drill performance.' },
      { label: 'Teacher scope', value: 'Enforced', detail: 'Teacher view follows assigned learners.' },
    ],
  },
  examForecast: {
    title: 'Exam Forecast',
    subtitle: 'Rule-based topic priority using frequency, marks, recency and class weakness.',
    action: 'Run forecast',
    columns: [
      { key: 'track', label: 'Track' },
      { key: 'subject', label: 'Subject' },
      { key: 'topic', label: 'Topic' },
      { key: 'score', label: 'Priority Score' },
      { key: 'action', label: 'Action' },
    ],
    sideTitle: 'Formula',
    sideItems: [
      { label: 'Frequency', value: '30%', detail: 'Past-paper topic count' },
      { label: 'Marks Weight', value: '25%', detail: 'Expected exam value' },
      { label: 'Weakness', value: '25%', detail: 'School/class performance' },
    ],
  },
  messages: {
    title: 'Messages',
    subtitle: 'Parent and staff communication for fees, homework, attendance and announcements.',
    action: 'Compose',
    columns: [
      { key: 'subject', label: 'Subject' },
      { key: 'type', label: 'Type' },
      { key: 'audience', label: 'Audience' },
      { key: 'responsible', label: 'Responsible' },
      { key: 'channel', label: 'Channel' },
      { key: 'status', label: 'Status' },
      { key: 'time', label: 'Time' },
    ],
    sideTitle: 'Message Types',
    sideItems: [
      { label: 'Announcements', value: 'Ready', detail: 'Send school or class notices.' },
      { label: 'Fee reminders', value: 'Ready', detail: 'Use fee balances for follow-up.' },
      { label: 'Attendance alerts', value: 'Ready', detail: 'Notify guardians when needed.' },
    ],
  },
  parents: {
    title: 'Parents',
    subtitle: 'Guardian contacts, linked children and communication preferences.',
    action: 'Add parent',
    columns: [
      { key: 'parent', label: 'Parent' },
      { key: 'student', label: 'Linked Student' },
      { key: 'className', label: 'Class' },
      { key: 'phone', label: 'Phone' },
      { key: 'relationship', label: 'Relationship' },
    ],
    sideTitle: 'Guardian Data',
    sideItems: [
      { label: 'Contacts', value: 'Live', detail: 'Loaded from parent-student links.' },
      { label: 'Messaging', value: 'Ready', detail: 'Use compose message for outreach.' },
      { label: 'Teacher scope', value: 'Enforced', detail: 'Teachers see linked guardians for their learners.' },
    ],
  },
  reports: {
    title: 'Reports',
    subtitle: 'Academic, attendance, fee arrears and leadership summaries.',
    action: 'Create report',
    columns: [
      { key: 'report', label: 'Report' },
      { key: 'scope', label: 'Scope' },
      { key: 'value', label: 'Value' },
      { key: 'status', label: 'Status' },
    ],
    sideTitle: 'Report Controls',
    sideItems: [
      { label: 'Exports', value: 'Ready', detail: 'Prepare report requests from live data.' },
      { label: 'Scope', value: 'Role based', detail: 'Teacher reports stay class-scoped.' },
      { label: 'Leadership', value: 'Ready', detail: 'Headteacher views whole-school summaries.' },
    ],
  },
}
