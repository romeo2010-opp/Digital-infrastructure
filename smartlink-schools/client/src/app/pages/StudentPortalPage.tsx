import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
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
  HelpCircle,
  Heart,
  Home,
  Lightbulb,
  Lock,
  LogOut,
  NotebookTabs,
  Phone,
  RefreshCcw,
  Smile,
  ThumbsUp,
  TrendingUp,
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
  | "notices"
  | "profile"
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

const viewTitles: Record<PortalView, string> = {
  home: "Overview",
  results: "Academic results",
  fees: "Fees & payments",
  homework: "Homework",
  attendance: "Attendance",
  timetable: "Timetable",
  drills: "Daily drills",
  notices: "Notices",
  profile: "Personal profile",
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

function drillScoreTone(value: any) {
  const number = Number(value || 0);
  if (number >= 70) return "text-[#0F6E56]";
  if (number >= 50) return "text-[#BA7517]";
  return "text-[#993C1D]";
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
        {percent(score)}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${gradeClass(subject.grade, score)}`}
      >
        {subject.grade || "-"}
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
}: {
  announcement: any;
  api: any;
  token: string;
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

        <div className="flex flex-wrap gap-1.5">
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
        </div>

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
                    onClick={() => choosePoll(optionId)}
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
            {!pollVote ? (
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
  const { api, token, user, logout } = usePortal();
  const [payload, setPayload] = useState<any>(null);
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

  const cacheKey = useMemo(() => {
    const id = user?.studentId || user?.studentCode || user?.id || "student";
    return `smartlink.schools.studentPortal.${id}`;
  }, [user?.id, user?.studentCode, user?.studentId]);

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
      const response = await api.getStudentPortal(token);
      const nextPayload = response?.student_portal || response;
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
  }, [drillCacheKey, token]);

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
            Loading student portal...
          </span>
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

      <Card
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
      </Card>

      <Card title="Announcements">
        {announcements.length ? (
          <div className="grid gap-2.5">
            {announcements.slice(0, 4).map((announcement: any) => (
              <AnnouncementCard
                key={announcement.id}
                announcement={announcement}
                api={api}
                token={token}
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
        onClick={() => setActiveView("plus")}
        className="mb-2.5 flex w-full items-center gap-2 rounded-[12px] border border-[#AFA9EC] bg-white px-3.5 py-3 text-left"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#EEEDFE] text-[#534AB7]">
          {plusActive ? (
            <Check className="size-4" />
          ) : (
            <Bell className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-[#3C3489]">
            {plusActive
              ? "SmartLink Plus active"
              : "Get absence alerts instantly"}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[#534AB7]">
            {plusActive
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
                drillPayload?.action_required || "No daily drill is ready yet."
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
                const draftAnswer =
                  drillAnswers[key] ?? question.student_answer ?? "";
                const answered = drillQuestionAnswered(question);
                const correct =
                  question.is_correct === 1 || question.is_correct === true;
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
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${correct ? "bg-[#E1F5EE] text-[#085041]" : "bg-[#FCEBEB] text-[#791F1F]"}`}
                        >
                          {correct ? "Correct" : "Review"}
                        </span>
                      ) : answered ? (
                        <span className="rounded-full bg-[#E6F1FB] px-2 py-0.5 text-[10px] font-medium text-[#0C447C]">
                          Saved
                        </span>
                      ) : null}
                    </div>

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
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-medium text-[#6f6d67]">
                          <span>
                            Your answer: {question.student_answer || "-"}
                          </span>
                          <span>
                            Correct answer: {question.correct_answer || "-"}
                          </span>
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
    if (activeView === "notices") return renderNotices();
    if (activeView === "profile") return renderProfile();
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

  const activeTitle = viewTitles[activeView] || "Overview";

  return (
    <div className="min-h-screen bg-[#F4F5F2] text-[#20201d]">
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
                  onClick={() => setActiveView("plus")}
                  className="grid size-[30px] place-items-center rounded-[8px] border border-[#DFDDD5] bg-white text-[#534AB7]"
                  aria-label="Open SmartLink Plus"
                >
                  <Crown className="size-4" />
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

            {plusActive ? (
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
                {secondaryNav.map((item) => {
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
                Student portal
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
            <nav className="min-h-0 flex-1 overflow-y-auto py-2">
              {desktopNavGroups.map((group) => (
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
                onClick={() => setActiveView("plus")}
                className={`mx-3 mt-3 rounded-[8px] border px-3 py-2.5 text-left ${
                  activeView === "plus" || plusActive
                    ? "border-[#5DCAA5]/30 bg-[#1D9E75]/20"
                    : "border-[#AFA9EC]/30 bg-[#534AB7]/25"
                }`}
              >
                <div
                  className={`mb-0.5 flex items-center gap-1.5 text-[10px] font-medium ${activeView === "plus" || plusActive ? "text-[#9FE1CB]" : "text-[#CECBF6]"}`}
                >
                  <Crown className="size-3" />
                  {plusActive ? "Plus active" : "Upgrade to Plus"}
                </div>
                <div
                  className={`text-[9px] ${activeView === "plus" || plusActive ? "text-[#9FE1CB]/65" : "text-[#CECBF6]/60"}`}
                >
                  Absence alerts, trends and reminders
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
