export interface PublishCandidateJobData {
  candidateId: string;
  /** The only channel authorized by the Autopilot decision for this job. */
  channelId: string;
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
  operatingSystem?: string | null;
  deviceType?: string | null;
  referrer?: string | null;
  intelligenceClass?:
    | "HUMAN"
    | "BOT"
    | "PREVIEW_CRAWLER"
    | "SUSPECTED_AUTOMATION";
}
