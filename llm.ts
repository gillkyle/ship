import * as p from "@clack/prompts"
import type { CommitDetails, PrDetails } from "./states.ts"

// ── Provider Interface ─────────────────────────────────────────────

export interface LlmProvider {
	generateCommitDetails(diff: string): Promise<CommitDetails | null>
	generatePrDetails(diff: string): Promise<PrDetails | null>
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

	private async call<T>(systemPrompt: string, diff: string, name: string, schema: object, map: (raw: any) => T): Promise<T | null> {
		try {
			const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: "llama-3.3-70b-versatile",
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: diff },
					],
					response_format: {
						type: "json_schema",
						json_schema: { name, strict: true, schema },
					},
				}),
			})
			if (!res.ok) return null
			const data = await res.json() as { choices: Array<{ message: { content: string } }> }
			return map(JSON.parse(data.choices[0]!.message.content))
		} catch {
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

class ManualProvider implements LlmProvider {
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
}

// ── Factory ────────────────────────────────────────────────────────

export function createLlmProvider(): LlmProvider {
	const groqKey = process.env.GROQ_API_KEY
	const anthropicKey = process.env.ANTHROPIC_API_KEY

	if (groqKey) return withFallback(new GroqProvider(groqKey))
	if (anthropicKey) return withFallback(new AnthropicProvider(anthropicKey))
	return new ManualProvider()
}

function withFallback(primary: LlmProvider): LlmProvider {
	const manual = new ManualProvider()
	return {
		async generateCommitDetails(diff: string) {
			const result = await primary.generateCommitDetails(diff)
			if (result) return result
			p.log.warn("LLM call failed, falling back to manual input.")
			return manual.generateCommitDetails(diff)
		},
		async generatePrDetails(diff: string) {
			const result = await primary.generatePrDetails(diff)
			if (result) return result
			p.log.warn("LLM call failed, falling back to manual input.")
			return manual.generatePrDetails(diff)
		},
	}
}
