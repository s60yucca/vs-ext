# Claude Code Model Mapper - Code Wiki

## 1. Overall Project Architecture
- **Purpose**: A VS Code extension that intercepts Anthropic API requests (specifically from "Claude Code") via a local HTTP proxy.
- **Translation**: Translates Anthropic Messages API format into OpenAI Chat Completions format to support alternative LLM providers.
- **Environment Manipulation**: Alters VS Code environment variables (`ANTHROPIC_BASE_URL`, etc.) to automatically route "Claude Code" traffic through the local proxy.
- **User Interface**: Provides interactive UI through Webview panels in the Activity Bar to manage configurations and monitor live API traffic.
- **Zero Dependencies**: Operates with zero external runtime dependencies, utilizing native Node.js modules for HTTP routing and stream manipulation.

## 2. Major Modules and Responsibilities
- **Extension Core** ([extension.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/extension.ts)): Coordinates initialization, wires event listeners between the proxy and UI panels, and updates workspace environment variables.
- **Proxy Server** ([proxyServer.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/proxyServer.ts)): Manages the local HTTP server, handles request/response translation, converts streaming Server-Sent Events (SSE), and sanitizes text.
- **Configuration Store** ([configStore.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/configStore.ts)): Wraps VS Code's configuration and secrets APIs to persist model mappings, API keys, and provider settings.
- **Webview Panels** ([configPanel.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/configPanel.ts), [trafficPanel.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/trafficPanel.ts)): Implements the Config Panel (user settings UI) and Traffic Panel (live request monitoring UI).
- **Model Mapper** ([modelMapper.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/modelMapper.ts)): Resolves source Anthropic model names to user-configured target models.

## 3. Key Classes and Functions

### Key Classes
- `ProxyServer` in [proxyServer.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/proxyServer.ts): Starts the HTTP server, handles port binding fallbacks, and processes incoming requests.
- `ConfigStore` in [configStore.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/configStore.ts): Manages reading and writing extension settings and secure API keys.
- `ConfigPanel` in [configPanel.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/configPanel.ts): Registers the Webview provider for the configuration UI and handles save events from the frontend.
- `TrafficPanel` in [trafficPanel.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/trafficPanel.ts): Maintains a bounded list of recent API requests and updates the UI via message passing.
- `StreamingTextSanitizer` in [proxyServer.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/proxyServer.ts): Strips specific structural tags (like `<think>` or `<tool_call>`) from streamed responses on the fly.

### Key Functions
- `activate` in [extension.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/extension.ts): Bootstraps the extension, starts the proxy, and registers commands.
- `configureClaudeCode` in [extension.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/extension.ts): Injects the local proxy URL into VS Code's terminal and workspace environment variables.
- `anthropicToOpenAI` in [proxyServer.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/proxyServer.ts): Translates Anthropic's message schema (including tool usage) to OpenAI's schema.
- `resolve` in [modelMapper.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/modelMapper.ts): Matches requested models to target models using exact match or longest-prefix logic.

## 4. Dependency Relationships
- [extension.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/extension.ts) acts as the central orchestrator, depending on `ProxyServer`, `ConfigStore`, `TrafficPanel`, and `ConfigPanel`.
- [proxyServer.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/proxyServer.ts) relies on [modelMapper.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/modelMapper.ts) for model resolution and [types.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/types.ts) for TypeScript interfaces.
- The UI components ([configPanel.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/configPanel.ts), [trafficPanel.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/trafficPanel.ts)) depend heavily on [types.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/types.ts) for webview message protocols and [configStore.ts](file:///Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/src/configStore.ts) for state persistence.
- The core logic modules depend exclusively on Node.js built-ins (`http`, `https`, `zlib`, `events`) and the VS Code extension API.

## 5. Instructions for Running and Testing
- **Install Dependencies**: Run `npm install` to install development dependencies.
- **Build**: Compile the TypeScript code using `npm run compile` or start the watcher with `npm run watch`.
- **Run**: Press `F5` in VS Code to launch the Extension Development Host and load the extension in a new window.
- **Test**: Run unit tests via Node's native test runner using `npm run test` (executes tests in `out/test/*.test.js`).