<div align="center">

# 🔀 Claude Code Model Mapper
**Stop burning money on Anthropic API. Route your AI Coding Agent to Open-Source Models seamlessly.**

[![Visual Studio Code](https://img.shields.io/badge/VS%20Code-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

*An intelligent local HTTP proxy extension for VS Code that intercepts Anthropic API requests (specifically from Claude Code) and dynamically translates them into OpenAI Chat Completions format. Route heavy tasks to cheap open-source models (like Llama 3.3 70B or DeepSeek) while keeping the original Claude Code CLI experience intact.*

</div>

---

## 🛑 The Problem: The "Snowball Effect" of AI Coding
When using Agentic AI tools like **Claude Code**, the context window grows exponentially. A simple bug fix might involve 5 terminal commands and reading 10 files. Because AI is stateless, **every single request re-sends the entire chat history** (often 50,000+ tokens). 

At Anthropic's pricing ($15/1M input tokens for Opus), a single debugging session can easily cost you **$5 to $10**. 

## 💡 The Solution: Claude Code Model Mapper
Why pay for Opus to read a 2000-line log file or write a simple boilerplate? 

This extension acts as a **Smart Tollbooth** between your VS Code terminal and the AI provider. It allows you to:
1. **Intercept & Route:** Catch requests destined for `claude-sonnet` or `claude-opus` and reroute them to a cheaper provider (like **Fireworks AI** or **OpenRouter**).
2. **On-the-fly Translation:** Automatically convert Anthropic's proprietary `Messages API` format into the industry-standard `OpenAI Chat Completions API` format.
3. **Save 95% on API Costs:** Use top-tier open-source models (e.g., `DeepSeek-V3`, `Llama-3.3-70B`) for "muscle work" while keeping your expensive Anthropic key strictly for "brain work" (architecture planning).

---

## ✨ Key Features

- 🎭 **Zero-Friction Mapping:** Map `claude-haiku` to `llama-v3p2-3b` and `claude-sonnet` to `deepseek-v3p2`. The Claude CLI doesn't know the difference.
- 🔄 **Format Translation:** Flawlessly converts Anthropic's `tool_use` and `tool_result` into OpenAI's `function_calling` schema.
- 🛡️ **API Key Protection:** Your real API keys are securely stored in VS Code's Secret Storage. The extension injects a perfect 108-character dummy key into the terminal to bypass Claude Code's local regex validation.
- ✂️ **Built-in RTK (Reduce Token Keep) Philosophy:** Automatically truncates massive terminal outputs (like `npm install` or `gradle build` logs) that exceed 10,000 characters, saving you thousands of tokens per request.
- 🚦 **Live Traffic Monitor:** A beautiful VS Code Webview panel that lets you watch API requests, response times, and token usage in real-time.
- 🔌 **Zero External Dependencies:** Built entirely with native Node.js modules (`http`, `https`, `zlib`). No bulky npm packages.

---

## 🚀 Quick Start Workflow

### 1. The Setup
1. Install the `.vsix` extension in VS Code.
2. Open the **Claude Code Model Mapper** panel in the Activity Bar.
3. **Configure Provider:**
   - Select **Fireworks AI** (or Custom for OpenRouter).
   - Enter your API Key.
   - *Tip: Leave "Bypass OpenAI format" unchecked if you want to use open-source models.*
4. **Configure Mappings:**
   - `claude-haiku` ➡️ `accounts/fireworks/models/llama-v3p1-8b-instruct`
   - `claude-sonnet` ➡️ `accounts/fireworks/models/deepseek-v3p2`
   - Click **Save Mappings**.

### 2. The Execution (The Cost-Optimized Workflow)

**Phase 1: The Brain (Use Real Opus)**
Need high-level architecture? Bypass the mapper by injecting your real Anthropic key directly into a new terminal:
```bash
ANTHROPIC_API_KEY="sk-ant-api03-real-key..." claude -m claude-3-opus-20240229 "Analyze this workspace and write a detailed plan.md for the new feature"
```

**Phase 2: The Muscle (Use Open-Source via Mapper)**
Time to write code based on the plan? Use the standard terminal where the extension has injected its local proxy URL:
```bash
claude -m claude-sonnet "Read plan.md and implement step 1"
```
*Behind the scenes:* The extension intercepts `claude-sonnet`, renames it to `deepseek-v3p2`, translates the payload to OpenAI format, and sends it to Fireworks AI. **You get Opus-level coding quality at 1/20th the price.**

---

## 🛠️ Development & Building

Want to contribute or tweak the proxy logic?

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Bump patch version, package to .vsix, and force-install in VS Code
# (Press Cmd+Shift+B in VS Code to trigger this automatically)
npm run release:patch && npm run install:vsix
```

---

## 🧠 Synergy with `mnemos`
This extension works perfectly with [**Mnemos**](https://github.com/s60yucca/mnemos) — the persistent memory engine for AI coding agents. 

While **Model Mapper** reduces your *cost per token* (by routing to cheaper models and truncating logs), **Mnemos** reduces your *total tokens* (by injecting only relevant long-term memories via MCP instead of forcing the AI to re-read your entire codebase). 

Combine both, use the `/clear` command frequently to flush bloated chat history, and watch your API bills drop to near zero.

---

<div align="center">
  <i>Built for the AI Engineering era (2026).</i>
</div>