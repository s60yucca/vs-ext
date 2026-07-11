export type ReviewFinding = {
  file: string;
  line: number | string;
  summary: string;
  failure_scenario: string;
};

export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map(part => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object') {
        const typedPart = part as { type?: unknown; text?: unknown };
        if (['text', 'output_text'].includes(String(typedPart.type)) && typeof typedPart.text === 'string') {
          return typedPart.text;
        }
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function extractDeltaText(delta: unknown): string {
  if (!delta || typeof delta !== 'object') {
    return '';
  }
  return extractTextContent((delta as { content?: unknown }).content);
}

export function sanitizeVisibleText(text: string): string {
  return new StreamingTextSanitizer().push(text, true).trim();
}

export function formatReviewFindings(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isReviewFinding)) {
    return text;
  }
  return [
    '## Review findings',
    '',
    ...(parsed as ReviewFinding[]).flatMap((finding, index) => [
      `### ${index + 1}. ${finding.summary}`,
      '',
      `\`${finding.file.replace(/`/g, '\\`')}:${finding.line}\``,
      '',
      finding.failure_scenario,
      '',
    ]),
  ].join('\n').trimEnd();
}

export class StreamingVisibleTextAdapter {
  private readonly sanitizer = new StreamingTextSanitizer();

  push(input: string, flush = false): string {
    return this.sanitizer.push(input, flush);
  }
}

class StreamingTextSanitizer {
  private pending = '';
  private hiddenTag: string | null = null;

  push(input: string, flush = false): string {
    if (!input && !flush) {
      return '';
    }
    this.pending += input;
    let output = '';
    while (this.pending.length > 0) {
      if (this.hiddenTag) {
        const closeTag = `</${this.hiddenTag}>`;
        const closeIndex = this.pending.indexOf(closeTag);
        if (closeIndex === -1) {
          if (flush) {
            this.pending = '';
            this.hiddenTag = null;
          }
          break;
        }
        this.pending = this.pending.slice(closeIndex + closeTag.length);
        this.hiddenTag = null;
        continue;
      }

      const openMatch = this.pending.match(/<(think|fast_path|tool_call)>/);
      if (!openMatch || openMatch.index === undefined) {
        const visiblePrefix = flush ? this.pending : safeVisiblePrefix(this.pending);
        output += stripStandaloneTags(visiblePrefix);
        this.pending = flush ? '' : this.pending.slice(visiblePrefix.length);
        break;
      }
      output += stripStandaloneTags(this.pending.slice(0, openMatch.index));
      this.pending = this.pending.slice(openMatch.index + openMatch[0].length);
      this.hiddenTag = openMatch[1];
    }
    return output;
  }
}

function isReviewFinding(value: unknown): value is ReviewFinding {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const finding = value as Partial<ReviewFinding>;
  return typeof finding.file === 'string'
    && (typeof finding.line === 'number' || typeof finding.line === 'string')
    && typeof finding.summary === 'string'
    && typeof finding.failure_scenario === 'string';
}

function safeVisiblePrefix(text: string): string {
  const lastOpen = text.lastIndexOf('<');
  const lastClose = text.lastIndexOf('>');
  return lastOpen > lastClose ? text.slice(0, lastOpen) : text;
}

function stripStandaloneTags(text: string): string {
  return text.replace(/<\/?(think|fast_path|tool_call)>/g, '');
}
