import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Award,
  BarChart3,
  Bell,
  Brain,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Crown,
  FileText,
  Flame,
  HelpCircle,
  Heart,
  HeartHandshake,
  Home,
  Lightbulb,
  Lock,
  LogOut,
  Medal,
  Minus,
  NotebookTabs,
  Phone,
  RefreshCcw,
  Smile,
  Sparkles,
  ThumbsUp,
  TrendingUp,
  Trophy,
  UserCircle2,
  Volume2,
  Wallet,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { usePortal } from "../lib/portalContext";
import { resolvePortalAssetUrl } from "../lib/portalApi";

type PortalView =
  | "home"
  | "results"
  | "fees"
  | "homework"
  | "attendance"
  | "timetable"
  | "drills"
  | "ranking"
  | "notices"
  | "profile"
  | "insights"
  | "plus";
type PayFlowStep = "none" | "select" | "confirm" | "success";

const subjectColors = [
  "#185FA5",
  "#1D9E75",
  "#534AB7",
  "#888780",
  "#BA7517",
  "#D85A30",
];

const bottomNav: Array<{ id: PortalView; label: string; icon: any }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "results", label: "Results", icon: BarChart3 },
  { id: "fees", label: "Fees", icon: Wallet },
  { id: "homework", label: "Homework", icon: NotebookTabs },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
];

const secondaryNav: Array<{
  id?: PortalView;
  action?: "download" | "refresh";
  label: string;
  icon: any;
}> = [
  { id: "timetable", label: "Schedule", icon: CalendarDays },
  { id: "drills", label: "Practice", icon: Brain },
  { id: "ranking", label: "Ranking", icon: Trophy },
  { id: "notices", label: "Notices", icon: Bell },
  { id: "profile", label: "Profile", icon: UserCircle2 },
  { id: "plus", label: "Plus", icon: Crown },
  { action: "download", label: "Report PDF", icon: FileText },
  { action: "refresh", label: "Sync", icon: RefreshCcw },
];

const desktopNavGroups: Array<{
  label: string;
  items: Array<{ id: PortalView; label: string; icon: any }>;
}> = [
  { label: "Overview", items: [{ id: "home", label: "Home", icon: Home }] },
  {
    label: "Academic",
    items: [
      { id: "results", label: "Results", icon: BarChart3 },
      { id: "homework", label: "Homework", icon: NotebookTabs },
      { id: "drills", label: "Daily drills", icon: Brain },
      { id: "ranking", label: "Ranking", icon: Trophy },
      { id: "attendance", label: "Attendance", icon: CalendarCheck },
      { id: "timetable", label: "Timetable", icon: Clock },
    ],
  },
  {
    label: "Finance",
    items: [{ id: "fees", label: "Fees & payments", icon: Wallet }],
  },
  {
    label: "Updates",
    items: [
      { id: "notices", label: "Notices", icon: Bell },
      { id: "profile", label: "Profile", icon: UserCircle2 },
    ],
  },
];

const celebrationStyles: Record<
  string,
  { badge: string; gradient: string; iconText: string; icon: any; accent: any }
> = {
  first_drill: {
    badge: "First drill",
    gradient: "from-[#16A34A] via-[#22C55E] to-[#0F766E]",
    iconText: "text-[#15803D]",
    icon: Sparkles,
    accent: Check,
  },
  streak_started: {
    badge: "Streak started",
    gradient: "from-[#F97316] via-[#F59E0B] to-[#B45309]",
    iconText: "text-[#C2410C]",
    icon: Flame,
    accent: Trophy,
  },
  rank_climb: {
    badge: "Rank climb",
    gradient: "from-[#2563EB] via-[#7C3AED] to-[#4338CA]",
    iconText: "text-[#4F46E5]",
    icon: TrendingUp,
    accent: ArrowUpRight,
  },
  default: {
    badge: "Daily Drill",
    gradient: "from-[#334155] via-[#475569] to-[#111827]",
    iconText: "text-[#334155]",
    icon: Medal,
    accent: Trophy,
  },
};

const viewTitles: Record<PortalView, string> = {
  home: "Overview",
  results: "Academic results",
  fees: "Fees & payments",
  homework: "Homework",
  attendance: "Attendance",
  timetable: "Timetable",
  drills: "Daily drills",
  ranking: "Class ranking",
  notices: "Notices",
  profile: "Personal profile",
  insights: "Family insights",
  plus: "SmartLink Plus",
};

function money(value: any, compact = false) {
  const number = Number(value || 0);
  if (!compact || Math.abs(number) < 10000)
    return `MK ${number.toLocaleString()}`;
  if (Math.abs(number) >= 1000000)
    return `MK ${(number / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  return `MK ${(number / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}

function percent(value: any, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? `${number.toFixed(1).replace(/\.0$/, "")}%`
    : String(value);
}

function dateLabel(value: any) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString([], {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function shortDate(value: any) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function timeLabel(value: any) {
  return value ? String(value).slice(0, 5) : "";
}

function valueLabel(value: any) {
  return String(value || "-")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initialsFor(profile: any, fallback: any) {
  const name =
    profile?.full_name || fallback?.fullName || fallback?.email || "Student";
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function photoUrlFor(profile: any) {
  return resolvePortalAssetUrl(
    profile?.profile_photo_url || profile?.profilePhotoUrl || "",
  );
}

function StudentAvatar({
  profile,
  user,
  className = "size-9",
  textClassName = "text-[12px]",
}: {
  profile: any;
  user: any;
  className?: string;
  textClassName?: string;
}) {
  const photoUrl = photoUrlFor(profile);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  return (
    <div
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#042C53] font-medium text-[#B5D4F4] ${className} ${textClassName}`}
    >
      {photoUrl && !failed ? (
        <img
          src={photoUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initialsFor(profile, user)
      )}
    </div>
  );
}

function gradeClass(grade: any, score: any) {
  const text = String(grade || "").toUpperCase();
  const number = Number(score || 0);
  if (text === "ABSENT") return "bg-[#F1F5F9] text-[#475569]";
  if (text.startsWith("A") || number >= 80)
    return "bg-[#E1F5EE] text-[#085041]";
  if (text.startsWith("B") || number >= 70)
    return "bg-[#E6F1FB] text-[#0C447C]";
  if (text.startsWith("C") || number >= 50)
    return "bg-[#FAEEDA] text-[#633806]";
  return "bg-[#FCEBEB] text-[#791F1F]";
}

function homeworkClass(status: any) {
  const text = String(status || "").toLowerCase();
  if (text.includes("overdue")) return "bg-[#FCEBEB] text-[#791F1F]";
  if (
    text.includes("submitted") ||
    text.includes("marked") ||
    text.includes("done")
  )
    return "bg-[#E1F5EE] text-[#085041]";
  return "bg-[#FAEEDA] text-[#633806]";
}

function paymentPercent(fees: any) {
  const due = Number(fees?.summary?.total_due || 0);
  if (!due) return 0;
  return Math.max(
    0,
    Math.min(100, (Number(fees?.summary?.amount_paid || 0) / due) * 100),
  );
}

function buildAttendanceCalendar(records: any[] = []) {
  const latest =
    records[0]?.attendance_date || new Date().toISOString().slice(0, 10);
  const anchor = new Date(`${String(latest).slice(0, 10)}T00:00:00`);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const firstOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDate = new Map(
    records.map((record) => [
      String(record.attendance_date).slice(0, 10),
      record.status,
    ]),
  );
  const cells: Array<{
    day?: number;
    status?: string;
    date?: string;
    empty?: boolean;
  }> = [];
  for (let i = 0; i < firstOffset; i += 1) cells.push({ empty: true });
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, date, status: byDate.get(date) || "" });
  }
  while (cells.length % 7 !== 0) cells.push({ empty: true });
  return {
    label: anchor.toLocaleDateString([], { month: "long", year: "numeric" }),
    cells,
  };
}

function groupByDate(rows: any[] = []) {
  return rows.reduce((groups: Array<{ label: string; rows: any[] }>, row) => {
    const label = dateLabel(row.exam_date);
    const group = groups.find((item) => item.label === label);
    if (group) group.rows.push(row);
    else groups.push({ label, rows: [row] });
    return groups;
  }, []);
}

function drillQuestionAnswered(question: any) {
  return (
    Boolean(question?.answered_at) ||
    (question?.student_answer !== null &&
      question?.student_answer !== undefined &&
      String(question.student_answer).trim() !== "")
  );
}

function questionOptions(question: any) {
  const rawOptions = Array.isArray(question?.options_json)
    ? question.options_json
    : [];
  if (rawOptions.length) {
    return rawOptions.map((option: any, index: number) => {
      if (option && typeof option === "object") {
        const value = String(
          option.value || option.id || option.label || option.text || index + 1,
        );
        return {
          value,
          label: String(option.label || option.text || option.value || value),
          text: String(option.text),
        };
      }
      return { value: String(option), label: String(option) };
    });
  }
  if (
    String(question?.question_type || "")
      .toLowerCase()
      .includes("true")
  ) {
    return [
      { value: "true", label: "True" },
      { value: "false", label: "False" },
    ];
  }
  return [];
}

function drillQuestionTables(question: any) {
  const tables = Array.isArray(question?.tables) ? question.tables : [];
  return tables.slice(0, 12).map((table: any, tableIndex: number) => {
    const sourceCells = Array.isArray(table?.cells) ? table.cells : [];
    const columns = Math.min(
      12,
      Math.max(
        1,
        Number(table?.columns || 0),
        ...sourceCells.map((row: any) => (Array.isArray(row) ? row.length : 0)),
      ),
    );
    const rows = Math.min(
      60,
      Math.max(1, Number(table?.rows || 0), sourceCells.length),
    );
    const cells = Array.from({ length: rows }, (_, rowIndex) =>
      Array.from({ length: columns }, (_, columnIndex) => {
        const value = sourceCells[rowIndex]?.[columnIndex];
        if (value === null || value === undefined) return "";
        if (typeof value === "object") {
          return String(value.text ?? value.value ?? value.label ?? "");
        }
        return String(value);
      }),
    );
    return {
      tableId: String(table?.table_id || table?.tableId || `table-${tableIndex + 1}`),
      caption: String(table?.caption || table?.title || "").trim(),
      headerRow:
        table?.header_row === true ||
        table?.headerRow === true ||
        table?.header_row === 1 ||
        table?.headerRow === 1 ||
        String(table?.header_row ?? table?.headerRow ?? "").toLowerCase() ===
          "true",
      cells,
    };
  });
}

function drillScoreTone(value: any) {
  const number = Number(value || 0);
  if (number >= 70) return "text-[#0F6E56]";
  if (number >= 50) return "text-[#BA7517]";
  return "text-[#993C1D]";
}

function drillAnswerReview(question: any) {
  const maxMarks = Math.max(1, Number(question?.marks || 1));
  const hasMarks =
    question?.marks_awarded !== null && question?.marks_awarded !== undefined;
  const marksAwarded = hasMarks ? Number(question.marks_awarded || 0) : null;
  const fullCredit =
    question?.is_correct === 1 ||
    question?.is_correct === true ||
    (marksAwarded !== null && marksAwarded >= maxMarks);
  const partialCredit = !fullCredit && marksAwarded !== null && marksAwarded > 0;
  if (fullCredit) {
    return {
      label: "Correct",
      badgeClass: "bg-[#E1F5EE] text-[#085041]",
      panelClass: "border-[#C7EBDD] bg-[#F1FBF6] text-[#085041]",
      feedback:
        question?.ai_feedback ||
        "Nice work. Your answer matches the expected idea.",
      marksAwarded,
      maxMarks,
    };
  }
  if (partialCredit) {
    return {
      label: "Partly right",
      badgeClass: "bg-[#FFF4D8] text-[#8A5A00]",
      panelClass: "border-[#F3D58A] bg-[#FFF9E8] text-[#6F4A00]",
      feedback:
        question?.ai_feedback ||
        "You have part of the idea. Add more detail to make the answer complete.",
      marksAwarded,
      maxMarks,
    };
  }
  return {
    label:
      question?.mistake_type === "teacher_review_required"
        ? "Teacher review"
        : "Needs work",
    badgeClass: "bg-[#FCEBEB] text-[#791F1F]",
    panelClass: "border-[#F1CACA] bg-[#FFF4F4] text-[#791F1F]",
    feedback:
      question?.ai_feedback ||
      "Review the explanation below, then try to connect your answer to the main idea.",
    marksAwarded,
    maxMarks,
  };
}

function StatCard({
  label,
  value,
  suffix,
  sub,
  tone = "neutral",
  small = false,
}: {
  label: string;
  value: any;
  suffix?: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
  small?: boolean;
}) {
  const toneClass =
    tone === "positive"
      ? "text-[#0F6E56]"
      : tone === "negative"
        ? "text-[#993C1D]"
        : "text-[#77756f]";
  return (
    <div className="rounded-[8px] bg-[#F1F0EA] p-3">
      <div className="mb-1 text-[10px] text-[#6f6d67]">{label}</div>
      <div
        className={`${small ? "text-[15px]" : "text-[20px]"} font-medium leading-none text-[#20201d]`}
      >
        {value}
        {suffix ? (
          <span className="text-[11px] text-[#6f6d67]">{suffix}</span>
        ) : null}
      </div>
      {sub ? (
        <div className={`mt-1 text-[10px] ${toneClass}`}>{sub}</div>
      ) : null}
    </div>
  );
}

function Card({
  title,
  action,
  children,
  onAction,
}: {
  title?: string;
  action?: string;
  children: any;
  onAction?: () => void;
}) {
  return (
    <section className="mb-2.5 rounded-[12px] border border-[#DFDDD5] bg-white px-3.5 py-3">
      {title ? (
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-[#20201d]">
            {title}
          </span>
          {action ? (
            <button
              type="button"
              onClick={onAction}
              className="text-[11px] font-medium text-[#185FA5]"
            >
              {action}
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function SubjectRow({ subject, index }: { subject: any; index: number }) {
  const score = subject.total_percent ?? subject.score;
  const absent = Boolean(subject.absent) || String(subject.status || subject.entry_status || "").toLowerCase() === "absent";
  return (
    <div className="flex items-center gap-2 border-b border-[#E7E5DE] py-2 text-[12px] last:border-b-0">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: subjectColors[index % subjectColors.length] }}
      />
      <span className="min-w-0 flex-1 truncate text-[#20201d]">
        {subject.subject_name || subject.name || "Subject"}
      </span>
      <span className="min-w-10 text-right font-medium text-[#20201d]">
        {absent ? "Absent" : percent(score)}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${gradeClass(subject.grade, score)}`}
      >
        {absent ? "Absent" : subject.grade || "-"}
      </span>
    </div>
  );
}

function HomeworkRow({ item }: { item: any }) {
  const status = item.submission_status || item.status || "pending";
  const iconTone =
    status === "overdue"
      ? "bg-[#FCEBEB] text-[#791F1F]"
      : status === "submitted" || status === "late"
        ? "bg-[#E1F5EE] text-[#085041]"
        : "bg-[#E6F1FB] text-[#0C447C]";
  return (
    <div className="flex items-start gap-2.5 border-b border-[#E7E5DE] py-2 last:border-b-0">
      <div
        className={`grid size-[26px] shrink-0 place-items-center rounded-[6px] ${iconTone}`}
      >
        <BookOpen className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-[#20201d]">
          {item.subject_name || "Subject"}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[#6f6d67]">
          {item.title || item.instructions || "-"}
        </div>
        <div
          className={`mt-1 text-[10px] ${status === "overdue" ? "text-[#E24B4A]" : "text-[#0F6E56]"}`}
        >
          Due {shortDate(item.due_date)}
        </div>
      </div>
      <span
        className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${homeworkClass(status)}`}
      >
        {valueLabel(status)}
      </span>
    </div>
  );
}

function NoticeRow({ notice, index }: { notice: any; index: number }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-[#E7E5DE] py-2 last:border-b-0">
      <span
        className="mt-1 size-1.5 shrink-0 rounded-full"
        style={{ background: subjectColors[index % subjectColors.length] }}
      />
      <div className="min-w-0">
        <div className="line-clamp-1 text-[12px] font-medium text-[#20201d]">
          {notice.title}
        </div>
        <div className="mt-0.5 line-clamp-3 text-[11px] leading-4 text-[#6f6d67]">
          {notice.body || notice.type}
        </div>
        <div className="mt-0.5 text-[10px] text-[#8c8982]">
          {dateLabel(notice.date)}
        </div>
      </div>
    </div>
  );
}

function announcementApiId(value: any) {
  return String(value || "").replace(/^message-/, "");
}

function AnnouncementCard({
  announcement,
  api,
  token,
  canRespond = true,
}: {
  announcement: any;
  api: any;
  token: string;
  canRespond?: boolean;
}) {
  const pollOptions = Array.isArray(announcement.poll?.options)
    ? announcement.poll.options
    : [];
  const reactions =
    Array.isArray(announcement.reactions) && announcement.reactions.length
      ? announcement.reactions
      : ["Like", "Love", "Seen"];
  const [reaction, setReaction] = useState(announcement.my_reaction || "");
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(
    announcement.reaction_counts || {},
  );
  const [pollVote, setPollVote] = useState(announcement.poll_vote || "");
  const [pollResults, setPollResults] = useState<Record<string, number>>(
    announcement.poll_results || {},
  );
  const reactionIcons: Record<string, any> = {
    Like: ThumbsUp,
    Love: Heart,
    Seen: Smile,
  };
  const imageUrl = resolvePortalAssetUrl(
    announcement.image_url || announcement.imageUrl || "",
  );

  useEffect(() => {
    setReaction(announcement.my_reaction || "");
    setReactionCounts(announcement.reaction_counts || {});
    setPollVote(announcement.poll_vote || "");
    setPollResults(announcement.poll_results || {});
  }, [announcement]);

  const chooseReaction = async (value: string) => {
    const next = reaction === value ? "" : value;
    const previous = reaction;
    setReaction(next);
    setReactionCounts((current) => ({
      ...current,
      ...(previous
        ? { [previous]: Math.max(0, Number(current[previous] || 0) - 1) }
        : {}),
      ...(next ? { [next]: Number(current[next] || 0) + 1 } : {}),
    }));
    try {
      const payload = await api.reactToAnnouncement(
        token,
        announcementApiId(announcement.id),
        { reaction: next },
      );
      setReaction(payload?.announcement?.my_reaction || next);
      setReactionCounts(payload?.announcement?.reaction_counts || {});
    } catch (error: any) {
      setReaction(previous);
      toast.error(error?.message || "Unable to save reaction.");
    }
  };

  const choosePoll = async (value: string) => {
    const previous = pollVote;
    const previousResults = pollResults;
    setPollVote(value);
    setPollResults((current) => ({
      ...current,
      ...(previous
        ? { [previous]: Math.max(0, Number(current[previous] || 0) - 1) }
        : {}),
      [value]: Number(current[value] || 0) + 1,
    }));
    try {
      const payload = await api.voteAnnouncementPoll(
        token,
        announcementApiId(announcement.id),
        { option_id: value },
      );
      setPollVote(payload?.announcement?.poll_vote || value);
      setPollResults(payload?.announcement?.poll_results || {});
    } catch (error: any) {
      setPollVote(previous);
      setPollResults(previousResults);
      toast.error(error?.message || "Unable to save poll vote.");
    }
  };

  return (
    <article className="overflow-hidden rounded-[10px] border border-[#DFDDD5] bg-white">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="h-36 w-full object-cover lg:h-44"
        />
      ) : null}
      <div className="grid gap-3 p-3">
        <div>
          <div className="text-[12px] font-semibold text-[#20201d]">
            {announcement.title}
          </div>
          <div className="mt-1 text-[11px] leading-4 text-[#6f6d67]">
            {announcement.body || "-"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-medium text-[#8c8982]">
            <span>{dateLabel(announcement.date)}</span>
            {announcement.responsible_teacher_name ? (
              <span>Responsible: {announcement.responsible_teacher_name}</span>
            ) : null}
          </div>
        </div>

        {canRespond ? <div className="flex flex-wrap gap-1.5">
          {reactions.map((item: string) => {
            const Icon = reactionIcons[item] || ThumbsUp;
            const active = reaction === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => chooseReaction(item)}
                className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[10px] font-medium ${
                  active
                    ? "border-[#185FA5] bg-[#E6F1FB] text-[#0C447C]"
                    : "border-[#DFDDD5] bg-[#F8F7F2] text-[#6f6d67]"
                }`}
              >
                <Icon className="size-3" />
                {item}
                {Number(reactionCounts[item] || 0) ? (
                  <span>{Number(reactionCounts[item] || 0)}</span>
                ) : null}
              </button>
            );
          })}
        </div> : null}

        {announcement.poll?.question && pollOptions.length ? (
          <div className="rounded-[8px] border border-[#DFDDD5] bg-[#F8F7F2] p-2.5">
            <div className="mb-2 text-[11px] font-semibold text-[#20201d]">
              {announcement.poll.question}
            </div>
            <div className="grid gap-1.5">
              {pollOptions.map((option: any, index: number) => {
                const optionId = String(option.id || `option-${index + 1}`);
                const selected = pollVote === optionId;
                return (
                  <button
                    key={optionId}
                    type="button"
                    onClick={() => canRespond && choosePoll(optionId)}
                    disabled={!canRespond}
                    className={`flex items-center justify-between rounded-[7px] border px-2.5 py-2 text-left text-[11px] font-medium ${
                      selected
                        ? "border-[#185FA5] bg-white text-[#0C447C]"
                        : "border-[#E7E5DE] bg-white text-[#20201d]"
                    }`}
                  >
                    <span>{String(option.text || option)}</span>
                    {selected ? (
                      <Check className="size-3.5 text-[#185FA5]" />
                    ) : null}
                    {pollVote && Number(pollResults[optionId] || 0) ? (
                      <span className="ml-2 text-[10px] text-[#64748b]">
                        {Number(pollResults[optionId] || 0)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {!pollVote && canRespond ? (
              <div className="mt-2 text-[10px] font-medium text-[#8c8982]">
                Vote to see the results.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function LockRow({
  icon: Icon,
  label,
  active,
  free = false,
}: {
  icon: any;
  label: string;
  active?: boolean;
  free?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[#E7E5DE] py-2 last:border-b-0">
      <div
        className={`grid size-[26px] shrink-0 place-items-center rounded-[6px] ${free || active ? "bg-[#E1F5EE] text-[#085041]" : "bg-[#EEEDFE] text-[#3C3489]"}`}
      >
        <Icon className="size-3.5" />
      </div>
      <span className="min-w-0 flex-1 text-[12px] text-[#6f6d67]">{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${free || active ? "bg-[#E1F5EE] text-[#085041]" : "bg-[#EEEDFE] text-[#3C3489]"}`}
      >
        {free ? "Free" : active ? "Active" : "Plus"}
      </span>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-[#D4D1C7] px-3 py-6 text-center text-[12px] text-[#77756f]">
      {label}
    </div>
  );
}

function speechTextChunks(text: string) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = `${current} ${sentence}`.trim();
    if (next.length > 180 && current) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function naturalVoiceScore(voice: SpeechSynthesisVoice) {
  const name = `${voice.name} ${voice.voiceURI} ${voice.lang}`.toLowerCase();
  let score = 0;
  if (/^en/i.test(voice.lang)) score += 30;
  if (name.includes("natural")) score += 60;
  if (name.includes("neural")) score += 55;
  if (name.includes("online")) score += 35;
  if (name.includes("google")) score += 28;
  if (name.includes("microsoft")) score += 24;
  if (/(aria|jenny|guy|samantha|daniel|serena|zira|sonia|moira|tessa|karen|ava)/i.test(name)) score += 18;
  if (voice.localService) score += 4;
  return score;
}

function pickNaturalVoice(voices: SpeechSynthesisVoice[]) {
  return voices
    .filter((voice) => /^en/i.test(voice.lang || "") || /english/i.test(voice.name || ""))
    .sort((a, b) => naturalVoiceScore(b) - naturalVoiceScore(a))[0] || voices.sort((a, b) => naturalVoiceScore(b) - naturalVoiceScore(a))[0] || null;
}

function AiExplanationResponse({
  text,
  gradeName,
  onFlag,
  flagging,
}: {
  text: string;
  gradeName?: string;
  onFlag: () => void;
  flagging: boolean;
}) {
  const { api, token } = usePortal();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [visibleText, setVisibleText] = useState("");
  const [typing, setTyping] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [generatingSpeech, setGeneratingSpeech] = useState(false);
  const [speechMode, setSpeechMode] = useState<"neural" | "device" | "">("");
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    const fullText = String(text || "");
    let index = 0;
    const step = fullText.length > 360 ? 3 : fullText.length > 180 ? 2 : 1;
    setVisibleText("");
    setTyping(Boolean(fullText));
    if (!fullText) return undefined;
    const timer = window.setInterval(() => {
      index = Math.min(fullText.length, index + step);
      setVisibleText(fullText.slice(0, index));
      if (index >= fullText.length) {
        window.clearInterval(timer);
        setTyping(false);
      }
    }, 18);
    return () => window.clearInterval(timer);
  }, [text]);

  useEffect(() => {
    if (!speechSupported) return undefined;
    const synth = window.speechSynthesis;
    const loadVoices = () => setVoices(synth.getVoices());
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);
    return () => {
      synth.removeEventListener?.("voiceschanged", loadVoices);
      synth.cancel();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, [speechSupported]);

  const stopSpeech = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (speechSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setGeneratingSpeech(false);
    setSpeechMode("");
  };

  const playDeviceSpeech = () => {
    if (!speechSupported) {
      toast.error("Text to speech is not available in this browser.");
      return;
    }
    const synth = window.speechSynthesis;
    if (speaking) {
      stopSpeech();
      return;
    }
    const chunks = speechTextChunks(text);
    if (!chunks.length) return;
    const voice = pickNaturalVoice(voices.length ? voices : synth.getVoices());
    let chunkIndex = 0;
    setSpeaking(true);
    setSpeechMode("device");
    synth.cancel();
    const speakNext = () => {
      const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || "en-GB";
      utterance.rate = 0.92;
      utterance.pitch = 1.04;
      utterance.volume = 1;
      utterance.onend = () => {
        chunkIndex += 1;
        if (chunkIndex < chunks.length) speakNext();
        else setSpeaking(false);
      };
      utterance.onerror = () => setSpeaking(false);
      synth.speak(utterance);
    };
    speakNext();
  };

  const readAloud = async () => {
    if (speaking || generatingSpeech) {
      stopSpeech();
      return;
    }
    if (!token) {
      playDeviceSpeech();
      return;
    }
    setGeneratingSpeech(true);
    try {
      const payload = await api.synthesizeExplanationSpeech(token, { text, grade_name: gradeName || "" });
      const audio = new Audio(`data:${payload?.mime_type || "audio/wav"};base64,${payload.audio_base64}`);
      audioRef.current = audio;
      setSpeechMode("neural");
      setSpeaking(true);
      audio.onended = () => {
        setSpeaking(false);
        setSpeechMode("");
        audioRef.current = null;
      };
      audio.onerror = () => {
        setSpeaking(false);
        setSpeechMode("");
        audioRef.current = null;
        toast.error("Natural voice is unavailable right now.");
      };
      await audio.play();
    } catch {
      toast.error("Natural voice is unavailable right now.");
    } finally {
      setGeneratingSpeech(false);
    }
  };

  return (
    <div className="mt-2 overflow-hidden rounded-[8px] border border-[#D7E8DA] bg-white shadow-[0_10px_28px_rgba(24,95,165,0.08)]">
      <div className="flex items-center justify-between gap-2 border-b border-[#EDF2EA] bg-[#F7FBF7] px-2.5 py-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#0F6E56]">
          SmartLink AI
        </span>
        <button
          type="button"
          onClick={readAloud}
          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#CFE3D5] bg-white px-2 text-[10px] font-medium text-[#0F6E56] transition hover:border-[#0F6E56] disabled:opacity-60"
          disabled={!text}
        >
          {speaking || generatingSpeech ? <Square className="size-3" /> : <Volume2 className="size-3" />}
          {generatingSpeech ? "Preparing..." : speaking ? "Stop" : "Read aloud"}
        </button>
      </div>
      {speechMode === "neural" ? (
        <div className="border-b border-[#EDF2EA] bg-[#FBFDFB] px-2.5 py-1 text-[10px] font-medium text-[#6f6d67]">
          Natural voice
        </div>
      ) : null}
      <div className="px-2.5 py-2 text-[11px] leading-5 text-[#20201d]">
        <span>{visibleText}</span>
        {typing ? (
          <span className="ml-0.5 inline-block h-3 w-px translate-y-0.5 animate-pulse bg-[#185FA5]" />
        ) : null}
      </div>
      <div className="flex items-center justify-end border-t border-[#EDF2EA] px-2.5 py-2">
        <button
          type="button"
          onClick={onFlag}
          disabled={flagging}
          className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-[#F1D2C4] px-2 text-[10px] font-medium text-[#A04420] disabled:opacity-60"
        >
          <AlertCircle className="size-3" />
          Flag
        </button>
      </div>
    </div>
  );
}

export function StudentPortalPage() {
  const { api, token, user, logout, data } = usePortal();
  const isParent = String(user?.role || "").toLowerCase() === "parent";
  const [payload, setPayload] = useState<any>(null);
  const [selectedStudentRef, setSelectedStudentRef] = useState("");
  const [activeView, setActiveView] = useState<PortalView>("home");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [openingReportId, setOpeningReportId] = useState<any>(null);
  const [drillPayload, setDrillPayload] = useState<any>(null);
  const [drillHistory, setDrillHistory] = useState<any[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillAnswers, setDrillAnswers] = useState<Record<string, string>>({});
  const [drillExplanations, setDrillExplanations] = useState<
    Record<string, any>
  >({});
  const [drillAction, setDrillAction] = useState("");
  const [showDrillResults, setShowDrillResults] = useState(false);
  const [plusActive, setPlusActive] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem("smartlink.schools.plus.active") === "true"
    );
  });
  const [payStep, setPayStep] = useState<PayFlowStep>("none");
  const [selectedMethod, setSelectedMethod] = useState("Airtel Money");
  const [celebrationOverlay, setCelebrationOverlay] = useState<any>(null);
  const [celebrationQueue, setCelebrationQueue] = useState<any[]>([]);
  const queuedCelebrationKeysRef = useRef<Set<string>>(new Set());

  const cacheKey = useMemo(() => {
    const id = user?.studentId || user?.studentCode || user?.id || "student";
    const learner = isParent ? selectedStudentRef || "linked" : "self";
    return `smartlink.schools.studentPortal.${id}.${learner}`;
  }, [isParent, selectedStudentRef, user?.id, user?.studentCode, user?.studentId]);

  const drillCacheKey = useMemo(() => {
    const id = user?.studentId || user?.studentCode || user?.id || "student";
    return `smartlink.schools.studentDrills.${id}`;
  }, [user?.id, user?.studentCode, user?.studentId]);

  const loadPortal = async ({ silent = false } = {}) => {
    if (!token) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [response, insightResponse] = await Promise.all([
        api.getStudentPortal(token, isParent ? selectedStudentRef || undefined : undefined),
        isParent
          ? api.getParentAcademicInsights(token, selectedStudentRef ? { student_ref: selectedStudentRef } : {}).catch(() => ({ students: [] }))
          : Promise.resolve({ students: [] }),
      ]);
      const nextPayload = response?.student_portal || response;
      const resolvedStudentRef = String(
        nextPayload?.viewer?.guardian_context?.selected_student_ref || "",
      );
      if (isParent) {
        const familyEntry = (insightResponse?.students || []).find(
          (entry: any) => String(entry?.student?.public_ref || "") === resolvedStudentRef,
        );
        nextPayload.family_insights = familyEntry?.insights || [];
        if (resolvedStudentRef && resolvedStudentRef !== selectedStudentRef) {
          setSelectedStudentRef(resolvedStudentRef);
        }
      }
      setPayload(nextPayload);
      setOffline(false);
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify(nextPayload));
      } catch {
        // Local storage can be unavailable in private browsing.
      }
    } catch (loadError: any) {
      const message = loadError?.message || "Unable to load student portal.";
      setError(message);
      try {
        const cached = window.localStorage.getItem(cacheKey);
        if (cached) {
          setPayload(JSON.parse(cached));
          setOffline(true);
        } else {
          toast.error(message);
        }
      } catch {
        toast.error(message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadTodayDrill = async ({ silent = false } = {}) => {
    if (!token) return;
    if (!silent) setDrillLoading(true);
    try {
      const [todayResponse, historyResponse] = await Promise.all([
        api.getTodayDrill(token),
        api.getDrillHistory(token).catch(() => ({ sessions: [] })),
      ]);
      const nextPayload = {
        ...(todayResponse || {}),
        history: historyResponse?.sessions || [],
      };
      setDrillPayload(nextPayload);
      setDrillHistory(historyResponse?.sessions || []);
      try {
        window.localStorage.setItem(drillCacheKey, JSON.stringify(nextPayload));
      } catch {
        // Drill cache is best effort only.
      }
    } catch (drillError: any) {
      try {
        const cached = window.localStorage.getItem(drillCacheKey);
        if (cached) {
          const cachedPayload = JSON.parse(cached);
          setDrillPayload(cachedPayload);
          setDrillHistory(cachedPayload?.history || []);
          return;
        }
      } catch {
        // Ignore malformed cache.
      }
      toast.error(drillError?.message || "Unable to load today's drill.");
    } finally {
      setDrillLoading(false);
    }
  };

  useEffect(() => {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        setPayload(JSON.parse(cached));
        setOffline(true);
      }
    } catch {
      // Ignore malformed cache.
    }
    loadPortal({ silent: Boolean(payload) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, token]);

  useEffect(() => {
    if (!data?.studentPortal || isParent) return;
    setPayload(data.studentPortal);
    setOffline(false);
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(data.studentPortal));
    } catch {
      // Local storage can be unavailable in private browsing.
    }
  }, [cacheKey, data?.studentPortal, isParent]);

  useEffect(() => {
    if (isParent) {
      setDrillPayload(null);
      setDrillHistory([]);
      return;
    }
    try {
      const cached = window.localStorage.getItem(drillCacheKey);
      if (cached) {
        const cachedPayload = JSON.parse(cached);
        setDrillPayload(cachedPayload);
        setDrillHistory(cachedPayload?.history || []);
      }
    } catch {
      // Ignore malformed cache.
    }
    loadTodayDrill({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillCacheKey, isParent, token]);

  const profile = payload?.profile || {};
  const results = payload?.results || {
    reports: [],
    latest_report: null,
    performance_trends: [],
  };
  const latestReport = results.latest_report || null;
  const latestSubjects = latestReport?.subjects || [];
  const fees = payload?.fees || { summary: {}, accounts: [], payments: [] };
  const homework = payload?.homework?.assignments || [];
  const attendance = payload?.attendance || {
    summary: {},
    records: [],
    absences: [],
  };
  const timetable = payload?.timetable?.entries || [];
  const notices = payload?.notices?.items || [];
  const ranking = payload?.ranking || {
    leaderboard: [],
    movements: [],
    awards: [],
    summary: {},
  };
  const guardianContext = payload?.viewer?.guardian_context || {};
  const availableStudents = Array.isArray(guardianContext.available_students)
    ? guardianContext.available_students
    : [];
  const activeStudentRef = selectedStudentRef || String(guardianContext.selected_student_ref || "");
  const familyInsights = Array.isArray(payload?.family_insights)
    ? payload.family_insights
    : [];
  const visibleSecondaryNav = isParent
    ? [
        { id: "insights" as PortalView, label: "Insights", icon: HeartHandshake },
        { id: "timetable" as PortalView, label: "Schedule", icon: CalendarDays },
        { id: "notices" as PortalView, label: "Notices", icon: Bell },
        { id: "profile" as PortalView, label: "Profile", icon: UserCircle2 },
        { action: "download" as const, label: "Report PDF", icon: FileText },
        { action: "refresh" as const, label: "Sync", icon: RefreshCcw },
      ]
    : secondaryNav;
  const visibleDesktopNavGroups = isParent
    ? [
        { label: "Overview", items: [{ id: "home" as PortalView, label: "Home", icon: Home }] },
        {
          label: "Learning",
          items: [
            { id: "results" as PortalView, label: "Results", icon: BarChart3 },
            { id: "homework" as PortalView, label: "Homework", icon: NotebookTabs },
            { id: "attendance" as PortalView, label: "Attendance", icon: CalendarCheck },
            { id: "timetable" as PortalView, label: "Timetable", icon: Clock },
            { id: "insights" as PortalView, label: "Family insights", icon: HeartHandshake },
          ],
        },
        { label: "Finance", items: [{ id: "fees" as PortalView, label: "Fees & payments", icon: Wallet }] },
        {
          label: "Updates",
          items: [
            { id: "notices" as PortalView, label: "Notices", icon: Bell },
            { id: "profile" as PortalView, label: "Learner profile", icon: UserCircle2 },
          ],
        },
      ]
    : desktopNavGroups;
  const currentRankingRow =
    (ranking.leaderboard || []).find((row: any) => row.is_current_student) ||
    null;
  const rankingCelebrations = Array.isArray(ranking.celebrations)
    ? ranking.celebrations
    : Array.isArray(currentRankingRow?.celebrations)
      ? currentRankingRow.celebrations
      : [];
  const rankingCelebrationKeys = rankingCelebrations
    .map((event: any) => event?.key)
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (isParent || !rankingCelebrations.length || typeof window === "undefined") return;
    const unseenEvents = rankingCelebrations.filter((event: any) => {
      const key = String(event?.key || "");
      if (!key || queuedCelebrationKeysRef.current.has(key)) return false;
      const storageKey = `smartlink.schools.celebration.${key}`;
      let alreadySeen = false;
      try {
        alreadySeen = window.localStorage.getItem(storageKey) === "seen";
      } catch {
        alreadySeen = false;
      }
      if (alreadySeen) return false;
      queuedCelebrationKeysRef.current.add(key);
      return true;
    });
    if (unseenEvents.length) {
      setCelebrationQueue((currentQueue) => [...currentQueue, ...unseenEvents]);
    }
  }, [isParent, rankingCelebrationKeys]);

  useEffect(() => {
    if (celebrationOverlay || !celebrationQueue.length) return;
    const [nextCelebration, ...remainingQueue] = celebrationQueue;
    setCelebrationOverlay(nextCelebration);
    setCelebrationQueue(remainingQueue);
  }, [celebrationOverlay, celebrationQueue]);

  const closeCelebrationOverlay = () => {
    const key = celebrationOverlay?.key;
    try {
      if (key && typeof window !== "undefined") {
        window.localStorage.setItem(
          `smartlink.schools.celebration.${key}`,
          "seen",
        );
      }
    } catch {
      // Celebration de-duping is best-effort.
    }
    setCelebrationOverlay(null);
  };

  const announcements = notices
    .filter((notice: any) => notice.source === "announcement")
    .sort((a: any, b: any) =>
      String(b.date || "").localeCompare(String(a.date || "")),
    );
  const generalNotices = notices.filter(
    (notice: any) => notice.source !== "announcement",
  );
  const urgent = payload?.urgent || null;
  const feePercent = paymentPercent(fees);
  const attendanceCalendar = buildAttendanceCalendar(attendance.records || []);
  const timetableGroups = groupByDate(timetable);
  const balance = Number(fees.summary?.outstanding_balance || 0);
  const paid = Number(fees.summary?.amount_paid || 0);
  const totalDue = Number(fees.summary?.total_due || 0);
  const fullName = profile.full_name || user?.fullName || "Student";
  const studentMeta = `${profile.class_name || "-"}${profile.stream_section ? ` - Stream ${profile.stream_section}` : ""} - Adm. ${profile.admission_no || profile.student_id || "-"}`;
  const currentDrill = drillPayload?.drill || null;
  const drillQuestions = Array.isArray(currentDrill?.questions)
    ? currentDrill.questions
    : [];
  const drillAnswered = drillQuestions.filter(drillQuestionAnswered).length;
  const drillTotal =
    drillQuestions.length || Number(currentDrill?.total_questions || 0);
  const drillComplete = currentDrill?.status === "completed";
  const drillPercent = drillTotal
    ? Math.round((drillAnswered / drillTotal) * 100)
    : 0;

  useEffect(() => {
    setShowDrillResults(false);
    setDrillExplanations({});
  }, [currentDrill?.id, currentDrill?.status]);

  const openReportPdf = async (
    reportId: any = latestReport?.report_card_id,
  ) => {
    if (!token || !reportId) {
      toast.error("No report card is available yet.");
      return;
    }
    setOpeningReportId(reportId);
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(
        '<!doctype html><title>Preparing PDF</title><body style="font-family:system-ui;padding:24px">Preparing report card PDF...</body>',
      );
    }
    try {
      const blob = await api.getReportCardPdf(token, reportId);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Report card PDF is ready.");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (pdfError: any) {
      if (win) win.close();
      toast.error(pdfError?.message || "Unable to open report card PDF.");
    } finally {
      setOpeningReportId(null);
    }
  };

  const activatePlus = () => {
    setPlusActive(true);
    try {
      window.localStorage.setItem("smartlink.schools.plus.active", "true");
    } catch {
      // Best effort only.
    }
    toast.success("SmartLink Plus is active in this demo portal.");
  };

  const handleSecondaryNav = (item: (typeof secondaryNav)[number]) => {
    if (item.action === "download") {
      openReportPdf();
      return;
    }
    if (item.action === "refresh") {
      loadPortal({ silent: true });
      return;
    }
    if (item.id) setActiveView(item.id);
  };

  const switchStudent = (studentRef: string) => {
    if (!studentRef || studentRef === selectedStudentRef) return;
    setActiveView("home");
    setSelectedStudentRef(studentRef);
  };

  const showPayFlow = () => {
    if (balance <= 0) {
      toast.success("There is no outstanding balance for this term.");
      return;
    }
    setPayStep("select");
  };

  const confirmPayment = () => {
    setPayStep("success");
    toast.success("Payment request prepared.");
  };

  const handleLogout = async () => {
    await logout();
    toast.success("Signed out.");
  };

  const saveDrillAnswer = async (question: any, answerOverride?: string) => {
    if (!token || !currentDrill?.id) return;
    const answer =
      answerOverride ??
      drillAnswers[String(question.session_question_id)] ??
      question.student_answer ??
      "";
    if (!String(answer).trim()) {
      toast.error("Enter an answer first.");
      return;
    }
    const actionKey = `answer-${question.session_question_id}`;
    setDrillAction(actionKey);
    try {
      const response = await api.answerDrillQuestion(token, currentDrill.id, {
        session_question_id: question.session_question_id,
        answer,
      });
      if (response?.mark?.teacher_review_required)
        toast.success("Answer saved for teacher review.");
      else toast.success("Answer saved.");
      await loadTodayDrill({ silent: true });
    } catch (answerError: any) {
      toast.error(answerError?.message || "Unable to save this answer.");
    } finally {
      setDrillAction("");
    }
  };

  const submitCurrentDrill = async () => {
    if (!token || !currentDrill?.id) return;
    if (drillTotal && drillAnswered < drillTotal) {
      const ok = window.confirm(
        `You have answered ${drillAnswered} of ${drillTotal} questions. Submit anyway?`,
      );
      if (!ok) return;
    }
    setDrillAction("submit");
    try {
      const response = await api.submitDrill(token, currentDrill.id);
      if (response?.drill) {
        const nextPayload = { ...(drillPayload || {}), drill: response.drill };
        setDrillPayload(nextPayload);
        setShowDrillResults(false);
        try {
          window.localStorage.setItem(
            drillCacheKey,
            JSON.stringify(nextPayload),
          );
        } catch {
          // Drill cache is best effort only.
        }
      }
      await loadTodayDrill({ silent: true });
      await loadPortal({ silent: true });
      toast.success("Daily drill submitted.");
    } catch (submitError: any) {
      toast.error(submitError?.message || "Unable to submit this drill.");
    } finally {
      setDrillAction("");
    }
  };

  const openDrillSession = async (session: any) => {
    if (!token || !session?.id) return;
    if (session.status !== "completed") {
      toast.message("This drill is not completed yet.");
      return;
    }
    const actionKey = `open-${session.id}`;
    setDrillAction(actionKey);
    try {
      const response = await api.getDrill(token, session.id);
      if (response?.drill) {
        const nextPayload = {
          ...(drillPayload || {}),
          drill: response.drill,
          history: drillHistory,
        };
        setDrillPayload(nextPayload);
        setShowDrillResults(true);
        setActiveView("drills");
        try {
          window.localStorage.setItem(drillCacheKey, JSON.stringify(nextPayload));
        } catch {
          // Drill cache is best effort only.
        }
      }
    } catch (openError: any) {
      toast.error(openError?.message || "Unable to open drill results.");
    } finally {
      setDrillAction("");
    }
  };

  const explainDrillQuestion = async (question: any, mode: string) => {
    if (!token || !question.question_id) return;
    const actionKey = `explain-${question.session_question_id}-${mode}`;
    setDrillAction(actionKey);
    try {
      const response = await api.adaptQuestionExplanation(
        token,
        question.question_id,
        {
          mode,
          student_answer:
            question.student_answer ||
            drillAnswers[String(question.session_question_id)] ||
            "",
          drill_session_id: currentDrill?.id,
        },
      );
      setDrillExplanations((current) => ({
        ...current,
        [String(question.session_question_id)]: {
          ...(response?.explanation || {}),
          approved_explanation:
            response?.approved_explanation || question.explanation || "",
          log_id: response?.log_id || null,
        },
      }));
      toast.success("Explanation ready.");
    } catch (explainError: any) {
      toast.error(explainError?.message || "Unable to prepare an explanation.");
    } finally {
      setDrillAction("");
    }
  };

  const flagDrillExplanation = async (question: any) => {
    if (!token || !question.question_id) return;
    const explanation = drillExplanations[String(question.session_question_id)];
    const actionKey = `flag-${question.session_question_id}`;
    setDrillAction(actionKey);
    try {
      await api.flagQuestionExplanation(token, question.question_id, {
        log_id: explanation?.log_id,
        feedback: "flagged",
      });
      toast.success("Explanation flagged for review.");
    } catch (flagError: any) {
      toast.error(flagError?.message || "Unable to flag this explanation.");
    } finally {
      setDrillAction("");
    }
  };

  if (loading && !payload) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F4F5F2] p-4">
        <div className="grid justify-items-center gap-3 rounded-[18px] border border-[#DFDDD5] bg-white px-8 py-7">
          <span className="size-8 animate-spin rounded-full border-2 border-[#D4D1C7] border-t-[#042C53]" />
          <span className="text-[13px] font-medium text-[#20201d]">
            Loading {isParent ? "family" : "student"} portal...
          </span>
        </div>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F4F5F2] p-4 text-[#20201d]">
        <div className="w-full max-w-[430px] rounded-[18px] border border-[#DFDDD5] bg-white p-6 text-center shadow-sm">
          <div className="mx-auto grid size-10 place-items-center rounded-full bg-[#FCEBEB] text-[#A32D2D]">
            <AlertCircle className="size-5" />
          </div>
          <h1 className="mt-3 text-[16px] font-medium">
            {isParent ? "This parent account needs a learner link" : "Student portal unavailable"}
          </h1>
          <p className="mt-2 text-[12px] leading-5 text-[#6f6d67]">{error}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => loadPortal()}
              className="h-9 rounded-[8px] bg-[#042C53] text-[12px] font-medium text-[#B5D4F4]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="h-9 rounded-[8px] border border-[#DFDDD5] text-[12px] font-medium text-[#6f6d67]"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderHome = () => (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard
          label="Term avg"
          value={
            latestReport
              ? percent(latestReport.average_score).replace("%", "")
              : "-"
          }
          suffix={latestReport ? "%" : ""}
          sub={
            latestReport?.grade
              ? `${latestReport.grade} grade overall`
              : "No report yet"
          }
          tone={latestReport?.remark === "FAIL" ? "negative" : "positive"}
        />
        <StatCard
          label="Class position"
          value={latestReport?.position || "-"}
          suffix={
            latestReport?.class_total ? `/${latestReport.class_total}` : ""
          }
          sub="Per class ranking"
          tone="positive"
        />
        <StatCard
          label="Attendance"
          value={
            attendance.summary?.attendance_percent !== null
              ? percent(attendance.summary?.attendance_percent).replace("%", "")
              : "-"
          }
          suffix={attendance.summary?.attendance_percent !== null ? "%" : ""}
          sub={`${attendance.summary?.absences || 0} absences`}
        />
        <StatCard
          label="Fees paid"
          value={feePercent.toFixed(0)}
          suffix="%"
          sub={balance > 0 ? `${money(balance)} due` : "Fully paid"}
          tone={balance > 0 ? "negative" : "positive"}
        />
      </div>

      <Card
        title="Recent results"
        action="See all"
        onAction={() => setActiveView("results")}
      >
        {latestSubjects.length ? (
          latestSubjects
            .slice(0, 3)
            .map((subject: any, index: number) => (
              <SubjectRow
                key={subject.id || subject.subject_name}
                subject={subject}
                index={index}
              />
            ))
        ) : (
          <EmptyState label="No results have been published yet." />
        )}
      </Card>

      <Card
        title="Upcoming homework"
        action="See all"
        onAction={() => setActiveView("homework")}
      >
        {homework.length ? (
          homework
            .slice(0, 3)
            .map((item: any) => <HomeworkRow key={item.id} item={item} />)
        ) : (
          <EmptyState label="No homework is due right now." />
        )}
      </Card>

      {!isParent ? <Card
        title="Today's drill"
        action="Open"
        onAction={() => setActiveView("drills")}
      >
        {drillLoading && !drillPayload ? (
          <div className="flex items-center gap-2 rounded-[8px] bg-[#F1F0EA] px-3 py-3 text-[12px] text-[#6f6d67]">
            <span className="size-4 animate-spin rounded-full border-2 border-[#D4D1C7] border-t-[#185FA5]" />
            Loading practice...
          </div>
        ) : currentDrill ? (
          <button
            type="button"
            onClick={() => setActiveView("drills")}
            className="flex w-full items-center gap-2.5 text-left"
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#E6F1FB] text-[#0C447C]">
              <Brain className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-[#20201d]">
                {currentDrill.subject_name || "Practice"} -{" "}
                {currentDrill.focus_topic_name || "Daily review"}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F1F0EA]">
                <div
                  className="h-full rounded-full bg-[#185FA5]"
                  style={{
                    width: `${drillComplete ? Number(currentDrill.percentage || 0) : drillPercent}%`,
                  }}
                />
              </div>
              <div className="mt-1 text-[10px] text-[#6f6d67]">
                {drillComplete
                  ? `${percent(currentDrill.percentage)} completed`
                  : `${drillAnswered}/${drillTotal || "-"} answered`}
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-[#185FA5]" />
          </button>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setActiveView("drills")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ")
                setActiveView("drills");
            }}
            className="cursor-pointer"
          >
            <EmptyState
              label={
                drillPayload?.action_required ||
                "Daily practice will appear when approved questions are available."
              }
            />
          </div>
        )}
      </Card> : (
        <Card
          title="Family learning insights"
          action="Open"
          onAction={() => setActiveView("insights")}
        >
          {familyInsights.length ? (
            <button
              type="button"
              onClick={() => setActiveView("insights")}
              className="flex w-full items-start gap-2.5 text-left"
            >
              <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#EEEDFE] text-[#534AB7]">
                <HeartHandshake className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-1 text-[12px] font-medium text-[#20201d]">
                  {familyInsights[0].headline}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[#6f6d67]">
                  {familyInsights[0].summary_text}
                </div>
                <div className="mt-1 text-[10px] font-medium text-[#534AB7]">
                  {familyInsights.length} school-approved {familyInsights.length === 1 ? "update" : "updates"}
                </div>
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-[#534AB7]" />
            </button>
          ) : (
            <EmptyState label="The school has not published a family learning insight yet." />
          )}
        </Card>
      )}

      <Card title="Announcements">
        {announcements.length ? (
          <div className="grid gap-2.5">
            {announcements.slice(0, 4).map((announcement: any) => (
              <AnnouncementCard
                key={announcement.id}
                announcement={announcement}
                api={api}
                token={token}
                canRespond={!isParent}
              />
            ))}
          </div>
        ) : (
          <EmptyState label="No announcements are available." />
        )}
      </Card>

      <Card
        title="Notices"
        action="Open"
        onAction={() => setActiveView("notices")}
      >
        {generalNotices.length ? (
          generalNotices
            .slice(0, 2)
            .map((notice: any, index: number) => (
              <NoticeRow key={notice.id} notice={notice} index={index} />
            ))
        ) : (
          <EmptyState label="No notices are available." />
        )}
      </Card>

      <button
        type="button"
        onClick={() => setActiveView(isParent ? "insights" : "plus")}
        className="mb-2.5 flex w-full items-center gap-2 rounded-[12px] border border-[#AFA9EC] bg-white px-3.5 py-3 text-left"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#EEEDFE] text-[#534AB7]">
          {isParent ? (
            <HeartHandshake className="size-4" />
          ) : plusActive ? (
            <Check className="size-4" />
          ) : (
            <Bell className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-[#3C3489]">
            {isParent
              ? "School-approved family updates"
              : plusActive
              ? "SmartLink Plus active"
              : "Get absence alerts instantly"}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[#534AB7]">
            {isParent
              ? `${familyInsights.length} ${familyInsights.length === 1 ? "insight" : "insights"} available for ${profile.first_name || "this learner"}`
              : plusActive
              ? "Alerts, reminders and trend insights are unlocked"
              : "Know when your child misses class - SmartLink Plus"}
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-[#534AB7]" />
      </button>
    </>
  );

  const renderResults = () => (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:max-w-[520px]">
        <StatCard
          label="Term average"
          value={
            latestReport
              ? percent(latestReport.average_score).replace("%", "")
              : "-"
          }
          suffix={latestReport ? "%" : ""}
          sub={
            latestReport?.grade
              ? `${latestReport.grade} grade overall`
              : "Pending"
          }
          tone={latestReport?.remark === "FAIL" ? "negative" : "positive"}
        />
        <StatCard
          label="Class position"
          value={latestReport?.position || "-"}
          suffix={
            latestReport?.class_total ? `/${latestReport.class_total}` : ""
          }
          sub="Per class"
          tone="positive"
        />
      </div>
      <Card
        title={
          latestReport?.exam_session_name ||
          latestReport?.term_name ||
          "Latest results"
        }
        action={openingReportId ? "Preparing..." : "Report"}
        onAction={() => openReportPdf(latestReport?.report_card_id)}
      >
        {latestSubjects.length ? (
          latestSubjects.map((subject: any, index: number) => (
            <SubjectRow
              key={subject.id || subject.subject_name}
              subject={subject}
              index={index}
            />
          ))
        ) : (
          <EmptyState label="No subject results are available." />
        )}
      </Card>
      <Card title={plusActive ? "Performance trends" : "SmartLink Plus"}>
        {plusActive ? (
          results.performance_trends?.length ? (
            results.performance_trends.map((trend: any) => (
              <div
                key={trend.subject_name}
                className="flex items-center justify-between border-b border-[#E7E5DE] py-2 text-[12px] last:border-b-0"
              >
                <span className="min-w-0 truncate text-[#20201d]">
                  {trend.subject_name}
                </span>
                <span
                  className={
                    trend.direction === "declining"
                      ? "font-medium text-[#993C1D]"
                      : trend.direction === "improving"
                        ? "font-medium text-[#0F6E56]"
                        : "font-medium text-[#77756f]"
                  }
                >
                  {valueLabel(trend.direction)}{" "}
                  {trend.change
                    ? `${trend.change > 0 ? "+" : ""}${trend.change}`
                    : ""}
                </span>
              </div>
            ))
          ) : (
            <EmptyState label="Trends will appear after another report card." />
          )
        ) : (
          <button
            type="button"
            onClick={() => setActiveView("plus")}
            className="flex w-full items-center gap-2 text-left"
          >
            <Lock className="size-4 shrink-0 text-[#534AB7]" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-[#3C3489]">
                Multi-term performance trends
              </div>
              <div className="mt-0.5 text-[10px] text-[#534AB7]">
                See how scores change over time - SmartLink Plus
              </div>
            </div>
            <span className="rounded-full bg-[#EEEDFE] px-2 py-0.5 text-[10px] font-medium text-[#3C3489]">
              Plus
            </span>
          </button>
        )}
      </Card>
    </>
  );

  const renderFees = () => (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:max-w-[520px]">
        <StatCard
          label="Total fees"
          value={money(totalDue, true)}
          sub={fees.summary?.term_name || profile.term_name}
          small
        />
        <StatCard
          label="Outstanding"
          value={money(balance, true)}
          sub={
            fees.summary?.next_due_date
              ? `Due ${dateLabel(fees.summary.next_due_date)}`
              : "No deadline"
          }
          tone={balance > 0 ? "negative" : "positive"}
          small
        />
      </div>
      <Card title="Payment progress">
        <div className="mb-1 flex justify-between text-[11px]">
          <span className="text-[#6f6d67]">Collected</span>
          <span className="font-medium text-[#20201d]">
            {money(paid)} - {feePercent.toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#F1F0EA]">
          <div
            className="h-full rounded-full bg-[#1D9E75]"
            style={{ width: `${feePercent}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-[#6f6d67]">
          <span>
            Paid:{" "}
            <span className="font-medium text-[#0F6E56]">{money(paid)}</span>
          </span>
          <span>
            Remaining:{" "}
            <span className="font-medium text-[#993C1D]">{money(balance)}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={showPayFlow}
          className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#042C53] text-[12px] font-medium text-[#B5D4F4]"
        >
          <Wallet className="size-3.5" />
          {balance > 0 ? `Pay ${money(balance)} now` : "No balance due"}
        </button>
      </Card>
      <Card title="Payment history">
        {fees.payments?.length ? (
          fees.payments.map((payment: any) => (
            <div
              key={payment.id}
              className="flex items-center justify-between border-b border-[#E7E5DE] py-2 last:border-b-0"
            >
              <div>
                <div className="text-[12px] text-[#20201d]">
                  {valueLabel(payment.payment_method || "payment")}
                </div>
                <div className="mt-0.5 text-[10px] text-[#8c8982]">
                  {payment.receipt_no || payment.reference || "-"} -{" "}
                  {shortDate(payment.paid_at)}
                </div>
              </div>
              <span className="text-[12px] font-medium text-[#0F6E56]">
                {money(payment.amount)}
              </span>
            </div>
          ))
        ) : (
          <EmptyState label="No payments have been recorded yet." />
        )}
      </Card>
    </>
  );

  const renderHomework = () => {
    const openItems = homework.filter(
      (item: any) =>
        !["submitted", "late"].includes(
          String(item.submission_status || "").toLowerCase(),
        ),
    );
    const doneItems = homework.filter((item: any) =>
      ["submitted", "late"].includes(
        String(item.submission_status || "").toLowerCase(),
      ),
    );
    return (
      <>
        <Card title="Due this week">
          {openItems.length ? (
            openItems.map((item: any) => (
              <HomeworkRow key={item.id} item={item} />
            ))
          ) : (
            <EmptyState label="No open homework is due this week." />
          )}
        </Card>
        <Card title="Completed">
          {doneItems.length ? (
            doneItems
              .slice(0, 6)
              .map((item: any) => <HomeworkRow key={item.id} item={item} />)
          ) : (
            <EmptyState label="Completed homework will appear here." />
          )}
        </Card>
      </>
    );
  };

  const renderAttendance = () => (
    <>
      <div className="mb-2.5 flex gap-2">
        <div className="flex-1 rounded-[8px] bg-[#F1F0EA] p-2.5 text-center">
          <div className="text-[18px] font-medium text-[#1D9E75]">
            {percent(attendance.summary?.attendance_percent).replace("%", "")}
            <span className="text-[12px]">%</span>
          </div>
          <div className="mt-0.5 text-[10px] text-[#6f6d67]">
            Attendance rate
          </div>
        </div>
        <div className="flex-1 rounded-[8px] bg-[#F1F0EA] p-2.5 text-center">
          <div className="text-[18px] font-medium text-[#20201d]">
            {attendance.summary?.attended_days || 0}
          </div>
          <div className="mt-0.5 text-[10px] text-[#6f6d67]">Days present</div>
        </div>
        <div className="flex-1 rounded-[8px] bg-[#F1F0EA] p-2.5 text-center">
          <div className="text-[18px] font-medium text-[#E24B4A]">
            {attendance.summary?.absences || 0}
          </div>
          <div className="mt-0.5 text-[10px] text-[#6f6d67]">Absences</div>
        </div>
      </div>
      <Card title={attendanceCalendar.label}>
        <div className="mb-2 grid grid-cols-7 gap-1">
          {["M", "T", "W", "T", "F", "S", "S"].map((day) => (
            <div key={day} className="text-center text-[9px] text-[#8c8982]">
              {day}
            </div>
          ))}
          {attendanceCalendar.cells.map((cell, index) => {
            const status = String(cell.status || "").toLowerCase();
            const className = cell.empty
              ? "opacity-0"
              : status === "absent" || status === "sick"
                ? "bg-[#FCEBEB] text-[#791F1F]"
                : status === "present" || status === "late"
                  ? "bg-[#E1F5EE] text-[#085041]"
                  : "text-[#8c8982]";
            return (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={`${cell.date || "empty"}-${index}`}
                className={`grid aspect-square place-items-center rounded-[4px] text-[10px] ${className}`}
              >
                {cell.day || ""}
              </div>
            );
          })}
        </div>
        <div className="flex gap-3 text-[10px] text-[#6f6d67]">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-[2px] bg-[#E1F5EE]" />
            Present
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-[2px] bg-[#FCEBEB]" />
            Absent
          </span>
        </div>
      </Card>
    </>
  );

  const renderTimetable = () => (
    <>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em] text-[#8c8982]">
        {profile.class_name || "Class"} schedule
      </div>
      <div className="grid gap-1.5">
        {timetableGroups.length ? (
          timetableGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-1 mt-2 text-[11px] font-medium text-[#6f6d67]">
                {group.label}
              </div>
              {group.rows.map((entry, index) => (
                <div
                  key={entry.id}
                  className="mb-1.5 flex items-center gap-2 rounded-[8px] border border-[#DFDDD5] bg-white px-2.5 py-2"
                >
                  <span
                    className="self-stretch rounded-full"
                    style={{
                      width: 3,
                      background: subjectColors[index % subjectColors.length],
                    }}
                  />
                  <div className="w-12 shrink-0 text-[10px] leading-4 text-[#8c8982]">
                    {timeLabel(entry.start_time)}
                    <br />
                    {timeLabel(entry.end_time)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-[#20201d]">
                      {entry.subject_name}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-[#6f6d67]">
                      {entry.room || "-"} - {entry.teacher_name || "Teacher"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        ) : (
          <EmptyState label="No timetable entries are scheduled yet." />
        )}
      </div>
    </>
  );

  const renderDrills = () => (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:max-w-[620px]">
        <StatCard
          label="Progress"
          value={
            currentDrill
              ? drillComplete
                ? percent(currentDrill.percentage).replace("%", "")
                : drillPercent
              : "-"
          }
          suffix={currentDrill ? "%" : ""}
          sub={
            drillComplete
              ? showDrillResults
                ? "Results open"
                : "Tap to view results"
              : `${drillAnswered}/${drillTotal || "-"} answered`
          }
          tone={
            drillComplete && Number(currentDrill.percentage || 0) < 50
              ? "negative"
              : "positive"
          }
        />
        <StatCard
          label="Recent drills"
          value={drillHistory.length || 0}
          sub="Last 60 sessions"
        />
      </div>

      <Card
        title={
          currentDrill
            ? `${currentDrill.subject_name || "Daily practice"} - ${currentDrill.focus_topic_name || "Review"}`
            : "Today's practice"
        }
        action={drillLoading ? "Loading..." : "Refresh"}
        onAction={() => loadTodayDrill({ silent: false })}
      >
        {drillLoading && !currentDrill ? (
          <div className="flex items-center gap-2 rounded-[8px] bg-[#F1F0EA] px-3 py-4 text-[12px] text-[#6f6d67]">
            <span className="size-4 animate-spin rounded-full border-2 border-[#D4D1C7] border-t-[#185FA5]" />
            Loading today&apos;s drill...
          </div>
        ) : !currentDrill ? (
          <div className="grid gap-3">
            <EmptyState
              label={
                drillPayload?.action_required || "No Daily Drill is ready yet. Your teacher may need to approve practice questions first."
              }
            />
            <button
              type="button"
              onClick={() => loadTodayDrill({ silent: false })}
              disabled={drillLoading}
              className="flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-[#042C53] text-[12px] font-medium text-[#B5D4F4] disabled:opacity-60"
            >
              <RefreshCcw
                className={`size-3.5 ${drillLoading ? "animate-spin" : ""}`}
              />
              Try again
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-[10px] border border-[#DFDDD5] bg-[#F8F7F2] p-3">
              <div className="flex items-center justify-between gap-3 text-[11px] text-[#6f6d67]">
                <span>{dateLabel(currentDrill.scheduled_date)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${drillComplete ? "bg-[#E1F5EE] text-[#085041]" : "bg-[#E6F1FB] text-[#0C447C]"}`}
                >
                  {valueLabel(currentDrill.status || "in_progress")}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-[#185FA5]"
                  style={{
                    width: `${drillComplete ? Number(currentDrill.percentage || 0) : drillPercent}%`,
                  }}
                />
              </div>
              <div className="mt-2 text-[11px] text-[#6f6d67]">
                {currentDrill.focus_reason
                  ? `Focus: ${valueLabel(currentDrill.focus_reason)}`
                  : "Complete the questions, then submit to unlock review."}
              </div>
            </div>

            {drillComplete && !showDrillResults ? (
              <div className="rounded-[10px] border border-[#DFDDD5] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-semibold text-[#20201d]">
                      Drill completed
                    </div>
                    <div className="mt-1 text-[11px] leading-4 text-[#6f6d67]">
                      Your results are closed. Open them when you want to review your score, answers, and explanations.
                    </div>
                  </div>
                  <div className={`text-[20px] font-medium ${drillScoreTone(currentDrill.percentage)}`}>
                    {percent(currentDrill.percentage)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDrillResults(true)}
                  className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#042C53] text-[12px] font-medium text-[#B5D4F4]"
                >
                  <BookOpen className="size-3.5" />
                  View results
                </button>
              </div>
            ) : (
              <>
                {drillQuestions.length ? (
                  drillQuestions.map((question: any, index: number) => {
                const key = String(question.session_question_id);
                const options = questionOptions(question);
                const tables = drillQuestionTables(question);
                const draftAnswer =
                  drillAnswers[key] ?? question.student_answer ?? "";
                const answered = drillQuestionAnswered(question);
                const reviewState = drillAnswerReview(question);
                const explanation = drillExplanations[key];
                return (
                  <div
                    key={key}
                    className="rounded-[10px] border border-[#DFDDD5] bg-white p-3"
                  >
                    <div className="mb-2 flex items-start gap-2">
                      <div className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[#E6F1FB] text-[11px] font-medium text-[#0C447C]">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium leading-5 text-[#20201d]">
                          {question.question_text}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-[#8c8982]">
                          <span>
                            {question.topic_name ||
                              currentDrill.focus_topic_name ||
                              "Topic"}
                          </span>
                          <span>
                            {valueLabel(question.question_type || "question")}
                          </span>
                          <span>
                            {Number(question.marks || 1)} mark
                            {Number(question.marks || 1) === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                      {drillComplete ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reviewState.badgeClass}`}
                        >
                          {reviewState.label}
                        </span>
                      ) : answered ? (
                        <span className="rounded-full bg-[#E6F1FB] px-2 py-0.5 text-[10px] font-medium text-[#0C447C]">
                          Saved
                        </span>
                      ) : null}
                    </div>

                    {tables.length ? (
                      <div className="mb-3 grid gap-2">
                        {tables.map((table: any) => {
                          const bodyRows = table.headerRow
                            ? table.cells.slice(1)
                            : table.cells;
                          return (
                            <figure
                              key={table.tableId}
                              className="overflow-hidden rounded-[8px] border border-[#D4D1C7] bg-white"
                            >
                              {table.caption ? (
                                <figcaption className="border-b border-[#D4D1C7] bg-[#F8F7F2] px-3 py-2 text-[11px] font-medium text-[#44433f]">
                                  {table.caption}
                                </figcaption>
                              ) : null}
                              <div className="overflow-x-auto">
                                <table className="min-w-full border-collapse text-left text-[11px] text-[#20201d]">
                                  {table.headerRow && table.cells[0] ? (
                                    <thead className="bg-[#E6F1FB] text-[#0C447C]">
                                      <tr>
                                        {table.cells[0].map(
                                          (cell: string, columnIndex: number) => (
                                            <th
                                              key={columnIndex}
                                              scope="col"
                                              className="min-w-[100px] border-b border-r border-[#B5D4F4] px-3 py-2 font-medium last:border-r-0"
                                            >
                                              {cell || "\u00a0"}
                                            </th>
                                          ),
                                        )}
                                      </tr>
                                    </thead>
                                  ) : null}
                                  <tbody>
                                    {bodyRows.map(
                                      (row: string[], rowIndex: number) => (
                                        <tr
                                          key={rowIndex}
                                          className="even:bg-[#F8F7F2]"
                                        >
                                          {row.map(
                                            (cell: string, columnIndex: number) => (
                                              <td
                                                key={columnIndex}
                                                className="min-w-[100px] whitespace-pre-wrap border-b border-r border-[#E7E5DE] px-3 py-2 align-top last:border-r-0"
                                              >
                                                {cell || "\u00a0"}
                                              </td>
                                            ),
                                          )}
                                        </tr>
                                      ),
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </figure>
                          );
                        })}
                      </div>
                    ) : null}

                    {options.length ? (
                      <div className="grid gap-1.5">
                        {options.map((option) => {
                          const selected =
                            String(draftAnswer) === option.value ||
                            String(draftAnswer) === option.label;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setDrillAnswers((current) => ({
                                  ...current,
                                  [key]: option.value,
                                }));
                                if (!drillComplete)
                                  saveDrillAnswer(question, option.value);
                              }}
                              disabled={
                                drillComplete ||
                                drillAction ===
                                  `answer-${question.session_question_id}`
                              }
                              className={`flex items-center justify-between rounded-[8px] border px-3 py-2 text-left text-[12px] ${
                                selected
                                  ? "border-[#185FA5] bg-[#E6F1FB] text-[#0C447C]"
                                  : "border-[#E7E5DE] bg-[#F8F7F2] text-[#20201d]"
                              } disabled:opacity-80`}
                            >
                              <span>
                                {option.label}. {option.text}
                              </span>
                              {selected ? <Check className="size-3.5" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <textarea
                          value={String(draftAnswer)}
                          onChange={(event) =>
                            setDrillAnswers((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          disabled={drillComplete}
                          rows={3}
                          className="min-h-[78px] resize-none rounded-[8px] border border-[#D4D1C7] bg-[#F8F7F2] px-3 py-2 text-[12px] text-[#20201d] outline-none focus:border-[#185FA5] disabled:opacity-80"
                          placeholder="Write your answer"
                        />
                        {!drillComplete ? (
                          <button
                            type="button"
                            onClick={() => saveDrillAnswer(question)}
                            disabled={
                              drillAction ===
                              `answer-${question.session_question_id}`
                            }
                            className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-[#185FA5] bg-white text-[11px] font-medium text-[#185FA5] disabled:opacity-60"
                          >
                            {drillAction ===
                            `answer-${question.session_question_id}` ? (
                              <span className="size-3 animate-spin rounded-full border-2 border-[#B5D4F4] border-t-[#185FA5]" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            Save answer
                          </button>
                        ) : null}
                      </div>
                    )}

                    {drillComplete ? (
                      <div className="mt-3 rounded-[8px] bg-[#F8F7F2] p-2.5">
                        <div className="mb-2 grid gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium text-[#6f6d67]">
                            <span>
                              Your answer: {question.student_answer || "-"}
                            </span>
                            {reviewState.marksAwarded !== null ? (
                              <span>
                                Score: {reviewState.marksAwarded}/{reviewState.maxMarks}
                              </span>
                            ) : null}
                          </div>
                          <div className={`rounded-[8px] border px-3 py-2 text-[11px] leading-4 ${reviewState.panelClass}`}>
                            {reviewState.feedback}
                          </div>
                        </div>
                        {question.explanation ? (
                          <div className="text-[11px] leading-4 text-[#6f6d67]">
                            {question.explanation}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {[
                            ["simple", "Explain simply", Lightbulb],
                            ["step_by_step", "Steps", HelpCircle],
                            ["hint", "Hint", Lightbulb],
                            ["common_mistake", "Mistake", AlertCircle],
                            ["similar_example", "Example", BookOpen],
                          ].map(([mode, label, Icon]: any) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() =>
                                explainDrillQuestion(question, mode)
                              }
                              disabled={
                                drillAction ===
                                `explain-${question.session_question_id}-${mode}`
                              }
                              className="inline-flex h-7 items-center gap-1 rounded-full border border-[#DFDDD5] bg-white px-2 text-[10px] font-medium text-[#185FA5] disabled:opacity-60"
                            >
                              <Icon className="size-3" />
                              {label}
                            </button>
                          ))}
                        </div>
                        {explanation?.explanation_text ? (
                          <AiExplanationResponse
                            text={explanation.explanation_text}
                            gradeName={currentDrill.grade_name || ""}
                            onFlag={() => flagDrillExplanation(question)}
                            flagging={
                              drillAction ===
                              `flag-${question.session_question_id}`
                            }
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
                  })
                ) : (
                  <EmptyState label="No questions were attached to this drill." />
                )}

                {!drillComplete ? (
                  <button
                    type="button"
                    onClick={submitCurrentDrill}
                    disabled={!drillQuestions.length || drillAction === "submit"}
                    className="flex h-10 items-center justify-center gap-1.5 rounded-[8px] bg-[#042C53] text-[13px] font-medium text-[#B5D4F4] disabled:opacity-60"
                  >
                    {drillAction === "submit" ? (
                      <span className="size-4 animate-spin rounded-full border-2 border-[#B5D4F4]/40 border-t-[#B5D4F4]" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    Submit drill
                  </button>
                ) : (
                  <div className="rounded-[10px] border border-[#DFDDD5] bg-[#F8F7F2] px-3 py-3">
                    <div
                      className={`text-[20px] font-medium ${drillScoreTone(currentDrill.percentage)}`}
                    >
                      {percent(currentDrill.percentage)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#6f6d67]">
                      Score: {Number(currentDrill.score || 0)} points from{" "}
                      {drillTotal || currentDrill.total_questions || 0} question
                      {Number(drillTotal || currentDrill.total_questions || 0) === 1
                        ? ""
                        : "s"}
                      .
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>

      <Card title="Recent practice">
        {drillHistory.length ? (
          drillHistory.slice(0, 6).map((session: any) => (
            <button
              key={session.id}
              type="button"
              onClick={() => openDrillSession(session)}
              disabled={session.status !== "completed" || drillAction === `open-${session.id}`}
              className="flex w-full items-center justify-between gap-3 border-b border-[#E7E5DE] py-2 text-left last:border-b-0 disabled:cursor-default"
            >
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-[#20201d]">
                  {session.subject_name || "Practice"} -{" "}
                  {session.focus_topic_name || "Review"}
                </div>
                <div className="mt-0.5 text-[10px] text-[#8c8982]">
                  {dateLabel(session.scheduled_date)} -{" "}
                  {valueLabel(session.status)}
                </div>
              </div>
              <span
                className={`shrink-0 text-[12px] font-medium ${drillScoreTone(session.percentage)}`}
              >
                {drillAction === `open-${session.id}`
                  ? "Opening..."
                  : session.status === "completed"
                  ? percent(session.percentage)
                  : valueLabel(session.status)}
              </span>
            </button>
          ))
        ) : (
          <EmptyState label="Completed drills will appear here." />
        )}
      </Card>
    </>
  );

  const renderRanking = () => {
    const rows = ranking.leaderboard || [];
    const hasCompletedDrills = rows.some((row: any) => Number(row.completed_drills || 0) > 0);
    const movements = ranking.movements || [];
    const awards = ranking.awards || [];
    const summary = ranking.summary || {};
    const currentRow =
      rows.find((row: any) => row.is_current_student) || null;
    const medalClass = (medal: any) => {
      if (medal === "gold") return "bg-[#FAEEDA] text-[#8A5A00]";
      if (medal === "silver") return "bg-[#EEF1F5] text-[#58616F]";
      if (medal === "bronze") return "bg-[#F7E6D7] text-[#8A3F16]";
      return "bg-[#F1F0EA] text-[#6f6d67]";
    };
    const movementView = (row: any) => {
      const movement = Number(row.movement || 0);
      if (movement > 0) {
        return {
          Icon: ArrowUpRight,
          label: `Up ${movement}`,
          className: "text-[#0B7A52]",
        };
      }
      if (movement < 0) {
        return {
          Icon: ArrowDownRight,
          label: `Down ${Math.abs(movement)}`,
          className: "text-[#B42318]",
        };
      }
      return {
        Icon: Minus,
        label: row.movement_direction === "new" ? "New" : "Steady",
        className: "text-[#6f6d67]",
      };
    };

    return (
      <>
        <div className="mb-3 grid grid-cols-2 gap-2 lg:max-w-[720px] lg:grid-cols-4">
          <StatCard
            label="Your rank"
            value={summary.current_position || "-"}
            suffix={summary.current_position && summary.class_size ? `/${summary.class_size}` : ""}
            sub="Daily Drill class table"
            tone="positive"
          />
          <StatCard
            label="Average"
            value={
              summary.current_average !== null &&
              summary.current_average !== undefined
                ? percent(summary.current_average).replace("%", "")
                : "-"
            }
            suffix={
              summary.current_average !== null &&
              summary.current_average !== undefined
                ? "%"
                : ""
            }
            sub={`${summary.current_completed || 0} completed`}
          />
          <StatCard
            label="Movement"
            value={
              Number(summary.current_movement || 0) > 0
                ? `+${summary.current_movement}`
                : summary.current_movement || "-"
            }
            sub="Recent position change"
            tone={Number(summary.current_movement || 0) < 0 ? "negative" : "positive"}
          />
          <StatCard
            label="Leader"
            value={
              summary.leader_average !== null &&
              summary.leader_average !== undefined
                ? percent(summary.leader_average).replace("%", "")
                : "-"
            }
            suffix={
              summary.leader_average !== null &&
              summary.leader_average !== undefined
                ? "%"
                : ""
            }
            sub={summary.leader_name || "No leader yet"}
          />
        </div>

        {currentRow?.award ? (
          <Card title="Your award">
            <div className="flex items-center gap-3 rounded-[10px] border border-[#D9E9D3] bg-[#F1FAF4] p-3">
              <div className="grid size-10 place-items-center rounded-full bg-white text-[#0B7A52]">
                <Award className="size-5" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-[#20201d]">
                  {currentRow.award}
                </div>
                <div className="mt-0.5 text-[11px] leading-4 text-[#5F7568]">
                  Keep going. This award is based only on Daily Drill practice.
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        <Card title={`${ranking.class_name || "Class"} Daily Drill ranking`}>
          {rows.length ? (
            <div className="grid gap-2">
              {rows.map((row: any) => {
                const movement = movementView(row);
                const MovementIcon = movement.Icon;
                return (
                  <div
                    key={row.student_id}
                    className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 ${
                      row.is_current_student
                        ? "border-[#185FA5] bg-[#E6F1FB]"
                        : "border-[#E7E5DE] bg-white"
                    }`}
                  >
                    <div
                      className={`grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
                        row.medal ? medalClass(row.medal) : "bg-[#F1F0EA] text-[#20201d]"
                      }`}
                    >
                      {row.medal ? <Medal className="size-4" /> : row.position || "-"}
                    </div>
                    <StudentAvatar
                      profile={row}
                      user={user}
                      className="size-8"
                      textClassName="text-[11px]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium text-[#20201d]">
                          {row.full_name}
                        </span>
                        {row.medal ? (
                          <span className={`inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[9px] font-semibold uppercase ${medalClass(row.medal)}`}>
                            <Trophy className="size-3" />
                            {row.medal}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[10px] text-[#8c8982]">
                        {row.completed_drills} completed -{" "}
                        {row.latest_drill_date
                          ? `last ${shortDate(row.latest_drill_date)}`
                          : "no completed drill yet"}
                      </div>
                    </div>
                    <div className="grid justify-items-end gap-0.5">
                      <div className="text-[13px] font-medium text-[#20201d]">
                        {row.average_score !== null &&
                        row.average_score !== undefined
                          ? percent(row.average_score)
                          : "-"}
                      </div>
                      <div
                        className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${movement.className}`}
                      >
                        {Number(row.completed_drills || 0) > 0 ? (
                          <>
                            <MovementIcon className="size-3" />
                            {movement.label}
                          </>
                        ) : "No drills"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState label="No classmates are available for this ranking yet." />
          )}
        </Card>

        <Card title="Recent movements">
          {hasCompletedDrills && movements.length ? (
            <div className="grid gap-2">
              {movements.map((row: any) => {
                const movement = movementView(row);
                const MovementIcon = movement.Icon;
                return (
                  <div
                    key={`movement-${row.student_id}`}
                    className="flex items-center justify-between gap-3 border-b border-[#E7E5DE] py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-[#20201d]">
                        {row.full_name}
                      </div>
                      <div className="mt-0.5 text-[10px] text-[#8c8982]">
                        Position {row.position}
                        {row.previous_position
                          ? ` from ${row.previous_position}`
                          : ""}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 text-[12px] font-medium ${movement.className}`}
                    >
                      <MovementIcon className="size-4" />
                      {movement.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState label="Movements appear after the class has enough recent Daily Drill history." />
          )}
        </Card>

        <Card title="Improvement awards">
          {hasCompletedDrills && awards.length ? (
            <div className="grid gap-2">
              {awards.map((row: any) => (
                <div
                  key={`award-${row.student_id}`}
                  className="flex items-center gap-2 rounded-[10px] border border-[#D9E9D3] bg-[#F8FCF9] px-3 py-2"
                >
                  <div className="grid size-8 place-items-center rounded-full bg-white text-[#0B7A52]">
                    <Award className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-[#20201d]">
                      {row.full_name}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#6f6d67]">
                      {row.award} - {row.improvement_points > 0 ? "+" : ""}
                      {row.improvement_points || 0} points
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="Improvement awards appear when scores start climbing." />
          )}
        </Card>
      </>
    );
  };

  const renderNotices = () => (
    <Card title="Notices and announcements">
      {notices.length ? (
        notices.map((notice: any, index: number) => (
          <NoticeRow key={notice.id} notice={notice} index={index} />
        ))
      ) : (
        <EmptyState label="No notices are available." />
      )}
    </Card>
  );

  const renderProfile = () => (
    <>
      <Card title="Personal profile">
        {[
          ["Name", profile.full_name],
          ["Student ID", profile.student_id],
          ["Admission No", profile.admission_no],
          ["Class", profile.class_name],
          ["Stream", profile.stream_section],
          ["Academic Year", profile.academic_year_name],
          ["Current Term", profile.term_name],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-3 border-b border-[#E7E5DE] py-2 text-[12px] last:border-b-0"
          >
            <span className="text-[#6f6d67]">{label}</span>
            <span className="min-w-0 text-right font-medium text-[#20201d]">
              {value || "-"}
            </span>
          </div>
        ))}
      </Card>
      <Card title="Guardian contacts">
        {profile.guardians?.length ? (
          profile.guardians.map((guardian: any) => (
            <div
              key={guardian.guardian_number}
              className="border-b border-[#E7E5DE] py-2 last:border-b-0"
            >
              <div className="text-[12px] font-medium text-[#20201d]">
                {guardian.full_name}
              </div>
              <div className="mt-0.5 text-[10px] text-[#8c8982]">
                {valueLabel(guardian.relationship)}
              </div>
              <div className="mt-1 text-[11px] text-[#6f6d67]">
                {guardian.primary_phone || "-"} - {guardian.email || "-"}
              </div>
            </div>
          ))
        ) : (
          <EmptyState label="No guardian contact has been recorded." />
        )}
      </Card>
    </>
  );

  const renderFamilyInsights = () => (
    <>
      <div className="mb-3 rounded-[12px] border border-[#D8D4F0] bg-[#F7F6FF] p-3.5">
        <div className="flex items-start gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#EEEDFE] text-[#534AB7]">
            <HeartHandshake className="size-4" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-[#20201d]">Family learning updates</div>
            <div className="mt-0.5 text-[11px] leading-4 text-[#6f6d67]">
              These insights have been reviewed and published by the school for {profile.first_name || "your learner"}.
            </div>
          </div>
        </div>
      </div>
      {familyInsights.length ? familyInsights.map((insight: any) => (
        <Card key={insight.public_ref} title={insight.subject_name || "Overall learning"}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[#20201d]">{insight.headline}</div>
              <div className="mt-0.5 text-[10px] text-[#8c8982]">{insight.reporting_period || "Current period"}{insight.published_at ? ` - ${dateLabel(insight.published_at)}` : ""}</div>
            </div>
            <span className="rounded-full bg-[#E1F5EE] px-2 py-0.5 text-[9px] font-medium text-[#085041]">School approved</span>
          </div>
          <p className="mt-3 text-[12px] leading-5 text-[#4f4d48]">{insight.summary_text}</p>
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {[
              ["Going well", insight.strengths, "border-[#BDE5D5] bg-[#F2FBF7] text-[#085041]"],
              ["Current focus", insight.focus_areas, "border-[#F3D7A5] bg-[#FFF9EE] text-[#854F0B]"],
              ["Support at home", insight.home_support, "border-[#D8D4F0] bg-[#F7F6FF] text-[#3C3489]"],
            ].map(([label, items, tone]: any) => (
              <div key={label} className={`rounded-[8px] border p-2.5 ${tone}`}>
                <div className="text-[10px] font-semibold uppercase">{label}</div>
                {Array.isArray(items) && items.length ? (
                  <ul className="mt-1.5 grid gap-1 text-[11px] leading-4">
                    {items.map((item: string, index: number) => <li key={`${label}-${index}`}>• {item}</li>)}
                  </ul>
                ) : <div className="mt-1.5 text-[11px] opacity-70">No published detail.</div>}
              </div>
            ))}
          </div>
          {insight.attendance_effect_text ? (
            <div className="mt-3 rounded-[8px] border border-[#E7E5DE] bg-[#F8F7F2] px-3 py-2 text-[11px] leading-4 text-[#6f6d67]">
              <span className="font-medium text-[#20201d]">Attendance and learning: </span>{insight.attendance_effect_text}
            </div>
          ) : null}
        </Card>
      )) : (
        <EmptyState label="No family learning insight has been published for this learner yet. Results, attendance and homework remain available in the portal." />
      )}
    </>
  );

  const renderPlus = () => (
    <>
      <div className="mb-2.5">
        <div className="text-[13px] font-medium text-[#20201d]">
          SmartLink Plus
        </div>
        <div className="mt-0.5 text-[11px] text-[#6f6d67]">
          Deeper insight for parents who stay close.
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-[12px] border border-[#DFDDD5] bg-white p-3">
          <div className="text-[12px] font-medium text-[#20201d]">Free</div>
          <div className="my-1.5 text-[18px] font-medium text-[#20201d]">
            MK 0
          </div>
          <div className="text-[10px] text-[#6f6d67]">forever</div>
          <div className="mt-2 text-[10px] leading-4 text-[#6f6d67]">
            Results viewing
            <br />
            Fee balance
            <br />
            Timetable
            <br />
            School notices
            <br />
            Homework list
          </div>
          <button
            type="button"
            className="mt-2.5 h-8 w-full rounded-[8px] border border-[#D4D1C7] text-[11px] font-medium text-[#20201d]"
          >
            Current plan
          </button>
        </div>
        <div className="rounded-[12px] border-2 border-[#534AB7] bg-white p-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#EEEDFE] px-1.5 py-0.5 text-[9px] font-medium text-[#3C3489]">
            <Crown className="size-2.5" /> Plus
          </span>
          <div className="mt-1.5 text-[12px] font-medium text-[#20201d]">
            Plus
          </div>
          <div className="my-1.5 text-[18px] font-medium text-[#20201d]">
            MK 2,500
          </div>
          <div className="text-[10px] text-[#6f6d67]">per term</div>
          <div className="mt-2 text-[10px] leading-4 text-[#6f6d67]">
            Absence alerts
            <br />
            Homework reminders
            <br />
            Fee deadline nudges
            <br />
            Trend graphs
            <br />
            Early exam timetable
          </div>
          <button
            type="button"
            onClick={activatePlus}
            disabled={plusActive}
            className="mt-2.5 h-8 w-full rounded-[8px] bg-[#042C53] text-[11px] font-medium text-[#B5D4F4] disabled:opacity-60"
          >
            {plusActive ? "Active" : "Upgrade now"}
          </button>
        </div>
      </div>
      <Card title="What Plus unlocks">
        <LockRow
          icon={Bell}
          label="Absence alerts via SMS - same day"
          active={plusActive}
        />
        <LockRow
          icon={TrendingUp}
          label="Multi-term performance graphs"
          active={plusActive}
        />
        <LockRow
          icon={Clock}
          label="Homework deadline reminders"
          active={plusActive}
        />
        <LockRow
          icon={CalendarDays}
          label="Exam timetable early alerts"
          active={plusActive}
        />
        <LockRow icon={BarChart3} label="Results viewing" free />
        <LockRow icon={Wallet} label="Fee balance and payment history" free />
      </Card>
    </>
  );

  const renderActiveView = () => {
    if (activeView === "results") return renderResults();
    if (activeView === "fees") return renderFees();
    if (activeView === "homework") return renderHomework();
    if (activeView === "attendance") return renderAttendance();
    if (activeView === "timetable") return renderTimetable();
    if (activeView === "drills") return renderDrills();
    if (activeView === "ranking") return renderRanking();
    if (activeView === "notices") return renderNotices();
    if (activeView === "profile") return renderProfile();
    if (activeView === "insights") return renderFamilyInsights();
    if (activeView === "plus") return renderPlus();
    return renderHome();
  };

  const renderPaymentFlow = () => {
    const receiptNo = `REC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-0147`;
    if (payStep === "success") {
      return (
        <div className="px-3 py-5 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-[#E1F5EE] text-[#1D9E75]">
            <Check className="size-6" />
          </div>
          <div className="mb-1.5 text-[15px] font-medium text-[#20201d]">
            Payment request prepared
          </div>
          <div className="mb-3 text-[12px] leading-5 text-[#6f6d67]">
            Approve the {selectedMethod} prompt to complete {money(balance)}.
          </div>
          <div className="mb-3 rounded-[8px] bg-[#F1F0EA] p-3 text-left">
            {[
              ["Receipt", receiptNo],
              ["Date", new Date().toLocaleDateString()],
              ["Amount", money(balance)],
              ["Method", selectedMethod],
              ["Student", fullName],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between py-1 text-[11px]"
              >
                <span className="text-[#6f6d67]">{label}</span>
                <span className="font-medium text-[#20201d]">{value}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setPayStep("none");
              setActiveView("fees");
            }}
            className="h-10 w-full rounded-[8px] bg-[#042C53] text-[12px] font-medium text-[#B5D4F4]"
          >
            Back to portal
          </button>
        </div>
      );
    }

    return (
      <div className="px-3 py-3">
        <button
          type="button"
          onClick={() => setPayStep("none")}
          className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#185FA5]"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>
        <div className="py-3 text-center">
          <div className="mb-1 text-[11px] text-[#6f6d67]">
            {payStep === "confirm" ? "Confirm payment" : "Amount due"}
          </div>
          <div className="text-[28px] font-medium text-[#20201d]">
            {money(balance)}
          </div>
          <div className="mt-0.5 text-[10px] text-[#8c8982]">
            {fees.summary?.term_name || profile.term_name} - {fullName}
          </div>
        </div>
        {payStep === "select" ? (
          <>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.05em] text-[#8c8982]">
              Choose payment method
            </div>
            {[
              [
                "Airtel Money",
                "Pay via *115#",
                Phone,
                "bg-[#FFE8CC] text-[#D35400]",
              ],
              [
                "TNM Mpamba",
                "Pay via *116#",
                Phone,
                "bg-[#E8F0FE] text-[#1A73E8]",
              ],
              [
                "Bank transfer",
                "Manual - receipt required",
                Building2,
                "bg-[#E1F5EE] text-[#085041]",
              ],
            ].map(([name, sub, Icon, tone]: any) => {
              const selected = selectedMethod === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelectedMethod(name)}
                  className={`mb-1.5 flex w-full items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-left ${selected ? "border-2 border-[#185FA5] bg-[#E6F1FB]" : "border-[#DFDDD5] bg-white"}`}
                >
                  <span
                    className={`grid size-7 place-items-center rounded-[6px] ${tone}`}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-[#20201d]">
                      {name}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-[#6f6d67]">
                      {sub}
                    </span>
                  </span>
                  <span
                    className={`grid size-4 place-items-center rounded-full border ${selected ? "border-[#185FA5]" : "border-[#b8b5ac]"}`}
                  >
                    {selected ? (
                      <span className="size-2 rounded-full bg-[#185FA5]" />
                    ) : null}
                  </span>
                </button>
              );
            })}
            <div className="mb-3 mt-2">
              <div className="mb-1 text-[11px] text-[#6f6d67]">
                Mobile number
              </div>
              <div className="flex gap-1.5">
                <div className="flex h-9 items-center rounded-[8px] border border-[#D4D1C7] bg-[#F1F0EA] px-2.5 text-[12px] text-[#6f6d67]">
                  +265
                </div>
                <input
                  className="min-w-0 flex-1 rounded-[8px] border border-[#D4D1C7] bg-white px-2.5 text-[12px] text-[#20201d]"
                  placeholder="099 123 4567"
                  defaultValue="099 234 5678"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPayStep("confirm")}
              className="mb-2 h-10 w-full rounded-[8px] bg-[#042C53] text-[13px] font-medium text-[#B5D4F4]"
            >
              Continue - {money(balance)}
            </button>
            <div className="text-center text-[10px] leading-4 text-[#8c8982]">
              Payments are processed securely by SmartLink. A receipt will
              appear immediately after confirmation.
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 rounded-[12px] border border-[#DFDDD5] bg-white p-3">
              {[
                ["Student", fullName],
                [
                  "School",
                  payload?.session?.academic_year?.school_name ||
                    "SmartLink School",
                ],
                ["Term", fees.summary?.term_name || profile.term_name],
                ["Amount", money(balance)],
                ["Method", selectedMethod],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between py-1 text-[11px]"
                >
                  <span className="text-[#6f6d67]">{label}</span>
                  <span className="font-medium text-[#20201d]">
                    {value || "-"}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={confirmPayment}
              className="mb-2 h-10 w-full rounded-[8px] bg-[#042C53] text-[13px] font-medium text-[#B5D4F4]"
            >
              Confirm and pay {money(balance)}
            </button>
            <div className="text-center text-[10px] leading-4 text-[#8c8982]">
              You will receive a payment prompt on your phone. Approve it to
              complete this payment.
            </div>
          </>
        )}
      </div>
    );
  };

  const renderPortalAlerts = () => (
    <>
      {error && offline ? (
        <div className="mb-2 rounded-[8px] border border-[#FED7AA] bg-[#FFF7ED] px-3 py-2 text-[11px] font-medium text-[#9A3412]">
          {error}
        </div>
      ) : null}
      {urgent?.type && urgent.type !== "all_clear" && activeView === "home" ? (
        <div className="mb-2 rounded-[8px] border border-[#FED7AA] bg-[#FFFAF2] px-3 py-2 text-[11px] leading-4 text-[#9A3412]">
          {urgent.message}
        </div>
      ) : null}
      {offline ? (
        <div className="mb-2 inline-flex rounded-full border border-[#FED7AA] bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-medium text-[#9A3412]">
          Offline cache
        </div>
      ) : null}
    </>
  );

  const renderCelebrationOverlay = () => {
    if (isParent || !celebrationOverlay) return null;
    const style =
      celebrationStyles[String(celebrationOverlay.type || "")] ||
      celebrationStyles.default;
    const Icon = style.icon;
    const AccentIcon = style.accent;
    const stats = Array.isArray(celebrationOverlay.stats)
      ? celebrationOverlay.stats.slice(0, 2)
      : [];
    const visibleStats =
      stats.length > 0
        ? stats
        : [
            { label: "Completed", value: "Daily Drill" },
            { label: "Ranking", value: "Updated" },
          ];
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/70 px-4 py-6 backdrop-blur-sm">
        <div className="w-full max-w-[380px] overflow-hidden rounded-[24px] border border-white/40 bg-[#FFFCF4] text-center shadow-2xl">
          <div className={`relative grid place-items-center bg-linear-to-br ${style.gradient} px-6 pb-8 pt-9 text-white`}>
            <div className="absolute left-7 top-8 size-2 rounded-full bg-white/70" />
            <div className="absolute right-10 top-6 size-3 rounded-full bg-white/60" />
            <div className="absolute bottom-8 left-12 size-2.5 rounded-full bg-white/50" />
            <div className="grid size-28 place-items-center rounded-full border-[6px] border-white/70 bg-white/20 shadow-[0_14px_30px_rgba(92,55,10,0.28)]">
              <div className={`grid size-20 place-items-center rounded-full bg-white ${style.iconText} shadow-inner`}>
                <Icon className="size-10" />
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em]">
              <AccentIcon className="size-3.5" />
              {style.badge}
            </div>
          </div>
          <div className="px-5 pb-5 pt-4">
            <h2 className="text-[22px] font-semibold tracking-[0] text-[#20201d]">
              {celebrationOverlay.title || "Daily Drill progress"}
            </h2>
            <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-5 text-[#6f6d67]">
              {celebrationOverlay.message ||
                "Your Daily Drill progress has been updated."}
            </p>
            <div
              className={`mt-4 grid gap-2 ${
                visibleStats.length === 1 ? "grid-cols-1" : "grid-cols-2"
              }`}
            >
              {visibleStats.map((stat: any, index: number) => (
                <div
                  key={`${stat.label || "stat"}-${index}`}
                  className="min-w-0 rounded-[12px] border border-[#E7E5DE] bg-white px-3 py-2"
                >
                  <div className="break-words text-[20px] font-semibold text-[#20201d]">
                    {stat.value || "-"}
                  </div>
                  <div className="mt-0.5 break-words text-[10px] font-medium text-[#8c8982]">
                    {stat.label || "Progress"}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={closeCelebrationOverlay}
              className="mt-4 h-10 w-full rounded-[12px] bg-[#20201d] text-[13px] font-semibold text-white"
            >
              Keep practising
            </button>
          </div>
        </div>
      </div>
    );
  };

  const activeTitle = viewTitles[activeView] || "Overview";

  return (
    <div className="min-h-screen bg-[#F4F5F2] text-[#20201d]">
      {renderCelebrationOverlay()}
      <div className="lg:hidden sm:px-4 sm:py-3">
        <div className="mx-auto min-h-screen w-full max-w-[430px] overflow-hidden bg-[#F4F5F2] sm:min-h-0 sm:rounded-[24px] sm:border sm:border-[#DFDDD5] sm:shadow-sm">
          <header className="sticky top-0 z-30 border-b border-[#DFDDD5] bg-white px-4 pb-3 pt-3.5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <StudentAvatar profile={profile} user={user} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium text-[#20201d]">
                    {fullName}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-[#6f6d67]">
                    {studentMeta}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveView("notices")}
                  className="grid size-[30px] place-items-center rounded-[8px] border border-[#DFDDD5] bg-white text-[#6f6d67]"
                  aria-label="Open notices"
                >
                  <Bell className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView(isParent ? "insights" : "plus")}
                  className="grid size-[30px] place-items-center rounded-[8px] border border-[#DFDDD5] bg-white text-[#534AB7]"
                  aria-label={isParent ? "Open family insights" : "Open SmartLink Plus"}
                >
                  {isParent ? <HeartHandshake className="size-4" /> : <Crown className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="grid size-[30px] place-items-center rounded-[8px] border border-[#DFDDD5] bg-white text-[#6f6d67]"
                  aria-label="Log out"
                >
                  <LogOut className="size-4" />
                </button>
              </div>
            </div>

            {isParent && availableStudents.length > 1 ? (
              <label className="mb-3 block">
                <span className="sr-only">Choose learner</span>
                <select
                  value={activeStudentRef}
                  onChange={(event) => switchStudent(event.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#DFDDD5] bg-[#F8F7F2] px-2.5 text-[11px] font-medium text-[#20201d] outline-none focus:border-[#185FA5]"
                >
                  {availableStudents.map((student: any) => (
                    <option key={student.public_ref} value={student.public_ref}>
                      {student.full_name}{student.class_name ? ` - ${student.class_name}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {isParent ? (
              <button
                type="button"
                onClick={() => setActiveView("insights")}
                className="flex w-full items-center gap-2 rounded-[8px] bg-[#EEEDFE] px-2.5 py-2 text-left"
              >
                <HeartHandshake className="size-3.5 shrink-0 text-[#534AB7]" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#3C3489]">
                  {familyInsights.length
                    ? `${familyInsights.length} school-approved learning ${familyInsights.length === 1 ? "update" : "updates"}`
                    : "Family learning updates will appear after school review"}
                </span>
                <span className="rounded-full bg-[#CECBF6] px-2 py-0.5 text-[10px] font-medium text-[#3C3489]">
                  View
                </span>
              </button>
            ) : plusActive ? (
              <button
                type="button"
                onClick={() => setActiveView("plus")}
                className="flex w-full items-center gap-2 rounded-[8px] bg-[#E1F5EE] px-2.5 py-2 text-left"
              >
                <Crown className="size-3.5 shrink-0 text-[#0F6E56]" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#085041]">
                  SmartLink Plus active - renews at term end
                </span>
                <span className="text-[10px] font-medium text-[#085041]">
                  Active
                </span>
              </button>
            ) : balance > 0 ? (
              <button
                type="button"
                onClick={showPayFlow}
                className="flex w-full items-center gap-2 rounded-[8px] bg-[#FCEBEB] px-3 py-2 text-left"
              >
                <AlertCircle className="size-3.5 shrink-0 text-[#A32D2D]" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#791F1F]">
                  Outstanding balance: {money(balance)}
                  {fees.summary?.next_due_date
                    ? ` - due ${shortDate(fees.summary.next_due_date)}`
                    : ""}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-[#A32D2D]">
                  Pay now
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveView("plus")}
                className="flex w-full items-center gap-2 rounded-[8px] bg-[#EEEDFE] px-2.5 py-2 text-left"
              >
                <Crown className="size-3.5 shrink-0 text-[#534AB7]" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#3C3489]">
                  Upgrade to SmartLink Plus for real-time alerts and more
                </span>
                <span className="rounded-full bg-[#CECBF6] px-2 py-0.5 text-[10px] font-medium text-[#3C3489]">
                  See plans
                </span>
              </button>
            )}
          </header>

          {payStep !== "none" ? (
            renderPaymentFlow()
          ) : (
            <>
              <nav className="flex overflow-x-auto border-b border-[#DFDDD5] bg-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {visibleSecondaryNav.map((item) => {
                  const Icon = item.icon;
                  const active = item.id ? activeView === item.id : false;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleSecondaryNav(item)}
                      disabled={item.action === "download" && openingReportId}
                      className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[11px] transition ${
                        active
                          ? "border-[#185FA5] font-medium text-[#185FA5]"
                          : "border-transparent text-[#6f6d67]"
                      }`}
                    >
                      <Icon
                        className={`size-3.5 ${item.action === "refresh" && refreshing ? "animate-spin" : ""}`}
                      />
                      {item.action === "download" && openingReportId
                        ? "Preparing"
                        : item.label}
                    </button>
                  );
                })}
              </nav>

              <main className="min-h-[390px] px-3 pb-32 pt-3">
                {renderPortalAlerts()}
                {renderActiveView()}
              </main>

              <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-[430px] border-t border-[#DFDDD5] bg-white pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] sm:bottom-3 sm:rounded-b-[24px] sm:border-x">
                {bottomNav.map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveView(item.id)}
                      className={`flex flex-1 flex-col items-center gap-1 text-[9px] ${active ? "text-[#185FA5]" : "text-[#8c8982]"}`}
                    >
                      <Icon className="size-[18px]" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </>
          )}
        </div>
      </div>

      <div className="hidden h-screen bg-[#F4F5F2] p-4 lg:block">
        <div className="mx-auto flex h-[calc(100vh-32px)] max-w-[1180px] overflow-hidden rounded-[14px] border border-[#DFDDD5] bg-[#F4F5F2] shadow-sm">
          <aside className="flex w-[200px] shrink-0 flex-col bg-[#042C53]">
            <div className="border-b border-white/10 px-4 py-4">
              <div className="text-[13px] font-medium text-[#B5D4F4]">
                SmartLink Schools
              </div>
              <div className="mt-0.5 text-[10px] text-[#B5D4F4]/50">
                {isParent ? "Family portal" : "Student portal"}
              </div>
            </div>
            <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5">
              <StudentAvatar
                profile={profile}
                user={user}
                className="size-[30px]"
                textClassName="text-[11px]"
              />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-[#E6F1FB]">
                  {fullName}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-[#B5D4F4]/55">
                  {profile.class_name || "-"} -{" "}
                  {profile.academic_year_name || "-"}
                </div>
              </div>
            </div>
            {isParent && availableStudents.length > 1 ? (
              <div className="border-b border-white/10 px-3 py-2.5">
                <label className="block text-[9px] font-medium uppercase text-[#B5D4F4]/45">
                  Viewing learner
                  <select
                    value={activeStudentRef}
                    onChange={(event) => switchStudent(event.target.value)}
                    className="mt-1.5 h-8 w-full rounded-[7px] border border-white/15 bg-[#0C447C] px-2 text-[10px] normal-case text-[#E6F1FB] outline-none"
                  >
                    {availableStudents.map((student: any) => (
                      <option key={student.public_ref} value={student.public_ref}>{student.full_name}{student.class_name ? ` - ${student.class_name}` : ""}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <nav className="min-h-0 flex-1 overflow-y-auto py-2">
              {visibleDesktopNavGroups.map((group) => (
                <div key={group.label}>
                  <div className="px-4 pb-1.5 pt-2.5 text-[9px] font-medium uppercase text-[#B5D4F4]/35">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeView === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveView(item.id)}
                        className={`flex w-full items-center gap-2.5 border-l-2 px-4 py-2 text-left text-[12px] transition ${
                          active
                            ? "border-[#378ADD] bg-[#185FA5]/35 text-[#B5D4F4]"
                            : "border-transparent text-[#B5D4F4]/65 hover:bg-white/5 hover:text-[#B5D4F4]"
                        }`}
                      >
                        <Icon className="size-[15px] shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setActiveView(isParent ? "insights" : "plus")}
                className={`mx-3 mt-3 rounded-[8px] border px-3 py-2.5 text-left ${
                  (isParent && activeView === "insights") || (!isParent && (activeView === "plus" || plusActive))
                    ? "border-[#5DCAA5]/30 bg-[#1D9E75]/20"
                    : "border-[#AFA9EC]/30 bg-[#534AB7]/25"
                }`}
              >
                <div
                  className={`mb-0.5 flex items-center gap-1.5 text-[10px] font-medium ${(isParent && activeView === "insights") || (!isParent && (activeView === "plus" || plusActive)) ? "text-[#9FE1CB]" : "text-[#CECBF6]"}`}
                >
                  {isParent ? <HeartHandshake className="size-3" /> : <Crown className="size-3" />}
                  {isParent ? "Family insights" : plusActive ? "Plus active" : "Upgrade to Plus"}
                </div>
                <div
                  className={`text-[9px] ${(isParent && activeView === "insights") || (!isParent && (activeView === "plus" || plusActive)) ? "text-[#9FE1CB]/65" : "text-[#CECBF6]/60"}`}
                >
                  {isParent ? `${familyInsights.length} school-approved ${familyInsights.length === 1 ? "update" : "updates"}` : "Absence alerts, trends and reminders"}
                </div>
              </button>
            </nav>
            <button
              type="button"
              onClick={handleLogout}
              className="m-3 flex items-center justify-center gap-2 rounded-[8px] border border-white/10 px-3 py-2 text-[12px] font-medium text-[#B5D4F4] hover:bg-white/5"
            >
              <LogOut className="size-3.5" />
              Log out
            </button>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-[54px] shrink-0 items-center justify-between border-b border-[#DFDDD5] bg-white px-5">
              <div className="text-[14px] font-medium text-[#20201d]">
                {activeTitle}
              </div>
              <div className="flex items-center gap-2">
                {balance > 0 ? (
                  <button
                    type="button"
                    onClick={showPayFlow}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#FCEBEB] px-3 text-[11px] font-medium text-[#791F1F]"
                  >
                    <AlertCircle className="size-3" />
                    {money(balance)} due
                    {fees.summary?.next_due_date
                      ? ` - ${shortDate(fees.summary.next_due_date)}`
                      : ""}
                  </button>
                ) : (
                  <span className="inline-flex h-7 items-center rounded-full bg-[#E1F5EE] px-3 text-[11px] font-medium text-[#085041]">
                    Fees clear
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setActiveView("notices")}
                  className="grid size-7 place-items-center rounded-[8px] border border-[#DFDDD5] bg-white text-[#6f6d67]"
                  aria-label="Open notices"
                >
                  <Bell className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => openReportPdf()}
                  disabled={Boolean(openingReportId)}
                  className="grid size-7 place-items-center rounded-[8px] border border-[#DFDDD5] bg-white text-[#6f6d67] disabled:opacity-60"
                  aria-label="Open report PDF"
                >
                  <FileText className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => loadPortal({ silent: true })}
                  className="grid size-7 place-items-center rounded-[8px] border border-[#DFDDD5] bg-white text-[#6f6d67]"
                  aria-label="Sync portal"
                >
                  <RefreshCcw
                    className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="grid size-7 place-items-center rounded-[8px] border border-[#DFDDD5] bg-white text-[#6f6d67]"
                  aria-label="Log out"
                >
                  <LogOut className="size-3.5" />
                </button>
              </div>
            </header>

            <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-4">
              {payStep !== "none" ? (
                <div className="mx-auto max-w-[430px] rounded-[12px] border border-[#DFDDD5] bg-white shadow-sm">
                  {renderPaymentFlow()}
                </div>
              ) : (
                <div className="mx-auto max-w-[920px]">
                  {renderPortalAlerts()}
                  {renderActiveView()}
                </div>
              )}
            </main>
          </section>
        </div>
      </div>
    </div>
  );
}
