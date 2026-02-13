import type { State, Event, Effect, GitContext, StackPlan } from "./states.ts"

export interface Transition {
	state: State
	effects: Effect[]
}

function continueAfterPullCheck(git: GitContext): Transition {
	if (!git.hasChanges && git.unpushedCount === 0 && git.unmergedCount === 0) {
		return { state: { kind: "nothing_to_ship" }, effects: [] }
	}

	if (!git.hasChanges && (git.unpushedCount > 0 || git.unmergedCount > 0)) {
		return {
			state: { kind: "fast_path_logging", git },
			effects: [{ kind: "show_commit_log", git }],
		}
	}

	return {
		state: { kind: "collecting_files", git },
		effects: [{ kind: "collect_files", git }],
	}
}

export function transition(state: State, event: Event): Transition {
	switch (state.kind) {
		// ── Preflight ──────────────────────────────────────────────
		case "preflight": {
			if (event.kind !== "tools_ok") return invalid(state, event)
			const { git } = event

			if (!git.hasChanges && git.unpushedCount === 0 && git.unmergedCount === 0) {
				return { state: { kind: "nothing_to_ship" }, effects: [] }
			}

			if (!git.onMain && git.hasUpstream) {
				return {
					state: { kind: "checking_remote", git },
					effects: [{ kind: "check_remote_status", branch: git.currentBranch }],
				}
			}

			return continueAfterPullCheck(git)
		}

		// ── Pull check ───────────────────────────────────────────
		case "checking_remote": {
			if (event.kind !== "remote_status") return invalid(state, event)
			if (event.behind > 0) {
				return {
					state: { kind: "confirming_pull", git: state.git, behind: event.behind },
					effects: [{ kind: "prompt_confirm_pull", behind: event.behind }],
				}
			}
			return continueAfterPullCheck(state.git)
		}

		case "confirming_pull": {
			if (event.kind !== "confirm_pull") return invalid(state, event)
			if (event.accepted) {
				return {
					state: { kind: "pulling", git: state.git },
					effects: [{ kind: "pull_remote", branch: state.git.currentBranch }],
				}
			}
			return continueAfterPullCheck(state.git)
		}

		case "pulling": {
			if (event.kind === "pull_done") {
				return {
					state: { kind: "preflight" },
					effects: [{ kind: "check_tools" }],
				}
			}
			if (event.kind === "pull_conflict") {
				return {
					state: { kind: "merge_conflict", git: state.git, message: event.message },
					effects: [],
				}
			}
			return invalid(state, event)
		}

		// ── Fast path ─────────────────────────────────────────────
		case "fast_path_logging": {
			if (event.kind !== "commit_log_ready") return invalid(state, event)
			const { git } = state
			if (git.unpushedCount > 0) {
				return {
					state: { kind: "fast_path_pushing", git, commitLog: event.commitLog },
					effects: [{ kind: "push_branch", branch: git.currentBranch }],
				}
			}
			return {
				state: { kind: "fast_path_checking_pr", git },
				effects: [{ kind: "check_existing_pr", branch: git.currentBranch }],
			}
		}

		case "fast_path_pushing": {
			if (event.kind !== "push_done") return invalid(state, event)
			return {
				state: { kind: "fast_path_checking_pr", git: state.git },
				effects: [{ kind: "check_existing_pr", branch: state.git.currentBranch }],
			}
		}

		case "fast_path_checking_pr": {
			const { git } = state
			if (event.kind === "pr_exists") {
				return {
					state: { kind: "fast_path_confirming_merge", git, prUrl: event.prUrl },
					effects: [
						{ kind: "log_pr_found", prUrl: event.prUrl },
						{ kind: "prompt_confirm_merge", prUrl: event.prUrl },
					],
				}
			}
			if (event.kind === "no_pr") {
				return {
					state: { kind: "fast_path_generating_pr", git, diff: "" },
					effects: [{ kind: "get_diff_main" }],
				}
			}
			return invalid(state, event)
		}

		case "fast_path_generating_pr": {
			if (event.kind === "diff_ready") {
				return {
					state: { kind: "fast_path_generating_pr", git: state.git, diff: event.diff },
					effects: [{ kind: "generate_pr_details", diff: event.diff }],
				}
			}
			if (event.kind === "pr_details_generated") {
				return {
					state: { kind: "fast_path_confirming_pr", git: state.git, prDetails: event.prDetails },
					effects: [{ kind: "prompt_confirm_pr", prDetails: event.prDetails }],
				}
			}
			if (event.kind === "pr_details_failed" || event.kind === "user_cancelled") {
				return {
					state: { kind: "done", message: `Branch pushed. Create PR manually.` },
					effects: [],
				}
			}
			return invalid(state, event)
		}

		case "fast_path_confirming_pr": {
			if (event.kind !== "confirm_pr") return invalid(state, event)
			if (!event.accepted) {
				return {
					state: { kind: "done", message: "Branch pushed." },
					effects: [{ kind: "log_pr_skip", branchName: state.git.currentBranch }],
				}
			}
			return {
				state: { kind: "fast_path_creating_pr", git: state.git, prDetails: state.prDetails },
				effects: [{ kind: "create_pr", branch: state.git.currentBranch, prDetails: state.prDetails }],
			}
		}

		case "fast_path_creating_pr": {
			if (event.kind !== "pr_created") return invalid(state, event)
			return {
				state: { kind: "fast_path_confirming_merge", git: state.git, prUrl: event.prUrl },
				effects: [
					{ kind: "log_pr_created", prUrl: event.prUrl },
					{ kind: "prompt_confirm_merge", prUrl: event.prUrl },
				],
			}
		}

		case "fast_path_confirming_merge": {
			if (event.kind !== "confirm_merge") return invalid(state, event)
			if (!event.accepted) {
				return {
					state: { kind: "done", message: `PR open: ${state.prUrl}` },
					effects: [{ kind: "log_merge_skip", prUrl: state.prUrl, branchName: state.git.currentBranch, onMain: state.git.onMain }],
				}
			}
			return {
				state: { kind: "fast_path_merging", git: state.git, prUrl: state.prUrl },
				effects: [{ kind: "merge_and_cleanup", prUrl: state.prUrl, onMain: state.git.onMain }],
			}
		}

		case "fast_path_merging": {
			if (event.kind !== "merge_done") return invalid(state, event)
			return {
				state: { kind: "done", message: `Shipped! ${event.prUrl}` },
				effects: [],
			}
		}

		// ── Full path ─────────────────────────────────────────────
		case "collecting_files": {
			if (event.kind !== "files_collected") return invalid(state, event)
			return {
				state: { kind: "picking_files", git: state.git, files: event.files },
				effects: [{ kind: "prompt_file_picker", files: event.files }],
			}
		}

		case "picking_files": {
			if (event.kind === "user_cancelled") {
				return { state: { kind: "cancelled", message: "Cancelled." }, effects: [] }
			}
			if (event.kind === "stack_plan_generated") {
				return startStackCommitting(state.git, event.plan)
			}
			if (event.kind !== "files_picked") return invalid(state, event)
			return {
				state: { kind: "staging_files", git: state.git, selectedFiles: event.selectedFiles },
				effects: [{ kind: "stage_files", selectedFiles: event.selectedFiles }],
			}
		}

		case "staging_files": {
			if (event.kind !== "files_staged") return invalid(state, event)
			return {
				state: { kind: "getting_diff", git: state.git },
				effects: [
					{ kind: "log_info", message: event.shortStat },
					{ kind: "get_staged_diff" },
				],
			}
		}

		case "getting_diff": {
			if (event.kind !== "diff_ready") return invalid(state, event)
			return {
				state: { kind: "generating_details", git: state.git, diff: event.diff },
				effects: [{ kind: "generate_commit_details", diff: event.diff }],
			}
		}

		case "generating_details": {
			if (event.kind === "details_generated") {
				const { details } = event
				if (state.git.onMain) {
					return {
						state: { kind: "confirming_branch", git: state.git, details },
						effects: [{ kind: "prompt_branch_name", suggestion: details.branchName }],
					}
				}
				return {
					state: { kind: "confirming_commit", git: state.git, details, branchName: state.git.currentBranch },
					effects: [
						{ kind: "show_commit_message", commitMessage: details.commitMessage },
						{ kind: "prompt_commit_action" },
					],
				}
			}
			if (event.kind === "details_failed" || event.kind === "user_cancelled") {
				return {
					state: { kind: "cancelled", message: "Aborted." },
					effects: [{ kind: "unstage_all" }],
				}
			}
			return invalid(state, event)
		}

		case "confirming_branch": {
			if (event.kind === "user_cancelled") {
				return {
					state: { kind: "cancelled", message: "Cancelled." },
					effects: [{ kind: "unstage_all" }],
				}
			}
			if (event.kind !== "branch_confirmed") return invalid(state, event)
			return {
				state: { kind: "confirming_commit", git: state.git, details: state.details, branchName: event.branchName },
				effects: [
					{ kind: "show_commit_message", commitMessage: state.details.commitMessage },
					{ kind: "prompt_commit_action" },
				],
			}
		}

		case "confirming_commit": {
			if (event.kind !== "commit_action") return invalid(state, event)
			if (event.action === "cancel") {
				return {
					state: { kind: "cancelled", message: "Aborted." },
					effects: [{ kind: "unstage_all" }],
				}
			}
			if (event.action === "edit") {
				return {
					state: { kind: "editing_commit", git: state.git, details: state.details, branchName: state.branchName },
					effects: [{ kind: "open_editor", commitMessage: state.details.commitMessage }],
				}
			}
			// accept
			return {
				state: { kind: "committing", git: state.git, details: state.details, branchName: state.branchName, commitMessage: state.details.commitMessage },
				effects: [{ kind: "commit_only", branchName: state.branchName, commitMessage: state.details.commitMessage, onMain: state.git.onMain }],
			}
		}

		case "editing_commit": {
			if (event.kind !== "commit_edited") return invalid(state, event)
			return {
				state: { kind: "committing", git: state.git, details: state.details, branchName: state.branchName, commitMessage: event.commitMessage },
				effects: [{ kind: "commit_only", branchName: state.branchName, commitMessage: event.commitMessage, onMain: state.git.onMain }],
			}
		}

		case "committing": {
			if (event.kind !== "commit_done") return invalid(state, event)
			const git = { ...state.git, onMain: false }
			return {
				state: { kind: "post_commit_checking_pr", git, details: state.details, branchName: state.branchName },
				effects: [{ kind: "check_existing_pr", branch: state.branchName }],
			}
		}

		case "post_commit_checking_pr": {
			if (event.kind === "pr_exists") {
				return {
					state: { kind: "post_commit", git: state.git, details: state.details, branchName: state.branchName, prUrl: event.prUrl },
					effects: [{ kind: "prompt_post_commit", prUrl: event.prUrl }],
				}
			}
			if (event.kind === "no_pr") {
				return {
					state: { kind: "post_commit", git: state.git, details: state.details, branchName: state.branchName },
					effects: [{ kind: "prompt_post_commit" }],
				}
			}
			return invalid(state, event)
		}

		// ── Post-commit hub ──────────────────────────────────────
		case "post_commit": {
			if (event.kind !== "post_commit_choice") return invalid(state, event)
			switch (event.choice) {
				case "create_pr":
					return {
						state: { kind: "pushing", git: state.git, branchName: state.branchName, details: state.details, postPush: "check_pr" },
						effects: [{ kind: "push_branch", branch: state.branchName }],
					}
				case "push_only":
					return {
						state: { kind: "pushing", git: state.git, branchName: state.branchName, details: state.details, postPush: "done" },
						effects: [{ kind: "push_branch", branch: state.branchName }],
					}
				case "commit_more":
					return {
						state: { kind: "collecting_files", git: state.git },
						effects: [{ kind: "collect_files", git: state.git }],
					}
				case "done":
					return {
						state: { kind: "done", message: "Committed locally." },
						effects: [],
					}
			}
		}

		// ── Pushing ──────────────────────────────────────────────
		case "pushing": {
			if (event.kind !== "push_done") return invalid(state, event)
			if (state.postPush === "check_pr") {
				return {
					state: { kind: "checking_pr", git: state.git, details: state.details, branchName: state.branchName },
					effects: [{ kind: "check_existing_pr", branch: state.branchName }],
				}
			}
			return {
				state: { kind: "done", message: "Pushed." },
				effects: [],
			}
		}

		case "checking_pr": {
			if (event.kind === "pr_exists") {
				return {
					state: { kind: "confirming_merge", git: state.git, branchName: state.branchName, prUrl: event.prUrl },
					effects: [
						{ kind: "log_pr_exists", prUrl: event.prUrl },
						{ kind: "prompt_confirm_merge", prUrl: event.prUrl },
					],
				}
			}
			if (event.kind === "no_pr") {
				return {
					state: { kind: "confirming_pr", git: state.git, details: state.details, branchName: state.branchName },
					effects: [
						{ kind: "show_pr_details", details: state.details },
						{ kind: "prompt_create_pr", details: state.details },
					],
				}
			}
			return invalid(state, event)
		}

		case "confirming_pr": {
			if (event.kind === "user_cancelled") {
				return { state: { kind: "cancelled", message: "Cancelled." }, effects: [] }
			}
			if (event.kind !== "confirm_pr") return invalid(state, event)
			if (!event.accepted) {
				return {
					state: { kind: "done", message: "Done." },
					effects: [{ kind: "log_pr_skip", branchName: state.branchName }],
				}
			}
			return {
				state: { kind: "creating_pr", git: state.git, details: state.details, branchName: state.branchName },
				effects: [{ kind: "create_full_pr", branch: state.branchName, details: state.details }],
			}
		}

		case "creating_pr": {
			if (event.kind !== "pr_created") return invalid(state, event)
			return {
				state: { kind: "confirming_merge", git: state.git, branchName: state.branchName, prUrl: event.prUrl },
				effects: [
					{ kind: "log_pr_created", prUrl: event.prUrl },
					{ kind: "prompt_confirm_merge", prUrl: event.prUrl },
				],
			}
		}

		case "confirming_merge": {
			if (event.kind === "user_cancelled") {
				return { state: { kind: "cancelled", message: "Cancelled." }, effects: [] }
			}
			if (event.kind !== "confirm_merge") return invalid(state, event)
			if (!event.accepted) {
				return {
					state: { kind: "done", message: `PR open: ${state.prUrl}` },
					effects: [{ kind: "log_merge_skip", prUrl: state.prUrl, branchName: state.branchName, onMain: state.git.onMain }],
				}
			}
			return {
				state: { kind: "merging", git: state.git, branchName: state.branchName, prUrl: state.prUrl },
				effects: [{ kind: "merge_and_cleanup", prUrl: state.prUrl, onMain: state.git.onMain }],
			}
		}

		case "merging": {
			if (event.kind !== "merge_done") return invalid(state, event)
			return {
				state: { kind: "done", message: `Shipped! ${event.prUrl}` },
				effects: [],
			}
		}

		// ── Stack committing ────────────────────────────────────
		case "stack_committing": {
			if (event.kind !== "stack_commit_done") return invalid(state, event)
			const { plan } = state
			if (event.nextIndex < plan.groups.length) {
				return {
					state: { kind: "stack_committing", git: state.git, plan, currentIndex: event.nextIndex },
					effects: [{
						kind: "execute_stack_commit",
						group: plan.groups[event.nextIndex]!,
						branchName: plan.branchName,
						isFirst: false,
						onMain: false,
						index: event.nextIndex,
					}],
				}
			}
			const actualBranch = state.git.onMain ? plan.branchName : state.git.currentBranch
			const details = {
				branchName: actualBranch,
				commitMessage: plan.groups.map(g => g.commitMessage).join("\n"),
				prTitle: plan.prTitle,
				prBody: plan.prBody,
			}
			return {
				state: { kind: "post_commit_checking_pr", git: { ...state.git, onMain: false }, details, branchName: actualBranch },
				effects: [{ kind: "check_existing_pr", branch: actualBranch }],
			}
		}

		// Terminal states should never receive events
		case "done":
		case "cancelled":
		case "error":
		case "nothing_to_ship":
		case "merge_conflict":
			return invalid(state, event)
	}
}

function startStackCommitting(git: GitContext, plan: StackPlan): Transition {
	return {
		state: { kind: "stack_committing", git, plan, currentIndex: 0 },
		effects: [{
			kind: "execute_stack_commit",
			group: plan.groups[0]!,
			branchName: plan.branchName,
			isFirst: true,
			onMain: git.onMain,
			index: 0,
		}],
	}
}

function invalid(state: State, event: Event): Transition {
	return {
		state: { kind: "error", message: `Unexpected event "${event.kind}" in state "${state.kind}"` },
		effects: [],
	}
}
