import { Router } from "express"
import { rateLimitLogin } from "../middleware/loginRateLimit.js"
import { requireTeamAuth, requireTeamPasswordReady } from "../middleware/teamAuth.js"
import { requireTeamPermission, TEAM_PERMISSIONS } from "../services/teamAccessService.js"
import { asyncHandler } from "../utils/http.js"
import { teamChangePassword, teamLogin, teamMe } from "../controllers/teamAuthController.js"
import {
  changeTeamOpportunityStage,
  confirmTeamSchoolRelationship,
  createTeamActivity,
  createTeamContact,
  createTeamOpportunity,
  createTeamSchool,
  findTeamSchoolDuplicates,
  getTeamOpportunity,
  getTeamSchool,
  listTeamOpportunities,
  listTeamSchools,
  updateTeamOpportunity,
  updateTeamSchool,
  updateTeamContact,
} from "../controllers/teamCrmController.js"
import {
  addTeamTicketComment,
  createTeamMeeting,
  createTeamSupportTicket,
  createTeamTask,
  listTeamMeetings,
  listTeamNotifications,
  listTeamSupportTickets,
  listTeamTasks,
  readAllTeamNotifications,
  readTeamNotification,
  updateTeamMeeting,
  updateTeamSupportTicket,
  updateTeamTask,
} from "../controllers/teamWorkController.js"
import {
  approveTeamGoLive,
  createTeamOnboarding,
  createTeamProposal,
  createTeamSubscription,
  decideTeamProposal,
  getTeamOnboarding,
  getTeamProposal,
  listTeamOnboarding,
  listTeamProposals,
  listTeamSubscriptions,
  markTeamProposalSent,
  submitTeamProposal,
  updateTeamOnboarding,
  updateTeamOnboardingItem,
  updateTeamSubscription,
} from "../controllers/teamCommercialController.js"
import {
  createTeamMember,
  getTeamDashboard,
  getTeamReports,
  listTeamAudit,
  listTeamMembers,
  teamGlobalSearch,
  teamRoleMatrix,
  updateTeamMember,
} from "../controllers/teamManagementController.js"

const router=Router()

router.post("/auth/login",rateLimitLogin,asyncHandler(teamLogin))
router.get("/auth/me",requireTeamAuth,asyncHandler(teamMe))
router.post("/auth/change-password",requireTeamAuth,asyncHandler(teamChangePassword))

router.use(requireTeamAuth)
router.use(requireTeamPasswordReady)

router.get("/dashboard",requireTeamPermission(TEAM_PERMISSIONS.DASHBOARD_VIEW),asyncHandler(getTeamDashboard))
router.get("/search",requireTeamPermission(TEAM_PERMISSIONS.DASHBOARD_VIEW),asyncHandler(teamGlobalSearch))

router.get("/schools",requireTeamPermission(TEAM_PERMISSIONS.SCHOOLS_VIEW_ALL,TEAM_PERMISSIONS.SCHOOLS_VIEW_ASSIGNED),asyncHandler(listTeamSchools))
router.get("/schools/duplicates",requireTeamPermission(TEAM_PERMISSIONS.SCHOOLS_CREATE,TEAM_PERMISSIONS.SCHOOLS_UPDATE),asyncHandler(findTeamSchoolDuplicates))
router.post("/schools",requireTeamPermission(TEAM_PERMISSIONS.SCHOOLS_CREATE),asyncHandler(createTeamSchool))
router.get("/schools/:schoolRef",requireTeamPermission(TEAM_PERMISSIONS.SCHOOLS_VIEW_ALL,TEAM_PERMISSIONS.SCHOOLS_VIEW_ASSIGNED),asyncHandler(getTeamSchool))
router.patch("/schools/:schoolRef",requireTeamPermission(TEAM_PERMISSIONS.SCHOOLS_UPDATE),asyncHandler(updateTeamSchool))
router.post("/schools/:schoolRef/contacts",requireTeamPermission(TEAM_PERMISSIONS.CONTACTS_MANAGE),asyncHandler(createTeamContact))
router.patch("/schools/:schoolRef/contacts/:contactRef",requireTeamPermission(TEAM_PERMISSIONS.CONTACTS_MANAGE),asyncHandler(updateTeamContact))
router.post("/schools/:schoolRef/relationships",requireTeamPermission(TEAM_PERMISSIONS.SCHOOLS_UPDATE),asyncHandler(confirmTeamSchoolRelationship))

router.get("/opportunities",requireTeamPermission(TEAM_PERMISSIONS.OPPORTUNITIES_MANAGE,TEAM_PERMISSIONS.PROPOSALS_MANAGE),asyncHandler(listTeamOpportunities))
router.post("/opportunities",requireTeamPermission(TEAM_PERMISSIONS.OPPORTUNITIES_MANAGE),asyncHandler(createTeamOpportunity))
router.get("/opportunities/:opportunityRef",requireTeamPermission(TEAM_PERMISSIONS.OPPORTUNITIES_MANAGE,TEAM_PERMISSIONS.PROPOSALS_MANAGE),asyncHandler(getTeamOpportunity))
router.patch("/opportunities/:opportunityRef",requireTeamPermission(TEAM_PERMISSIONS.OPPORTUNITIES_MANAGE),asyncHandler(updateTeamOpportunity))
router.post("/opportunities/:opportunityRef/stage",requireTeamPermission(TEAM_PERMISSIONS.OPPORTUNITIES_MANAGE),asyncHandler(changeTeamOpportunityStage))
router.post("/activities",requireTeamPermission(TEAM_PERMISSIONS.ACTIVITIES_MANAGE),asyncHandler(createTeamActivity))

router.get("/tasks",requireTeamPermission(TEAM_PERMISSIONS.TASKS_MANAGE),asyncHandler(listTeamTasks))
router.post("/tasks",requireTeamPermission(TEAM_PERMISSIONS.TASKS_MANAGE),asyncHandler(createTeamTask))
router.patch("/tasks/:taskRef",requireTeamPermission(TEAM_PERMISSIONS.TASKS_MANAGE),asyncHandler(updateTeamTask))
router.get("/meetings",requireTeamPermission(TEAM_PERMISSIONS.MEETINGS_MANAGE),asyncHandler(listTeamMeetings))
router.post("/meetings",requireTeamPermission(TEAM_PERMISSIONS.MEETINGS_MANAGE),asyncHandler(createTeamMeeting))
router.patch("/meetings/:meetingRef",requireTeamPermission(TEAM_PERMISSIONS.MEETINGS_MANAGE),asyncHandler(updateTeamMeeting))

router.get("/proposals",requireTeamPermission(TEAM_PERMISSIONS.PROPOSALS_MANAGE,TEAM_PERMISSIONS.PROPOSALS_APPROVE),asyncHandler(listTeamProposals))
router.post("/proposals",requireTeamPermission(TEAM_PERMISSIONS.PROPOSALS_MANAGE),asyncHandler(createTeamProposal))
router.get("/proposals/:proposalRef",requireTeamPermission(TEAM_PERMISSIONS.PROPOSALS_MANAGE,TEAM_PERMISSIONS.PROPOSALS_APPROVE),asyncHandler(getTeamProposal))
router.post("/proposals/:proposalRef/submit",requireTeamPermission(TEAM_PERMISSIONS.PROPOSALS_MANAGE),asyncHandler(submitTeamProposal))
router.post("/proposals/:proposalRef/decision",requireTeamPermission(TEAM_PERMISSIONS.DISCOUNTS_APPROVE),asyncHandler(decideTeamProposal))
router.post("/proposals/:proposalRef/sent",requireTeamPermission(TEAM_PERMISSIONS.PROPOSALS_MANAGE),asyncHandler(markTeamProposalSent))

router.get("/onboarding",requireTeamPermission(TEAM_PERMISSIONS.ONBOARDING_MANAGE),asyncHandler(listTeamOnboarding))
router.post("/onboarding",requireTeamPermission(TEAM_PERMISSIONS.ONBOARDING_MANAGE),asyncHandler(createTeamOnboarding))
router.get("/onboarding/:projectRef",requireTeamPermission(TEAM_PERMISSIONS.ONBOARDING_MANAGE),asyncHandler(getTeamOnboarding))
router.patch("/onboarding/:projectRef",requireTeamPermission(TEAM_PERMISSIONS.ONBOARDING_MANAGE),asyncHandler(updateTeamOnboarding))
router.patch("/onboarding/:projectRef/checklist/:itemRef",requireTeamPermission(TEAM_PERMISSIONS.ONBOARDING_MANAGE),asyncHandler(updateTeamOnboardingItem))
router.post("/onboarding/:projectRef/go-live",requireTeamPermission(TEAM_PERMISSIONS.ONBOARDING_APPROVE_GO_LIVE),asyncHandler(approveTeamGoLive))

router.get("/subscriptions",requireTeamPermission(TEAM_PERMISSIONS.SUBSCRIPTIONS_VIEW),asyncHandler(listTeamSubscriptions))
router.post("/subscriptions",requireTeamPermission(TEAM_PERMISSIONS.SUBSCRIPTIONS_MANAGE),asyncHandler(createTeamSubscription))
router.patch("/subscriptions/:subscriptionRef",requireTeamPermission(TEAM_PERMISSIONS.SUBSCRIPTIONS_MANAGE),asyncHandler(updateTeamSubscription))

router.get("/support",requireTeamPermission(TEAM_PERMISSIONS.SUPPORT_MANAGE),asyncHandler(listTeamSupportTickets))
router.post("/support",requireTeamPermission(TEAM_PERMISSIONS.SUPPORT_MANAGE),asyncHandler(createTeamSupportTicket))
router.patch("/support/:ticketRef",requireTeamPermission(TEAM_PERMISSIONS.SUPPORT_MANAGE),asyncHandler(updateTeamSupportTicket))
router.post("/support/:ticketRef/comments",requireTeamPermission(TEAM_PERMISSIONS.SUPPORT_MANAGE),asyncHandler(addTeamTicketComment))

router.get("/notifications",asyncHandler(listTeamNotifications))
router.post("/notifications/read-all",asyncHandler(readAllTeamNotifications))
router.post("/notifications/:notificationRef/read",asyncHandler(readTeamNotification))
router.get("/team-members",requireTeamPermission(TEAM_PERMISSIONS.DASHBOARD_VIEW),asyncHandler(listTeamMembers))
router.post("/team-members",requireTeamPermission(TEAM_PERMISSIONS.TEAM_MEMBERS_MANAGE),asyncHandler(createTeamMember))
router.patch("/team-members/:userRef",requireTeamPermission(TEAM_PERMISSIONS.TEAM_MEMBERS_MANAGE),asyncHandler(updateTeamMember))
router.get("/roles",requireTeamPermission(TEAM_PERMISSIONS.TEAM_MEMBERS_MANAGE,TEAM_PERMISSIONS.SETTINGS_MANAGE),asyncHandler(teamRoleMatrix))
router.get("/reports",requireTeamPermission(TEAM_PERMISSIONS.REPORTS_VIEW),asyncHandler(getTeamReports))
router.get("/audit-log",requireTeamPermission(TEAM_PERMISSIONS.AUDIT_VIEW),asyncHandler(listTeamAudit))

export default router
