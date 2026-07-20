// Core configuration types

export interface ModelConfig {
  sourceModel: string; // e.g. "claude-haiku"
  targetModel: string; // e.g. "minimax/minimax-m2.5"
  enabled: boolean;
}

export interface LMProviderConfig {
  baseUrl: string; // e.g. "https://openrouter.ai/api/v1"
  nativeAnthropic?: boolean; // Set to true if the provider supports native Anthropic Messages API
  authHeader?: string;       // Custom auth header name, e.g. "api-key" for Azure
  authValuePrefix?: string;  // Prefix for auth value, e.g. "" for Azure (default "Bearer ")
  isFullEndpoint?: boolean;  // When true, baseUrl is the complete endpoint URL (no path appending)
}

export interface ProxyServerOptions {
  port: number;
  portRangeEnd: number;
}

// Request tracking types

export type RequestStatus = 'queued' | 'processing' | 'completed' | 'error';

export interface RequestEvent {
  id: string;           // e.g. "req-69b7"
  sourceModel: string;
  targetModel: string;
  status: RequestStatus;
  startTime: number;    // Date.now()
  endTime?: number;
  error?: string;
}

// Webview message protocol — Config Panel

// Webview → Extension
export type ConfigPanelMessage =
  | { type: 'saveConfigs'; configs: ModelConfig[] }
  | { type: 'saveLMProvider'; config: LMProviderConfig; apiKey?: string }
  | { type: 'toggleMapper'; enabled: boolean }
  | { type: 'ready' };

// Extension → Webview
export type ConfigPanelResponse =
  | { type: 'init'; configs: ModelConfig[]; lmProvider: LMProviderConfig; hasApiKey: boolean; mapperEnabled: boolean; version?: string }
  | { type: 'saved'; scope: 'configs' | 'provider' | 'mapper' }
  | { type: 'error'; message: string };

// Webview message protocol — Traffic Panel

// Extension → Webview
export type TrafficPanelMessage =
  | { type: 'init'; requests: RequestEvent[] }
  | { type: 'add'; request: RequestEvent }
  | { type: 'update'; id: string; update: Partial<RequestEvent> }
  | { type: 'clear' };

// Webview → Extension
export type TrafficPanelCommand =
  | { type: 'clearCompleted' }
  | { type: 'ready' };

// Validation result type

export interface ValidationResult {
  valid: boolean;
  error?: string;
}
