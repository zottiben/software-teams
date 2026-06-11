const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const BRANCH_ALLOWED_RE = /^[-A-Za-z0-9_./@]+$/;

const CLONE_URL_HTTPS_RE = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;%=-]+$/;
const CLONE_URL_SSH_RE = /^git@[A-Za-z0-9._-]+:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/;
const CLONE_URL_INJECTION_RE = /[$`();|&<>\\]/;

const BRANCH_WHITESPACE_RE = /\s/;

export function validateOwnerRepo(value: string): string {
  if (!OWNER_REPO_RE.test(value)) {
    throw new Error(
      `Invalid owner/repo "${value}": must match <owner>/<repo> using only alphanumeric, hyphen, underscore, and dot characters.`,
    );
  }
  return value;
}

export function validateBranchName(value: string): string {
  if (!value || value.startsWith("-") || value.startsWith(".")) {
    throw new Error(
      `Invalid branch name "${value}": must not be empty or start with '-' or '.'.`,
    );
  }
  if (value.includes("..") || value.includes("@{") || value.endsWith(".lock")) {
    throw new Error(
      `Invalid branch name "${value}": contains forbidden git ref sequences (.., @{, or .lock suffix).`,
    );
  }
  if (BRANCH_WHITESPACE_RE.test(value)) {
    throw new Error(
      `Invalid branch name "${value}": contains whitespace characters.`,
    );
  }
  if (!BRANCH_ALLOWED_RE.test(value)) {
    throw new Error(
      `Invalid branch name "${value}": contains characters outside the allowed git ref charset (alphanumeric, hyphen, underscore, dot, slash, @).`,
    );
  }
  return value;
}

export function validateCloneUrl(value: string): string {
  if (CLONE_URL_INJECTION_RE.test(value)) {
    throw new Error(
      `Invalid clone URL "${value}": contains shell-injection characters ($, \`, (, ), ;, |, &, <, >, \\).`,
    );
  }
  if (!CLONE_URL_HTTPS_RE.test(value) && !CLONE_URL_SSH_RE.test(value)) {
    throw new Error(
      `Invalid clone URL "${value}": must be an https:// or git@host:owner/repo URL.`,
    );
  }
  return value;
}
