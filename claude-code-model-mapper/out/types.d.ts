export interface ModelConfig {
    sourceModel: string;
    targetModel: string;
    enabled: boolean;
}
export interface LMProviderConfig {
    baseUrl: string;
    nativeAnthropic?: boolean;
    authHeader?: string;
    authValuePrefix?: string;
    isFullEndpoint?: boolean;
}
export interface ProxyServerOptions {
    port: number;
    portRangeEnd: number;
}
export type RequestStatus = 'queued' | 'processing' | 'completed' | 'error';
export interface RequestEvent {
    id: string;
    sourceModel: string;
    targetModel: string;
    status: RequestStatus;
    startTime: number;
    endTime?: number;
    error?: string;
}
export type ConfigPanelMessage = {
    type: 'saveConfigs';
    configs: ModelConfig[];
} | {
    type: 'saveLMProvider';
    config: LMProviderConfig;
    apiKey?: string;
} | {
    type: 'toggleMapper';
    enabled: boolean;
} | {
    type: 'ready';
};
export type ConfigPanelResponse = {
    type: 'init';
    configs: ModelConfig[];
    lmProvider: LMProviderConfig;
    hasApiKey: boolean;
    mapperEnabled: boolean;
    version?: string;
} | {
    type: 'saved';
    scope: 'configs' | 'provider' | 'mapper';
} | {
    type: 'error';
    message: string;
};
export type TrafficPanelMessage = {
    type: 'init';
    requests: RequestEvent[];
} | {
    type: 'add';
    request: RequestEvent;
} | {
    type: 'update';
    id: string;
    update: Partial<RequestEvent>;
} | {
    type: 'clear';
};
export type TrafficPanelCommand = {
    type: 'clearCompleted';
} | {
    type: 'ready';
};
export interface ValidationResult {
    valid: boolean;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map