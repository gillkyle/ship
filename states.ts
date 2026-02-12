// ── CLI Mode ──────────────────────────────────────────────────────

export type CliMode =
	| { kind: "interactive" }
	| { kind: "auto"; goal: "local" | "push" | "pr"; stack: boolean }

// ── Data Types ─────────────────────────────────────────────────────

export interface GitContext {
	currentBranch: string
	onMain: boolean
	hasStaged: boolean
	hasUnstaged: boolean
	hasUntracked: boolean
	hasChanges: boolean
	hasUpstream: boolean
	unpushedCount: number
	unmergedCount: number
	untrackedRaw: string
}

export interface FileEntry {
	path: string
	status: "staged" | "modified" | "new"
}

export interface CommitDetails {
	branchName: string
	commitMessage: string
	prTitle: string
	prBody: string
}

export interface PrDetails {
	prTitle: string
	prBody: string
}

export interface StackGroup {
	files: string[]
	commitMessage: string
}

export interface StackPlan {
	groups: StackGroup[]
	branchName: string
	prTitle: string
	prBody: string
}

// ── States ─────────────────────────────────────────────────────────

export type State =
	// Preflight
	| { kind: "preflight" }
	// Fast path (no uncommitted changes, just push/PR/merge)
	| { kind: "fast_path_logging"; git: GitContext }
	| { kind: "fast_path_pushing"; git: GitContext; commitLog: string }
	| { kind: "fast_path_checking_pr"; git: GitContext }
	| { kind: "fast_path_generating_pr"; git: GitContext; diff: string }
	| { kind: "fast_path_confirming_pr"; git: GitContext; prDetails: PrDetails }
	| { kind: "fast_path_creating_pr"; git: GitContext; prDetails: PrDetails }
	| { kind: "fast_path_confirming_merge"; git: GitContext; prUrl: string }
	| { kind: "fast_path_merging"; git: GitContext; prUrl: string }
	// Full path (uncommitted changes)
	| { kind: "collecting_files"; git: GitContext }
	| { kind: "picking_files"; git: GitContext; files: FileEntry[] }
	| { kind: "staging_files"; git: GitContext; selectedFiles: string[] }
	| { kind: "getting_diff"; git: GitContext }
	| { kind: "generating_details"; git: GitContext; diff: string }
	| { kind: "confirming_branch"; git: GitContext; details: CommitDetails }
	| { kind: "confirming_commit"; git: GitContext; details: CommitDetails; branchName: string }
	| { kind: "editing_commit"; git: GitContext; details: CommitDetails; branchName: string }
	| { kind: "committing"; git: GitContext; details: CommitDetails; branchName: string; commitMessage: string }
	| { kind: "post_commit"; git: GitContext; details: CommitDetails; branchName: string }
	| { kind: "pushing"; git: GitContext; branchName: string; details: CommitDetails; postPush: "check_pr" | "done" }
	| { kind: "checking_pr"; git: GitContext; details: CommitDetails; branchName: string }
	| { kind: "confirming_pr"; git: GitContext; details: CommitDetails; branchName: string }
	| { kind: "stack_committing"; git: GitContext; plan: StackPlan; currentIndex: number }
	| { kind: "creating_pr"; git: GitContext; details: CommitDetails; branchName: string }
	| { kind: "confirming_merge"; git: GitContext; branchName: string; prUrl: string }
	| { kind: "merging"; git: GitContext; branchName: string; prUrl: string }
	// Pull check
	| { kind: "checking_remote"; git: GitContext }
	| { kind: "confirming_pull"; git: GitContext; behind: number }
	| { kind: "pulling"; git: GitContext }
	// Terminal
	| { kind: "done"; message: string }
	| { kind: "cancelled"; message: string }
	| { kind: "error"; message: string }
	| { kind: "nothing_to_ship" }
	| { kind: "merge_conflict"; git: GitContext; message: string }

// ── Events ─────────────────────────────────────────────────────────

export type Event =
	| { kind: "tools_ok"; git: GitContext }
	| { kind: "commit_log_ready"; commitLog: string }
	| { kind: "push_done" }
	| { kind: "pr_exists"; prUrl: string }
	| { kind: "no_pr" }
	| { kind: "diff_ready"; diff: string }
	| { kind: "pr_details_generated"; prDetails: PrDetails }
	| { kind: "pr_details_failed" }
	| { kind: "confirm_pr"; accepted: boolean }
	| { kind: "pr_created"; prUrl: string }
	| { kind: "confirm_merge"; accepted: boolean }
	| { kind: "merge_done"; prUrl: string }
	| { kind: "files_collected"; files: FileEntry[] }
	| { kind: "files_picked"; selectedFiles: string[] }
	| { kind: "files_staged"; shortStat: string }
	| { kind: "details_generated"; details: CommitDetails }
	| { kind: "details_failed" }
	| { kind: "branch_confirmed"; branchName: string }
	| { kind: "commit_action"; action: "accept" | "edit" | "cancel" }
	| { kind: "commit_edited"; commitMessage: string }
	| { kind: "commit_done" }
	| { kind: "pr_skip" }
	| { kind: "merge_skip"; prUrl: string; branchName: string }
	| { kind: "user_cancelled" }
	| { kind: "remote_status"; behind: number }
	| { kind: "confirm_pull"; accepted: boolean }
	| { kind: "pull_done" }
	| { kind: "pull_conflict"; message: string }
	| { kind: "post_commit_choice"; choice: "create_pr" | "push_only" | "commit_more" | "done" }
	| { kind: "stack_plan_generated"; plan: StackPlan }
	| { kind: "stack_commit_done"; nextIndex: number }

// ── Effects ────────────────────────────────────────────────────────

export type Effect =
	| { kind: "check_tools" }
	| { kind: "log_info"; message: string }
	| { kind: "show_note"; content: string; title: string }
	| { kind: "show_commit_log"; git: GitContext }
	| { kind: "push_branch"; branch: string }
	| { kind: "check_existing_pr"; branch: string }
	| { kind: "get_diff_main" }
	| { kind: "generate_pr_details"; diff: string }
	| { kind: "prompt_confirm_pr"; prDetails: PrDetails }
	| { kind: "create_pr"; branch: string; prDetails: PrDetails }
	| { kind: "log_pr_found"; prUrl: string }
	| { kind: "log_pr_created"; prUrl: string }
	| { kind: "prompt_confirm_merge"; prUrl: string }
	| { kind: "merge_and_cleanup"; prUrl: string; onMain: boolean }
	| { kind: "collect_files"; git: GitContext }
	| { kind: "prompt_file_picker"; files: FileEntry[] }
	| { kind: "stage_files"; selectedFiles: string[] }
	| { kind: "get_staged_diff" }
	| { kind: "generate_commit_details"; diff: string }
	| { kind: "prompt_branch_name"; suggestion: string }
	| { kind: "show_commit_message"; commitMessage: string }
	| { kind: "prompt_commit_action" }
	| { kind: "open_editor"; commitMessage: string }
	| { kind: "commit_only"; branchName: string; commitMessage: string; onMain: boolean }
	| { kind: "log_pr_exists"; prUrl: string }
	| { kind: "show_pr_details"; details: CommitDetails }
	| { kind: "prompt_create_pr"; details: CommitDetails }
	| { kind: "create_full_pr"; branch: string; details: CommitDetails }
	| { kind: "log_merge_skip"; prUrl: string; branchName: string; onMain: boolean }
	| { kind: "log_pr_skip"; branchName: string }
	| { kind: "unstage_all" }
	| { kind: "check_remote_status"; branch: string }
	| { kind: "prompt_confirm_pull"; behind: number }
	| { kind: "pull_remote"; branch: string }
	| { kind: "prompt_post_commit" }
	| { kind: "execute_stack_commit"; group: StackGroup; branchName: string; isFirst: boolean; onMain: boolean; index: number }

// ── Helpers ────────────────────────────────────────────────────────

export function isTerminal(state: State): state is
	| { kind: "done"; message: string }
	| { kind: "cancelled"; message: string }
	| { kind: "error"; message: string }
	| { kind: "nothing_to_ship" }
	| { kind: "merge_conflict"; git: GitContext; message: string } {
	return state.kind === "done" || state.kind === "cancelled" || state.kind === "error" || state.kind === "nothing_to_ship" || state.kind === "merge_conflict"
}
