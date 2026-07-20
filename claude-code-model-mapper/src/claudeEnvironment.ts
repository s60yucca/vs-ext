import * as vscode from 'vscode';

type EnvironmentVariable = { name: string; value: string };
type EnvironmentSnapshot = {
  claudeVariables: EnvironmentVariable[];
  terminalVariables: Record<string, string>;
  workspaceVariables: Record<string, string>;
};

const SNAPSHOT_KEY = 'claudeCodeModelMapper.environmentSnapshot';
const DUMMY_KEY = 'sk-ant-api03-dummykey000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

export class ClaudeEnvironmentManager {
  private readonly platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';

  constructor(private readonly context: vscode.ExtensionContext) {}

  async enable(port: number): Promise<void> {
    let snapshot = this.context.workspaceState.get<EnvironmentSnapshot>(SNAPSHOT_KEY);
    if (!snapshot) {
      snapshot = this.captureCleanEnvironment();
      await this.context.workspaceState.update(SNAPSHOT_KEY, snapshot);
    }
    const proxyUrl = `http://127.0.0.1:${port}`;
    await Promise.all([
      this.updateClaudeVariables([
        ...removeMapperClaudeVariables(snapshot.claudeVariables),
        { name: 'ANTHROPIC_BASE_URL', value: proxyUrl },
        { name: 'ANTHROPIC_API_KEY', value: DUMMY_KEY },
        { name: 'ANTHROPIC_AUTH_TOKEN', value: '' },
      ]),
      this.updateTerminalVariables({
        ...removeMapperRecord(snapshot.terminalVariables),
        ANTHROPIC_BASE_URL: proxyUrl,
        ANTHROPIC_API_KEY: DUMMY_KEY,
        ANTHROPIC_AUTH_TOKEN: '',
      }),
      this.updateWorkspaceVariables({
        ...removeMapperRecord(snapshot.workspaceVariables),
        ANTHROPIC_BASE_URL: proxyUrl,
        ANTHROPIC_API_KEY: DUMMY_KEY,
        ANTHROPIC_AUTH_TOKEN: '',
      }),
    ]);
  }

  async disable(): Promise<void> {
    const snapshot = this.context.workspaceState.get<EnvironmentSnapshot>(SNAPSHOT_KEY);
    const fallback = this.captureCleanEnvironment();
    const restore = snapshot || fallback;
    await Promise.all([
      this.updateClaudeVariables(removeMapperClaudeVariables(restore.claudeVariables)),
      this.updateTerminalVariables(removeMapperRecord(restore.terminalVariables)),
      this.updateWorkspaceVariables(removeMapperRecord(restore.workspaceVariables)),
    ]);
    await this.context.workspaceState.update(SNAPSHOT_KEY, undefined);
  }

  private captureCleanEnvironment(): EnvironmentSnapshot {
    const claudeVariables = vscode.workspace
      .getConfiguration('claudeCode')
      .get<EnvironmentVariable[]>('environmentVariables', []);
    const terminalVariables = vscode.workspace
      .getConfiguration('terminal.integrated.env')
      .get<Record<string, string>>(this.platform, {});
    const workspaceVariables = vscode.workspace
      .getConfiguration()
      .get<Record<string, string>>('env', {});
    return {
      claudeVariables: removeMapperClaudeVariables(claudeVariables),
      terminalVariables: removeMapperRecord(terminalVariables),
      workspaceVariables: removeMapperRecord(workspaceVariables),
    };
  }

  private updateClaudeVariables(variables: EnvironmentVariable[]): Thenable<void> {
    return vscode.workspace
      .getConfiguration('claudeCode')
      .update('environmentVariables', variables, vscode.ConfigurationTarget.Global);
  }

  private updateTerminalVariables(variables: Record<string, string>): Thenable<void> {
    return vscode.workspace
      .getConfiguration('terminal.integrated.env')
      .update(this.platform, variables, vscode.ConfigurationTarget.Workspace);
  }

  private updateWorkspaceVariables(variables: Record<string, string>): Thenable<void> {
    return vscode.workspace
      .getConfiguration()
      .update('env', variables, vscode.ConfigurationTarget.Workspace);
  }
}

function removeMapperClaudeVariables(variables: EnvironmentVariable[]): EnvironmentVariable[] {
  return variables.filter(variable => {
    if (variable.name === 'ANTHROPIC_BASE_URL') {
      return !isLocalProxyUrl(variable.value);
    }
    if (variable.name === 'ANTHROPIC_API_KEY') {
      return variable.value !== DUMMY_KEY;
    }
    if (variable.name === 'ANTHROPIC_AUTH_TOKEN') {
      return variable.value !== '';
    }
    return true;
  });
}

function removeMapperRecord(variables: Record<string, string>): Record<string, string> {
  const cleaned = { ...variables };
  if (isLocalProxyUrl(cleaned.ANTHROPIC_BASE_URL)) {
    delete cleaned.ANTHROPIC_BASE_URL;
  }
  if (cleaned.ANTHROPIC_API_KEY === DUMMY_KEY) {
    delete cleaned.ANTHROPIC_API_KEY;
  }
  if (cleaned.ANTHROPIC_AUTH_TOKEN === '') {
    delete cleaned.ANTHROPIC_AUTH_TOKEN;
  }
  return cleaned;
}

function isLocalProxyUrl(value: string | undefined): boolean {
  return !!value && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(value);
}
