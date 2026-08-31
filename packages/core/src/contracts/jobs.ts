export interface PublishCandidateJobData {
  candidateId: string;
  /** The channel authorized by the Autopilot decision for this job. */
  channelId: string;
  /** One global offer slot may fan out to these independent channel jobs. */
  fanoutChannelIds?: string[];
  offerSlotId?: string;
  pacingLeader?: boolean;
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
    "HUMAN" | "BOT" | "PREVIEW_CRAWLER" | "SUSPECTED_AUTOMATION";
}
