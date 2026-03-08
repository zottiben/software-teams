import { exec } from "./git";

export interface AuthResult {
  authorized: boolean;
  reason: string;
}

export async function checkAuthorization(
  repo: string,
  username: string,
  allowedUsers?: string,
): Promise<AuthResult> {
  // If allowed_users list is configured, check against it
  if (allowedUsers) {
    const users = allowedUsers.split(",").map((u) => u.trim().toLowerCase());
    if (users.includes(username.toLowerCase())) {
      return { authorized: true, reason: `User ${username} is in allowed list` };
    }
    return {
      authorized: false,
      reason: `User ${username} is not in the allowed_users list`,
    };
  }

  // Check repo collaborator permission (write or admin)
  try {
    const { stdout, exitCode } = await exec([
      "gh", "api",
      `repos/${repo}/collaborators/${username}/permission`,
      "--jq", ".permission",
    ]);

    if (exitCode === 0) {
      const permission = stdout.trim();
      if (permission === "admin" || permission === "write") {
        return {
          authorized: true,
          reason: `User ${username} has ${permission} permission on ${repo}`,
        };
      }
    }
  } catch {
    // gh api call failed — deny by default
  }

  return {
    authorized: false,
    reason: `User ${username} does not have write access to ${repo}`,
  };
}
