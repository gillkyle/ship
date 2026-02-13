import * as p from "@clack/prompts"
import pc from "picocolors"
import { run, runOk, runLive } from "./git.ts"
import { ManualProvider, type LlmProvider } from "./llm.ts"
import type { CliMode, Effect, Event, FileEntry } from "./states.ts"

export class EffectExecutor {
	private manual = new ManualProvider()
	constructor(private llm: LlmProvider, private mode: CliMode) {}

	private get isAuto() { return this.mode.kind === "auto" }
	private get isStack() { return this.mode.kind === "auto" && this.mode.stack }

	async execute(effect: Effect): Promise<Event | null> {
		switch (effect.kind) {
			case "check_tools": {
				if (!runOk(["which", "gh"])) {
					p.log.error("gh CLI is not installed.")
					return { kind: "user_cancelled" }
				}

				const currentBranch = run(["git", "branch", "--show-current"])
				const onMain = currentBranch === "main"
				const hasStaged = !runOk(["git", "diff", "--cached", "--quiet"])
				const hasUnstaged = !runOk(["git", "diff", "--quiet"])
				const untrackedRaw = run(["git", "ls-files", "--others", "--exclude-standard"])
				const hasUntracked = untrackedRaw.length > 0
				const hasChanges = hasStaged || hasUnstaged || hasUntracked
				const hasUpstream = !onMain && runOk(["git", "rev-parse", "--verify", `origin/${currentBranch}`])
				const unpushedCount = !onMain && hasUpstream
					? parseInt(run(["git", "rev-list", "--count", `origin/${currentBranch}..HEAD`]) || "0")
					: !onMain && !hasUpstream
						? parseInt(run(["git", "rev-list", "--count", "origin/main..HEAD"]) || "0")
						: 0
				const unmergedCount = !onMain
					? parseInt(run(["git", "rev-list", "--count", "origin/main..HEAD"]) || "0")
					: 0

				return {
					kind: "tools_ok",
					git: { currentBranch, onMain, hasStaged, hasUnstaged, hasUntracked, hasChanges, hasUpstream, unpushedCount, unmergedCount, untrackedRaw },
				}
			}

			case "log_info":
				p.log.info(pc.dim(effect.message))
				return null

			case "show_note":
				p.note(effect.content, effect.title)
				return null

			case "show_commit_log": {
				const { git } = effect
				if (git.unpushedCount > 0) {
					p.log.info(`${git.unpushedCount} unpushed commit(s) on ${pc.cyan(git.currentBranch)}`)
				} else {
					p.log.info(`${git.unmergedCount} commit(s) on ${pc.cyan(git.currentBranch)} not yet merged to main`)
				}
				const commitLog = run(["git", "log", "--oneline", "origin/main..HEAD"])
				p.note(commitLog, "Commits to ship")
				return { kind: "commit_log_ready", commitLog }
			}

			case "push_branch": {
				if (effect.branch === "main" || effect.branch === "master") {
					p.log.warn(`You're about to push directly to ${pc.bold(effect.branch)}.`)
					const confirmed = await p.confirm({ message: `Push to ${pc.bold(effect.branch)}?`, initialValue: false })
					if (p.isCancel(confirmed) || !confirmed) return { kind: "user_cancelled" }
				}
				runLive(["git", "push", "-u", "origin", effect.branch])
				return { kind: "push_done" }
			}

			case "check_existing_pr": {
				const exists = runOk(["gh", "pr", "view", effect.branch, "--json", "url"])
				if (exists) {
					const prUrl = run(["gh", "pr", "view", effect.branch, "--json", "url", "-q", ".url"])
					return { kind: "pr_exists", prUrl }
				}
				return { kind: "no_pr" }
			}

			case "get_diff_main": {
				const diff = run(["git", "diff", "origin/main..HEAD"])
				return { kind: "diff_ready", diff }
			}

			case "generate_pr_details": {
				const isManual = this.llm instanceof ManualProvider
				const s = isManual ? null : p.spinner()
				s?.start("Generating PR details...")
				const result = await this.llm.generatePrDetails(effect.diff)
				s?.stop(result ? "PR details generated." : "LLM generation failed.")
				if (result) return { kind: "pr_details_generated", prDetails: result }
				if (this.isAuto) return { kind: "pr_details_failed" }
				p.log.warn("Falling back to manual input.")
				const manual = await this.manual.generatePrDetails(effect.diff)
				if (!manual) return { kind: "pr_details_failed" }
				return { kind: "pr_details_generated", prDetails: manual }
			}

			case "prompt_confirm_pr": {
				if (this.isAuto) {
					return { kind: "confirm_pr", accepted: true }
				}
				p.note(`${pc.bold(effect.prDetails.prTitle)}\n\n${effect.prDetails.prBody}`, "Pull Request")
				const accepted = await p.confirm({ message: "Create PR with this?", initialValue: true })
				if (p.isCancel(accepted)) return { kind: "user_cancelled" }
				return { kind: "confirm_pr", accepted }
			}

			case "create_pr": {
				const prUrl = run(["gh", "pr", "create", "--title", effect.prDetails.prTitle, "--body", effect.prDetails.prBody, "--base", "main", "--head", effect.branch])
				return { kind: "pr_created", prUrl }
			}

			case "log_pr_found":
				p.log.success(`PR found: ${pc.underline(effect.prUrl)}`)
				return null

			case "log_pr_created":
				p.log.success(`PR created: ${pc.underline(effect.prUrl)}`)
				return null

			case "prompt_confirm_merge": {
				if (this.isAuto) {
					return { kind: "confirm_merge", accepted: false }
				}
				const accepted = await p.confirm({ message: "Merge this PR now?", initialValue: true })
				if (p.isCancel(accepted)) return { kind: "user_cancelled" }
				return { kind: "confirm_merge", accepted }
			}

			case "merge_and_cleanup": {
				runLive(["gh", "pr", "merge", effect.prUrl, "--squash", "--delete-branch"])
				if (effect.onMain) {
					runLive(["git", "checkout", "main"])
				}
				runLive(["git", "pull", "origin", "main"])
				return { kind: "merge_done", prUrl: effect.prUrl }
			}

			case "collect_files": {
				const { git } = effect
				const files: FileEntry[] = []
				const seen = new Set<string>()

				if (git.hasStaged) {
					for (const f of run(["git", "diff", "--cached", "--name-only"]).split("\n").filter(Boolean)) {
						if (!seen.has(f)) { files.push({ path: f, status: "staged" }); seen.add(f) }
					}
				}
				if (git.hasUnstaged) {
					for (const f of run(["git", "diff", "--name-only"]).split("\n").filter(Boolean)) {
						if (!seen.has(f)) { files.push({ path: f, status: "modified" }); seen.add(f) }
					}
				}
				if (git.hasUntracked) {
					for (const f of git.untrackedRaw.split("\n").filter(Boolean)) {
						if (!seen.has(f)) { files.push({ path: f, status: "new" }); seen.add(f) }
					}
				}
				return { kind: "files_collected", files }
			}

			case "prompt_file_picker": {
				if (this.isAuto) {
					const allPaths = effect.files.map(f => f.path)
					if (this.isStack) {
						runOk(["git", "reset", "HEAD", "--quiet"])
						for (const f of allPaths) runLive(["git", "add", f])
						const diff = run(["git", "diff", "--cached"])
						const s = p.spinner()
						s.start("Generating stack plan...")
						const plan = await this.llm.generateStackPlan(effect.files, diff)
						s.stop(plan ? "Stack plan generated." : "Stack plan generation failed.")
						if (!plan) return { kind: "user_cancelled" }
						runOk(["git", "reset", "HEAD", "--quiet"])
						return { kind: "stack_plan_generated", plan }
					}
					return { kind: "files_picked", selectedFiles: allPaths }
				}
				const statusLabel = {
					staged: pc.green("staged"),
					modified: pc.yellow("modified"),
					new: pc.dim("new"),
				}
				const allPaths = effect.files.map(f => f.path)
				const pickMode = await p.select({
					message: "Select files to include",
					options: [
						{ value: "all" as const, label: `All files (${allPaths.length})` },
						{ value: "pick" as const, label: "Pick individually" },
					],
				})
				if (p.isCancel(pickMode)) return { kind: "user_cancelled" }
				if (pickMode === "all") {
					return { kind: "files_picked", selectedFiles: allPaths }
				}
				const selected = await p.multiselect({
					message: "Select files to include",
					options: effect.files.map(f => ({
						value: f.path,
						label: `${statusLabel[f.status]}  ${f.path}`,
					})),
					initialValues: effect.files.filter(f => f.status === "staged").map(f => f.path),
					required: true,
				})
				if (p.isCancel(selected)) return { kind: "user_cancelled" }
				return { kind: "files_picked", selectedFiles: selected }
			}

			case "stage_files": {
				runOk(["git", "reset", "HEAD", "--quiet"])
				for (const f of effect.selectedFiles) {
					runLive(["git", "add", f])
				}
				const shortStat = run(["git", "diff", "--cached", "--shortstat"])
				return { kind: "files_staged", shortStat }
			}

			case "get_staged_diff": {
				const diff = run(["git", "diff", "--cached"])
				return { kind: "diff_ready", diff }
			}

			case "generate_commit_details": {
				const isManual = this.llm instanceof ManualProvider
				const s = isManual ? null : p.spinner()
				s?.start("Generating commit details...")
				const result = await this.llm.generateCommitDetails(effect.diff)
				s?.stop(result ? "Commit details generated." : "LLM generation failed.")
				if (result) return { kind: "details_generated", details: result }
				if (this.isAuto) return { kind: "details_failed" }
				p.log.warn("Falling back to manual input.")
				const manual = await this.manual.generateCommitDetails(effect.diff)
				if (!manual) return { kind: "details_failed" }
				return { kind: "details_generated", details: manual }
			}

			case "prompt_branch_name": {
				if (this.isAuto) {
					return { kind: "branch_confirmed", branchName: effect.suggestion }
				}
				const input = await p.text({
					message: "Branch name",
					defaultValue: effect.suggestion,
					placeholder: effect.suggestion,
				})
				if (p.isCancel(input)) return { kind: "user_cancelled" }
				const branchName = ((input as string) || effect.suggestion)
					.toLowerCase()
					.replace(/\s+/g, "-")
					.replace(/[^a-z0-9._/-]/g, "")
				return { kind: "branch_confirmed", branchName }
			}

			case "show_commit_message":
				p.note(effect.commitMessage, "Commit message")
				return null

			case "prompt_commit_action": {
				if (this.isAuto) {
					return { kind: "commit_action", action: "accept" }
				}
				const action = await p.select({
					message: "Use this commit message?",
					options: [
						{ value: "accept" as const, label: "Yes, use it" },
						{ value: "edit" as const, label: "Edit in $EDITOR" },
						{ value: "cancel" as const, label: "Cancel" },
					],
				})
				if (p.isCancel(action)) return { kind: "user_cancelled" }
				return { kind: "commit_action", action: action as "accept" | "edit" | "cancel" }
			}

			case "open_editor": {
				const tmpfile = `/tmp/ship-commit-${Date.now()}.txt`
				await Bun.write(tmpfile, effect.commitMessage)
				Bun.spawnSync([process.env.EDITOR || "vim", tmpfile], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
				const edited = (await Bun.file(tmpfile).text()).trim()
				return { kind: "commit_edited", commitMessage: edited }
			}

			case "commit_only": {
				if (effect.onMain) {
					runLive(["git", "checkout", "-b", effect.branchName])
				}
				runLive(["git", "commit", "-m", effect.commitMessage])
				return { kind: "commit_done" }
			}

			case "log_pr_exists":
				p.log.success(`PR already exists: ${pc.underline(effect.prUrl)}`)
				p.log.info("Push updated the PR automatically.")
				return null

			case "show_pr_details":
				p.note(`${pc.bold(effect.details.prTitle)}\n\n${effect.details.prBody}`, "Pull Request")
				return null

			case "prompt_create_pr": {
				if (this.isAuto) {
					return { kind: "confirm_pr", accepted: true }
				}
				const accepted = await p.confirm({ message: "Create PR with this?", initialValue: true })
				if (p.isCancel(accepted)) return { kind: "user_cancelled" }
				return { kind: "confirm_pr", accepted }
			}

			case "create_full_pr": {
				const prUrl = run(["gh", "pr", "create", "--title", effect.details.prTitle, "--body", effect.details.prBody, "--base", "main", "--head", effect.branch])
				return { kind: "pr_created", prUrl }
			}

			case "log_merge_skip":
				p.log.info(`To check out the branch: ${pc.cyan(`git checkout ${effect.branchName}`)}`)
				p.log.info(`To merge later:          ${pc.cyan(`gh pr merge --squash`)}`)
				return null

			case "log_pr_skip":
				p.log.info(`Branch pushed. Create manually: ${pc.dim(`gh pr create --head ${effect.branchName}`)}`)
				return null

			case "unstage_all":
				runOk(["git", "reset", "HEAD", "--quiet"])
				return null

			case "check_remote_status": {
				runOk(["git", "fetch", "origin", effect.branch, "--quiet"])
				const behind = parseInt(run(["git", "rev-list", "--count", `HEAD..origin/${effect.branch}`]) || "0")
				return { kind: "remote_status", behind }
			}

			case "prompt_confirm_pull": {
				if (this.isAuto) {
					return { kind: "confirm_pull", accepted: true }
				}
				p.log.warn(`Branch is ${effect.behind} commit(s) behind remote.`)
				const accepted = await p.confirm({ message: "Pull latest changes?", initialValue: true })
				if (p.isCancel(accepted)) return { kind: "confirm_pull", accepted: false }
				return { kind: "confirm_pull", accepted }
			}

			case "pull_remote": {
				const result = Bun.spawnSync(["git", "pull", "origin", effect.branch], { stdout: "pipe", stderr: "pipe" })
				if (result.exitCode !== 0) {
					const stderr = result.stderr.toString()
					if (stderr.includes("CONFLICT") || stderr.includes("merge conflict")) {
						return { kind: "pull_conflict", message: stderr.trim() }
					}
					throw new Error(`git pull failed: ${stderr}`)
				}
				return { kind: "pull_done" }
			}

			case "prompt_post_commit": {
				if (this.isAuto) {
					const goal = this.mode.kind === "auto" ? this.mode.goal : "local"
					if (goal === "local") return { kind: "post_commit_choice", choice: "done" }
					if (goal === "push") return { kind: "post_commit_choice", choice: "push_only" }
					return { kind: "post_commit_choice", choice: "create_pr" }
				}
				const prLabel = effect.prUrl ? "Push & update PR" : "Create PR"
				const choice = await p.select({
					message: "What next?",
					options: [
						{ value: "create_pr" as const, label: prLabel },
						{ value: "push_only" as const, label: "Push" },
						{ value: "commit_more" as const, label: "Add more changes" },
						{ value: "done" as const, label: "Done (local only)" },
					],
				})
				if (p.isCancel(choice)) return { kind: "post_commit_choice", choice: "done" }
				return { kind: "post_commit_choice", choice: choice as "create_pr" | "push_only" | "commit_more" | "done" }
			}

			case "execute_stack_commit": {
				runOk(["git", "reset", "HEAD", "--quiet"])
				for (const f of effect.group.files) {
					runLive(["git", "add", f])
				}
				if (effect.isFirst && effect.onMain) {
					runLive(["git", "checkout", "-b", effect.branchName])
				}
				runLive(["git", "commit", "-m", effect.group.commitMessage])
				p.log.success(`Commit ${effect.index + 1}: ${effect.group.commitMessage.split("\n")[0]}`)
				return { kind: "stack_commit_done", nextIndex: effect.index + 1 }
			}
		}
		throw new Error(`Unhandled effect: ${(effect as any).kind}`)
	}
}
