export interface PublishCandidateJobData {
  candidateId: string;
}

export interface PublishClickJobData {
  eventId: string;
  linkId: string;
  tenantId: string;
  clickedAt: string;
  classification: "VALID" | "PREVIEW_BOT" | "SUSPECTED_BOT";
  classificationReason?: string;
  visitorHash?: string | null;
  userAgentFamily?: string | null;
  deviceType?: string | null;
}
