export type SoftwareTeamsCommand = "plan" | "implement" | "quick" | "review" | "feedback" | "ping";

export interface ParsedIntent {
  command: SoftwareTeamsCommand;
  description: string;
  clickUpUrl: string | null;
  fullFlow: boolean;
  isFeedback: boolean;
  isApproval: boolean;
  dryRun: boolean;
}

export interface FeatureBranchContext {
  branchName: string;
  defaultBranch: string;
}
