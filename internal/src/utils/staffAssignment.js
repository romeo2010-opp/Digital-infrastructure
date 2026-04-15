export function createEmptyStaffDraft() {
  return {
    fullName: "",
    email: "",
    phone: "",
    roleCode: "MANAGER",
    existingUserPublicId: "",
  }
}

export function formatManagerCandidateLabel(candidate) {
  const displayName = String(candidate?.fullName || "Unnamed manager").trim()
  const reference = String(candidate?.userPublicId || candidate?.email || candidate?.phone || "").trim()
  return [displayName, reference].filter(Boolean).join(" · ")
}
