import {
  applyWeeklyActivitiesToVersion,
  archiveBellSchedule,
  archiveCurriculumRequirement,
  archiveFacility,
  archiveStreamSchedulingRule,
  archiveSubjectFocusAssignment,
  archiveSubjectFocusCategory,
  archiveSubjectFocusRule,
  archiveWeeklyActivity,
  assignEquipment,
  calculateExamAvailabilityWindows,
  createBellSchedule,
  createBellScheduleSlot,
  createCurriculumRequirement,
  createEquipment,
  createFacility,
  createStreamSchedulingRule,
  createSubjectFocusAssignment,
  createSubjectFocusCategory,
  createSubjectFocusRule,
  createWeeklyActivity,
  deleteBellScheduleSlot,
  duplicateFacility,
  duplicateWeeklyActivity,
  getFacilityDetail,
  getWeeklyActivity,
  listBellSchedules,
  listBellSlotTags,
  listCurriculumRequirements,
  listEquipment,
  listFacilities,
  listOccupancy,
  listStreamSchedulingRules,
  listSubjectFocusAssignments,
  listSubjectFocusCategories,
  listSubjectFocusRules,
  listTimetableDayTemplates,
  listWeeklyActivities,
  setBellScheduleSlotTags,
  setFacilityAvailability,
  setFacilitySubjectEligibility,
  setTimetableDayTemplate,
  updateBellSchedule,
  updateBellScheduleSlot,
  updateCurriculumRequirement,
  updateFacility,
  updateStreamSchedulingRule,
  updateSubjectFocusAssignment,
  updateSubjectFocusCategory,
  updateSubjectFocusRule,
  updateWeeklyActivity,
  validateFacilityUse,
  validateWeeklyActivity,
} from "./schedulingFoundation.service.js"

async function send(res, payload, status = 200) {
  res.status(status).json(payload)
}

export const listFacilitiesController = async (req, res) => send(res, await listFacilities(req))
export const listBellSchedulesController = async (req, res) => send(res, await listBellSchedules(req))
export const listBellSlotTagsController = async (req, res) => send(res, await listBellSlotTags(req))
export const setBellScheduleSlotTagsController = async (req, res) => send(res, await setBellScheduleSlotTags(req))
export const listTimetableDayTemplatesController = async (req, res) => send(res, await listTimetableDayTemplates(req))
export const setTimetableDayTemplateController = async (req, res) => send(res, await setTimetableDayTemplate(req))
export const createBellScheduleController = async (req, res) => send(res, await createBellSchedule(req), 201)
export const updateBellScheduleController = async (req, res) => send(res, await updateBellSchedule(req))
export const archiveBellScheduleController = async (req, res) => send(res, await archiveBellSchedule(req))
export const createBellScheduleSlotController = async (req, res) => send(res, await createBellScheduleSlot(req), 201)
export const updateBellScheduleSlotController = async (req, res) => send(res, await updateBellScheduleSlot(req))
export const deleteBellScheduleSlotController = async (req, res) => send(res, await deleteBellScheduleSlot(req))
export const createFacilityController = async (req, res) => send(res, await createFacility(req), 201)
export const getFacilityController = async (req, res) => send(res, await getFacilityDetail(req))
export const updateFacilityController = async (req, res) => send(res, await updateFacility(req))
export const archiveFacilityController = async (req, res) => send(res, await archiveFacility(req))
export const duplicateFacilityController = async (req, res) => send(res, await duplicateFacility(req), 201)
export const listEquipmentController = async (req, res) => send(res, await listEquipment(req))
export const createEquipmentController = async (req, res) => send(res, await createEquipment(req), 201)
export const assignEquipmentController = async (req, res) => send(res, await assignEquipment(req))
export const setFacilitySubjectEligibilityController = async (req, res) => send(res, await setFacilitySubjectEligibility(req))
export const setFacilityAvailabilityController = async (req, res) => send(res, await setFacilityAvailability(req), 201)
export const validateFacilityUseController = async (req, res) => send(res, await validateFacilityUse(req))
export const listWeeklyActivitiesController = async (req, res) => send(res, await listWeeklyActivities(req))
export const createWeeklyActivityController = async (req, res) => send(res, await createWeeklyActivity(req), 201)
export const getWeeklyActivityController = async (req, res) => send(res, await getWeeklyActivity(req))
export const updateWeeklyActivityController = async (req, res) => send(res, await updateWeeklyActivity(req))
export const archiveWeeklyActivityController = async (req, res) => send(res, await archiveWeeklyActivity(req))
export const duplicateWeeklyActivityController = async (req, res) => send(res, await duplicateWeeklyActivity(req), 201)
export const validateWeeklyActivityController = async (req, res) => send(res, await validateWeeklyActivity(req))
export const listOccupancyController = async (req, res) => send(res, await listOccupancy(req))
export const calculateExamAvailabilityWindowsController = async (req, res) => send(res, await calculateExamAvailabilityWindows(req))
export const applyWeeklyActivitiesToVersionController = async (req, res) => send(res, await applyWeeklyActivitiesToVersion(req))
export const listCurriculumRequirementsController = async (req, res) => send(res, await listCurriculumRequirements(req))
export const createCurriculumRequirementController = async (req, res) => send(res, await createCurriculumRequirement(req), 201)
export const updateCurriculumRequirementController = async (req, res) => send(res, await updateCurriculumRequirement(req))
export const archiveCurriculumRequirementController = async (req, res) => send(res, await archiveCurriculumRequirement(req))
export const listSubjectFocusCategoriesController = async (req, res) => send(res, await listSubjectFocusCategories(req))
export const createSubjectFocusCategoryController = async (req, res) => send(res, await createSubjectFocusCategory(req), 201)
export const updateSubjectFocusCategoryController = async (req, res) => send(res, await updateSubjectFocusCategory(req))
export const archiveSubjectFocusCategoryController = async (req, res) => send(res, await archiveSubjectFocusCategory(req))
export const listSubjectFocusAssignmentsController = async (req, res) => send(res, await listSubjectFocusAssignments(req))
export const createSubjectFocusAssignmentController = async (req, res) => send(res, await createSubjectFocusAssignment(req), 201)
export const updateSubjectFocusAssignmentController = async (req, res) => send(res, await updateSubjectFocusAssignment(req))
export const archiveSubjectFocusAssignmentController = async (req, res) => send(res, await archiveSubjectFocusAssignment(req))
export const listSubjectFocusRulesController = async (req, res) => send(res, await listSubjectFocusRules(req))
export const createSubjectFocusRuleController = async (req, res) => send(res, await createSubjectFocusRule(req), 201)
export const updateSubjectFocusRuleController = async (req, res) => send(res, await updateSubjectFocusRule(req))
export const archiveSubjectFocusRuleController = async (req, res) => send(res, await archiveSubjectFocusRule(req))
export const listStreamSchedulingRulesController = async (req, res) => send(res, await listStreamSchedulingRules(req))
export const createStreamSchedulingRuleController = async (req, res) => send(res, await createStreamSchedulingRule(req), 201)
export const updateStreamSchedulingRuleController = async (req, res) => send(res, await updateStreamSchedulingRule(req))
export const archiveStreamSchedulingRuleController = async (req, res) => send(res, await archiveStreamSchedulingRule(req))
