import { describe, expect, test } from "bun:test"
import { transition } from "./transitions.ts"
import type { GitContext } from "./states.ts"

// ── Helpers ────────────────────────────────────────────────────────

function git(overrides: Partial<GitContext> = {}): GitContext {
	return {
		currentBranch: "main",
		onMain: true,
		hasStaged: false,
		hasUnstaged: false,
		hasUntracked: false,
		hasChanges: false,
		hasUpstream: false,
		unpushedCount: 0,
		unmergedCount: 0,
		untrackedRaw: "",
		...overrides,
	}
}

const featureGit = git({
	currentBranch: "feat-thing",
	onMain: false,
	hasChanges: true,
	hasUnstaged: true,
})

const details = {
	branchName: "feat-foo",
	commitMessage: "feat: add foo",
	prTitle: "feat: add foo",
	prBody: "## Summary\n- Added foo",
}

// ── Preflight ──────────────────────────────────────────────────────

describe("preflight", () => {
	test("nothing to ship → terminal", () => {
		const result = transition({ kind: "preflight" }, { kind: "tools_ok", git: git() })
		expect(result.state.kind).toBe("nothing_to_ship")
	})

	test("unpushed commits without upstream → fast path", () => {
		const g = git({ currentBranch: "feat-x", onMain: false, unpushedCount: 3 })
		const result = transition({ kind: "preflight" }, { kind: "tools_ok", git: g })
		expect(result.state.kind).toBe("fast_path_logging")
	})

	test("unmerged commits without upstream → fast path", () => {
		const g = git({ currentBranch: "feat-x", onMain: false, unmergedCount: 2 })
		const result = transition({ kind: "preflight" }, { kind: "tools_ok", git: g })
		expect(result.state.kind).toBe("fast_path_logging")
	})

	test("has upstream → checking_remote", () => {
		const g = git({ currentBranch: "feat-x", onMain: false, hasUpstream: true, unpushedCount: 3 })
		const result = transition({ kind: "preflight" }, { kind: "tools_ok", git: g })
		expect(result.state.kind).toBe("checking_remote")
		expect(result.effects[0]!.kind).toBe("check_remote_status")
	})

	test("has changes on main → full path", () => {
		const g = git({ hasChanges: true, hasUnstaged: true })
		const result = transition({ kind: "preflight" }, { kind: "tools_ok", git: g })
		expect(result.state.kind).toBe("collecting_files")
	})

	test("has changes on feature without upstream → full path", () => {
		const g = git({ currentBranch: "feat-x", onMain: false, hasChanges: true, hasUnstaged: true })
		const result = transition({ kind: "preflight" }, { kind: "tools_ok", git: g })
		expect(result.state.kind).toBe("collecting_files")
	})

	test("wrong event → error", () => {
		const result = transition({ kind: "preflight" }, { kind: "push_done" })
		expect(result.state.kind).toBe("error")
	})
})

// ── Fast path ──────────────────────────────────────────────────────

describe("fast path", () => {
	test("logging → pushing when unpushed", () => {
		const g = git({ currentBranch: "feat-x", onMain: false, unpushedCount: 2 })
		const result = transition(
			{ kind: "fast_path_logging", git: g },
			{ kind: "commit_log_ready", commitLog: "abc123 thing" },
		)
		expect(result.state.kind).toBe("fast_path_pushing")
		expect(result.effects[0]!.kind).toBe("push_branch")
	})

	test("logging → checking PR when nothing to push", () => {
		const g = git({ currentBranch: "feat-x", onMain: false, unpushedCount: 0, unmergedCount: 2 })
		const result = transition(
			{ kind: "fast_path_logging", git: g },
			{ kind: "commit_log_ready", commitLog: "abc123 thing" },
		)
		expect(result.state.kind).toBe("fast_path_checking_pr")
	})

	test("pushing → checking PR", () => {
		const g = git({ currentBranch: "feat-x", onMain: false })
		const result = transition(
			{ kind: "fast_path_pushing", git: g, commitLog: "x" },
			{ kind: "push_done" },
		)
		expect(result.state.kind).toBe("fast_path_checking_pr")
	})

	test("checking PR → confirm merge when PR exists", () => {
		const g = git({ currentBranch: "feat-x", onMain: false })
		const result = transition(
			{ kind: "fast_path_checking_pr", git: g },
			{ kind: "pr_exists", prUrl: "https://github.com/x/pull/1" },
		)
		expect(result.state.kind).toBe("fast_path_confirming_merge")
	})

	test("checking PR → generating PR when no PR", () => {
		const g = git({ currentBranch: "feat-x", onMain: false })
		const result = transition(
			{ kind: "fast_path_checking_pr", git: g },
			{ kind: "no_pr" },
		)
		expect(result.state.kind).toBe("fast_path_generating_pr")
	})

	test("confirming merge declined → done with PR URL", () => {
		const g = git({ currentBranch: "feat-x", onMain: false })
		const result = transition(
			{ kind: "fast_path_confirming_merge", git: g, prUrl: "https://pr" },
			{ kind: "confirm_merge", accepted: false },
		)
		expect(result.state.kind).toBe("done")
		expect((result.state as any).message).toContain("https://pr")
	})

	test("confirming merge accepted → merging", () => {
		const g = git({ currentBranch: "feat-x", onMain: false })
		const result = transition(
			{ kind: "fast_path_confirming_merge", git: g, prUrl: "https://pr" },
			{ kind: "confirm_merge", accepted: true },
		)
		expect(result.state.kind).toBe("fast_path_merging")
	})

	test("merging → done", () => {
		const g = git({ currentBranch: "feat-x", onMain: false })
		const result = transition(
			{ kind: "fast_path_merging", git: g, prUrl: "https://pr" },
			{ kind: "merge_done", prUrl: "https://pr" },
		)
		expect(result.state.kind).toBe("done")
		expect((result.state as any).message).toContain("Shipped!")
	})
})

// ── Full path ──────────────────────────────────────────────────────

describe("full path", () => {
	test("collecting → picking", () => {
		const files = [{ path: "a.ts", status: "modified" as const }]
		const result = transition(
			{ kind: "collecting_files", git: featureGit },
			{ kind: "files_collected", files },
		)
		expect(result.state.kind).toBe("picking_files")
	})

	test("picking cancelled → cancelled", () => {
		const files = [{ path: "a.ts", status: "modified" as const }]
		const result = transition(
			{ kind: "picking_files", git: featureGit, files },
			{ kind: "user_cancelled" },
		)
		expect(result.state.kind).toBe("cancelled")
	})

	test("picking → staging", () => {
		const files = [{ path: "a.ts", status: "modified" as const }]
		const result = transition(
			{ kind: "picking_files", git: featureGit, files },
			{ kind: "files_picked", selectedFiles: ["a.ts"] },
		)
		expect(result.state.kind).toBe("staging_files")
	})

	test("staging → getting diff", () => {
		const result = transition(
			{ kind: "staging_files", git: featureGit, selectedFiles: ["a.ts"] },
			{ kind: "files_staged", shortStat: "1 file changed" },
		)
		expect(result.state.kind).toBe("getting_diff")
	})

	test("getting diff → generating details", () => {
		const result = transition(
			{ kind: "getting_diff", git: featureGit },
			{ kind: "diff_ready", diff: "diff content" },
		)
		expect(result.state.kind).toBe("generating_details")
	})

	test("generating details on main → confirming branch", () => {
		const mainGit = git({ hasChanges: true, hasUnstaged: true })
		const result = transition(
			{ kind: "generating_details", git: mainGit, diff: "x" },
			{ kind: "details_generated", details },
		)
		expect(result.state.kind).toBe("confirming_branch")
	})

	test("generating details on feature → confirming commit", () => {
		const result = transition(
			{ kind: "generating_details", git: featureGit, diff: "x" },
			{ kind: "details_generated", details },
		)
		expect(result.state.kind).toBe("confirming_commit")
	})

	test("branch confirmed → confirming commit", () => {
		const mainGit = git({ hasChanges: true })
		const result = transition(
			{ kind: "confirming_branch", git: mainGit, details },
			{ kind: "branch_confirmed", branchName: "feat-foo" },
		)
		expect(result.state.kind).toBe("confirming_commit")
	})

	test("commit accept → committing with commit_only effect", () => {
		const result = transition(
			{ kind: "confirming_commit", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "commit_action", action: "accept" },
		)
		expect(result.state.kind).toBe("committing")
		expect(result.effects[0]!.kind).toBe("commit_only")
	})

	test("commit edit → editing", () => {
		const result = transition(
			{ kind: "confirming_commit", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "commit_action", action: "edit" },
		)
		expect(result.state.kind).toBe("editing_commit")
	})

	test("commit cancel → cancelled + unstage", () => {
		const result = transition(
			{ kind: "confirming_commit", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "commit_action", action: "cancel" },
		)
		expect(result.state.kind).toBe("cancelled")
		expect(result.effects[0]!.kind).toBe("unstage_all")
	})

	test("editing → committing", () => {
		const result = transition(
			{ kind: "editing_commit", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "commit_edited", commitMessage: "fix: edited msg" },
		)
		expect(result.state.kind).toBe("committing")
		expect((result.state as any).commitMessage).toBe("fix: edited msg")
	})

	test("committing → post_commit_checking_pr", () => {
		const result = transition(
			{ kind: "committing", git: featureGit, details, branchName: "feat-thing", commitMessage: "feat: x" },
			{ kind: "commit_done" },
		)
		expect(result.state.kind).toBe("post_commit_checking_pr")
		expect(result.effects[0]!.kind).toBe("check_existing_pr")
	})

	test("post_commit_checking_pr with pr_exists → post_commit with prUrl", () => {
		const result = transition(
			{ kind: "post_commit_checking_pr", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "pr_exists", prUrl: "https://github.com/x/pull/1" },
		)
		expect(result.state.kind).toBe("post_commit")
		expect((result.state as any).prUrl).toBe("https://github.com/x/pull/1")
		expect((result.effects[0] as any).prUrl).toBe("https://github.com/x/pull/1")
	})

	test("post_commit_checking_pr with no_pr → post_commit without prUrl", () => {
		const result = transition(
			{ kind: "post_commit_checking_pr", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "no_pr" },
		)
		expect(result.state.kind).toBe("post_commit")
		expect((result.state as any).prUrl).toBeUndefined()
	})

	test("checking PR exists → confirming merge", () => {
		const result = transition(
			{ kind: "checking_pr", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "pr_exists", prUrl: "https://pr" },
		)
		expect(result.state.kind).toBe("confirming_merge")
	})

	test("checking no PR → confirming PR", () => {
		const result = transition(
			{ kind: "checking_pr", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "no_pr" },
		)
		expect(result.state.kind).toBe("confirming_pr")
	})

	test("confirming PR declined → done", () => {
		const result = transition(
			{ kind: "confirming_pr", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "confirm_pr", accepted: false },
		)
		expect(result.state.kind).toBe("done")
	})

	test("confirming PR accepted → creating PR", () => {
		const result = transition(
			{ kind: "confirming_pr", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "confirm_pr", accepted: true },
		)
		expect(result.state.kind).toBe("creating_pr")
	})

	test("creating PR → confirming merge", () => {
		const result = transition(
			{ kind: "creating_pr", git: featureGit, details, branchName: "feat-thing" },
			{ kind: "pr_created", prUrl: "https://pr" },
		)
		expect(result.state.kind).toBe("confirming_merge")
	})

	test("merge accepted → merging", () => {
		const result = transition(
			{ kind: "confirming_merge", git: featureGit, branchName: "feat-thing", prUrl: "https://pr" },
			{ kind: "confirm_merge", accepted: true },
		)
		expect(result.state.kind).toBe("merging")
	})

	test("merge declined → done", () => {
		const result = transition(
			{ kind: "confirming_merge", git: featureGit, branchName: "feat-thing", prUrl: "https://pr" },
			{ kind: "confirm_merge", accepted: false },
		)
		expect(result.state.kind).toBe("done")
	})

	test("merging → done shipped", () => {
		const result = transition(
			{ kind: "merging", git: featureGit, branchName: "feat-thing", prUrl: "https://pr" },
			{ kind: "merge_done", prUrl: "https://pr" },
		)
		expect(result.state.kind).toBe("done")
		expect((result.state as any).message).toContain("Shipped!")
	})
})

// ── Pull check ────────────────────────────────────────────────────

describe("pull check", () => {
	const upstreamGit = git({ currentBranch: "feat-x", onMain: false, hasUpstream: true, hasChanges: true, hasUnstaged: true })

	test("checking_remote behind > 0 → confirming_pull", () => {
		const result = transition(
			{ kind: "checking_remote", git: upstreamGit },
			{ kind: "remote_status", behind: 3 },
		)
		expect(result.state.kind).toBe("confirming_pull")
		expect((result.state as any).behind).toBe(3)
	})

	test("checking_remote behind == 0 → continues normally", () => {
		const result = transition(
			{ kind: "checking_remote", git: upstreamGit },
			{ kind: "remote_status", behind: 0 },
		)
		expect(result.state.kind).toBe("collecting_files")
	})

	test("confirming_pull accepted → pulling", () => {
		const result = transition(
			{ kind: "confirming_pull", git: upstreamGit, behind: 3 },
			{ kind: "confirm_pull", accepted: true },
		)
		expect(result.state.kind).toBe("pulling")
		expect(result.effects[0]!.kind).toBe("pull_remote")
	})

	test("confirming_pull declined → continues normally", () => {
		const result = transition(
			{ kind: "confirming_pull", git: upstreamGit, behind: 3 },
			{ kind: "confirm_pull", accepted: false },
		)
		expect(result.state.kind).toBe("collecting_files")
	})

	test("pulling pull_done → preflight restart", () => {
		const result = transition(
			{ kind: "pulling", git: upstreamGit },
			{ kind: "pull_done" },
		)
		expect(result.state.kind).toBe("preflight")
		expect(result.effects[0]!.kind).toBe("check_tools")
	})

	test("pulling pull_conflict → merge_conflict", () => {
		const result = transition(
			{ kind: "pulling", git: upstreamGit },
			{ kind: "pull_conflict", message: "CONFLICT in file.ts" },
		)
		expect(result.state.kind).toBe("merge_conflict")
		expect((result.state as any).message).toBe("CONFLICT in file.ts")
	})

	test("checking_remote with no changes, unpushed → fast_path_logging", () => {
		const g = git({ currentBranch: "feat-x", onMain: false, hasUpstream: true, unpushedCount: 2 })
		const result = transition(
			{ kind: "checking_remote", git: g },
			{ kind: "remote_status", behind: 0 },
		)
		expect(result.state.kind).toBe("fast_path_logging")
	})
})

// ── Post-commit hub ───────────────────────────────────────────────

describe("post-commit hub", () => {
	const postCommitGit = git({ currentBranch: "feat-thing", onMain: false, hasChanges: true })

	test("create_pr → pushing with check_pr", () => {
		const result = transition(
			{ kind: "post_commit", git: postCommitGit, details, branchName: "feat-thing" },
			{ kind: "post_commit_choice", choice: "create_pr" },
		)
		expect(result.state.kind).toBe("pushing")
		expect((result.state as any).postPush).toBe("check_pr")
		expect(result.effects[0]!.kind).toBe("push_branch")
	})

	test("push_only → pushing with done", () => {
		const result = transition(
			{ kind: "post_commit", git: postCommitGit, details, branchName: "feat-thing" },
			{ kind: "post_commit_choice", choice: "push_only" },
		)
		expect(result.state.kind).toBe("pushing")
		expect((result.state as any).postPush).toBe("done")
	})

	test("commit_more → collecting_files (loop)", () => {
		const result = transition(
			{ kind: "post_commit", git: postCommitGit, details, branchName: "feat-thing" },
			{ kind: "post_commit_choice", choice: "commit_more" },
		)
		expect(result.state.kind).toBe("collecting_files")
		expect(result.effects[0]!.kind).toBe("collect_files")
	})

	test("done → done terminal", () => {
		const result = transition(
			{ kind: "post_commit", git: postCommitGit, details, branchName: "feat-thing" },
			{ kind: "post_commit_choice", choice: "done" },
		)
		expect(result.state.kind).toBe("done")
		expect((result.state as any).message).toBe("Committed locally.")
	})
})

// ── Pushing state ─────────────────────────────────────────────────

describe("pushing", () => {
	const pushGit = git({ currentBranch: "feat-thing", onMain: false })

	test("push_done with check_pr → checking_pr", () => {
		const result = transition(
			{ kind: "pushing", git: pushGit, branchName: "feat-thing", details, postPush: "check_pr" },
			{ kind: "push_done" },
		)
		expect(result.state.kind).toBe("checking_pr")
	})

	test("push_done with done → done terminal", () => {
		const result = transition(
			{ kind: "pushing", git: pushGit, branchName: "feat-thing", details, postPush: "done" },
			{ kind: "push_done" },
		)
		expect(result.state.kind).toBe("done")
		expect((result.state as any).message).toBe("Pushed.")
	})
})

// ── Terminal states ────────────────────────────────────────────────

describe("terminal states", () => {
	test("done + any event → error", () => {
		const result = transition({ kind: "done", message: "ok" }, { kind: "push_done" })
		expect(result.state.kind).toBe("error")
	})

	test("cancelled + any event → error", () => {
		const result = transition({ kind: "cancelled", message: "x" }, { kind: "push_done" })
		expect(result.state.kind).toBe("error")
	})

	test("nothing_to_ship + any event → error", () => {
		const result = transition({ kind: "nothing_to_ship" }, { kind: "push_done" })
		expect(result.state.kind).toBe("error")
	})

	test("merge_conflict + any event → error", () => {
		const g = git({ currentBranch: "feat-x", onMain: false })
		const result = transition({ kind: "merge_conflict", git: g, message: "conflict" }, { kind: "push_done" })
		expect(result.state.kind).toBe("error")
	})
})
