import * as p from "@clack/prompts"
import type { CliMode, CommitDetails, FileEntry, PrDetails, StackPlan } from "./states.ts"

// ── Provider Interface ─────────────────────────────────────────────

export interface LlmProvider {
	generateCommitDetails(diff: string): Promise<CommitDetails | null>
	generatePrDetails(diff: string): Promise<PrDetails | null>
	generateStackPlan(files: FileEntry[], diff: string): Promise<StackPlan | null>
}

// ── System Prompts ─────────────────────────────────────────────────

const COMMIT_SYSTEM_PROMPT = `You are a git commit message generator. Given a diff, produce:
- branch_name: kebab-case branch name (e.g. fix-sql-parser, feat-add-auth)
- commit_message: conventional commit (first line under 72 chars with fix:/feat:/refactor:/perf:/chore:/docs: prefix, then blank line, then optionally 1-3 bullet points if non-trivial)
- pr_title: PR title under 70 chars, same conventional prefix
- pr_body: markdown with ## Summary (1-3 bullets) and ## Changes (brief description)`

const PR_SYSTEM_PROMPT = `You are a PR description generator. Given a diff, produce:
- pr_title: PR title under 70 chars with conventional prefix (feat:/fix:/refactor:/perf:/chore:/docs:)
- pr_body: markdown with ## Summary (1-3 bullets) and ## Changes (brief description)`

const STACK_SYSTEM_PROMPT = `You are a git commit organizer. Given changed files and their diff, group them into logical, atomic commits.
Rules:
- Each group = one logical change (feature, refactor, fix, etc.)
- Every file in exactly one group
- Order: foundational changes first
- Each group gets a conventional commit message (fix:/feat:/etc., first line <72 chars)
- One branch_name (kebab-case), pr_title (<70 chars), and pr_body (markdown) for the whole set`

// ── JSON Schemas ───────────────────────────────────────────────────

const COMMIT_SCHEMA = {
	type: "object" as const,
	properties: {
		branch_name: { type: "string" as const },
		commit_message: { type: "string" as const },
		pr_title: { type: "string" as const },
		pr_body: { type: "string" as const },
	},
	required: ["branch_name", "commit_message", "pr_title", "pr_body"] as const,
	additionalProperties: false as const,
}

const PR_SCHEMA = {
	type: "object" as const,
	properties: {
		pr_title: { type: "string" as const },
		pr_body: { type: "string" as const },
	},
	required: ["pr_title", "pr_body"] as const,
	additionalProperties: false as const,
}

const STACK_SCHEMA = {
	type: "object" as const,
	properties: {
		groups: {
			type: "array" as const,
			items: {
				type: "object" as const,
				properties: {
					files: { type: "array" as const, items: { type: "string" as const } },
					commit_message: { type: "string" as const },
				},
				required: ["files", "commit_message"] as const,
				additionalProperties: false as const,
			},
		},
		branch_name: { type: "string" as const },
		pr_title: { type: "string" as const },
		pr_body: { type: "string" as const },
	},
	required: ["groups", "branch_name", "pr_title", "pr_body"] as const,
	additionalProperties: false as const,
}

// ── Groq Provider ──────────────────────────────────────────────────

class GroqProvider implements LlmProvider {
	constructor(private apiKey: string) {}

	async generateCommitDetails(diff: string): Promise<CommitDetails | null> {
		return this.call<CommitDetails>(COMMIT_SYSTEM_PROMPT, diff, "commit_details", COMMIT_SCHEMA, raw => ({
			branchName: raw.branch_name,
			commitMessage: raw.commit_message,
			prTitle: raw.pr_title,
			prBody: raw.pr_body,
		}))
	}

	async generatePrDetails(diff: string): Promise<PrDetails | null> {
		return this.call<PrDetails>(PR_SYSTEM_PROMPT, diff, "pr_details", PR_SCHEMA, raw => ({
			prTitle: raw.pr_title,
			prBody: raw.pr_body,
		}))
	}

	async generateStackPlan(files: FileEntry[], diff: string): Promise<StackPlan | null> {
		const fileList = files.map(f => `${f.status}: ${f.path}`).join("\n")
		const userContent = `Files:\n${fileList}\n\nDiff:\n${diff}`
		return this.call<StackPlan>(STACK_SYSTEM_PROMPT, userContent, "stack_plan", STACK_SCHEMA, raw => ({
			groups: raw.groups.map((g: any) => ({ files: g.files, commitMessage: g.commit_message })),
			branchName: raw.branch_name,
			prTitle: raw.pr_title,
			prBody: raw.pr_body,
		}))
	}

	private async call<T>(systemPrompt: string, diff: string, name: string, schema: object, map: (raw: any) => T): Promise<T | null> {
		try {
			const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: "moonshotai/kimi-k2-instruct-0905",
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: diff },
					],
					response_format: {
						type: "json_schema",
						json_schema: { name, strict: false, schema },
					},
				}),
			})
			if (!res.ok) {
				const text = await res.text().catch(() => "")
				p.log.warn(`Groq API error (${res.status}): ${text.slice(0, 200)}`)
				return null
			}
			const data = await res.json() as { choices: Array<{ message: { content: string } }> }
			return map(JSON.parse(data.choices[0]!.message.content))
		} catch (err) {
			p.log.warn(`Groq request failed: ${err instanceof Error ? err.message : String(err)}`)
			return null
		}
	}
}

// ── Anthropic Provider ─────────────────────────────────────────────

class AnthropicProvider implements LlmProvider {
	constructor(private apiKey: string) {}

	async generateCommitDetails(diff: string): Promise<CommitDetails | null> {
		return this.call<CommitDetails>(COMMIT_SYSTEM_PROMPT, diff, "commit_details", COMMIT_SCHEMA, raw => ({
			branchName: raw.branch_name,
			commitMessage: raw.commit_message,
			prTitle: raw.pr_title,
			prBody: raw.pr_body,
		}))
	}

	async generatePrDetails(diff: string): Promise<PrDetails | null> {
		return this.call<PrDetails>(PR_SYSTEM_PROMPT, diff, "pr_details", PR_SCHEMA, raw => ({
			prTitle: raw.pr_title,
			prBody: raw.pr_body,
		}))
	}

	async generateStackPlan(files: FileEntry[], diff: string): Promise<StackPlan | null> {
		const fileList = files.map(f => `${f.status}: ${f.path}`).join("\n")
		const userContent = `Files:\n${fileList}\n\nDiff:\n${diff}`
		return this.call<StackPlan>(STACK_SYSTEM_PROMPT, userContent, "stack_plan", STACK_SCHEMA, raw => ({
			groups: raw.groups.map((g: any) => ({ files: g.files, commitMessage: g.commit_message })),
			branchName: raw.branch_name,
			prTitle: raw.pr_title,
			prBody: raw.pr_body,
		}))
	}

	private async call<T>(systemPrompt: string, diff: string, name: string, schema: object, map: (raw: any) => T): Promise<T | null> {
		try {
			const res = await fetch("https://api.anthropic.com/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.apiKey,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify({
					model: "claude-haiku-4-5",
					max_tokens: 1024,
					tools: [{
						name,
						description: "Generate git metadata from a diff",
						input_schema: schema,
					}],
					tool_choice: { type: "tool", name },
					messages: [{ role: "user", content: `${systemPrompt}\n\n${diff}` }],
				}),
			})
			if (!res.ok) return null
			const data = await res.json() as { content: Array<{ type: string; input?: any }> }
			const toolBlock = data.content.find(b => b.type === "tool_use")
			if (!toolBlock?.input) return null
			return map(toolBlock.input)
		} catch {
			return null
		}
	}
}

// ── Manual Provider ────────────────────────────────────────────────

export class ManualProvider implements LlmProvider {
	async generateCommitDetails(_diff: string): Promise<CommitDetails | null> {
		const branchName = await p.text({ message: "Branch name", placeholder: "feat-my-feature" })
		if (p.isCancel(branchName)) return null

		const commitMessage = await p.text({ message: "Commit message", placeholder: "feat: add feature" })
		if (p.isCancel(commitMessage)) return null

		const prTitle = await p.text({ message: "PR title", placeholder: "feat: add feature" })
		if (p.isCancel(prTitle)) return null

		const prBody = await p.text({ message: "PR body", placeholder: "## Summary\n- ..." })
		if (p.isCancel(prBody)) return null

		return {
			branchName: branchName as string,
			commitMessage: commitMessage as string,
			prTitle: prTitle as string,
			prBody: prBody as string,
		}
	}

	async generatePrDetails(_diff: string): Promise<PrDetails | null> {
		const prTitle = await p.text({ message: "PR title", placeholder: "feat: add feature" })
		if (p.isCancel(prTitle)) return null

		const prBody = await p.text({ message: "PR body", placeholder: "## Summary\n- ..." })
		if (p.isCancel(prBody)) return null

		return { prTitle: prTitle as string, prBody: prBody as string }
	}

	async generateStackPlan(_files: FileEntry[], _diff: string): Promise<StackPlan | null> {
		return null
	}
}

// ── Factory ────────────────────────────────────────────────────────

export function createLlmProvider(mode: CliMode): LlmProvider {
	const groqKey = process.env.GROQ_API_KEY
	const anthropicKey = process.env.ANTHROPIC_API_KEY

	if (mode.kind === "auto") {
		if (groqKey) return new GroqProvider(groqKey)
		if (anthropicKey) return new AnthropicProvider(anthropicKey)
		p.log.error("Autonomous mode requires GROQ_API_KEY or ANTHROPIC_API_KEY.")
		process.exit(1)
	}

	if (groqKey) return new GroqProvider(groqKey)
	if (anthropicKey) return new AnthropicProvider(anthropicKey)
	return new ManualProvider()
}
