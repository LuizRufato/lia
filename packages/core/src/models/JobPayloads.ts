import { z } from "zod";

export const EvaluateOfferJobSchema = z.object({
  schemaVersion: z.string(),
  correlationId: z.string(),
  tenantId: z.string(),
  observationId: z.string(),
  action: z.literal("evaluate"),
});

export type EvaluateOfferJob = z.infer<typeof EvaluateOfferJobSchema>;
