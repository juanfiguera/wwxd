/**
 * Share-snapshot format. Frozen transcript of a wwxd conversation, designed
 * to be portable: copy/paste as Markdown today, upload to a hosted gallery
 * tomorrow. The JSON schema is versioned so future readers can detect old
 * payloads.
 */

export type ShareMessage = {
  role: 'user' | 'assistant';
  /** For roundtable: which persona spoke. Null for solo assistant turns
   *  (the speaker is implied by `personas[0]`) and user turns. */
  speaker?: string | null;
  text: string;
};

export type SharePersona = {
  username: string;
  displayName: string;
};

export type ShareSnapshot = {
  schemaVersion: 1;
  kind: 'solo' | 'roundtable';
  generatedAt: string;
  generatedBy: 'wwxd';
  /** Human-readable disclaimer baked into the snapshot so any future viewer
   *  or importer has the warning available without having to reconstruct it. */
  disclaimer: string;
  /** Display title for the conversation (e.g., group name). Optional —
   *  the renderer falls back to the persona display names joined. */
  title?: string;
  personas: SharePersona[];
  messages: ShareMessage[];
};

/**
 * Centralized disclaimer text, embedded in JSON snapshots and woven into
 * every text rendering. Keep it short enough that people will actually
 * include it when they re-share.
 */
export function disclaimerFor(input: {
  kind: 'solo' | 'roundtable';
  personas: SharePersona[];
}): string {
  const names = input.personas.map((p) => p.displayName).join(', ');
  const plural = input.personas.length > 1;
  const subject = plural ? 'these people' : 'this person';
  return (
    `AI-generated impression${plural ? 's' : ''} of ${names}, ` +
    `trained on their public writing. Not ${subject}. ` +
    `Replies may misrepresent ${plural ? 'them' : 'their'} actual views. ` +
    `Don't quote as if they said it.`
  );
}

export function buildSnapshot(input: {
  kind: 'solo' | 'roundtable';
  title?: string;
  personas: SharePersona[];
  messages: ShareMessage[];
}): ShareSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: 'wwxd',
    disclaimer: disclaimerFor({ kind: input.kind, personas: input.personas }),
    kind: input.kind,
    title: input.title,
    personas: input.personas,
    messages: input.messages,
  };
}

function snapshotHeading(s: ShareSnapshot): string {
  if (s.title) return s.title;
  const names = s.personas.map((p) => p.displayName).join(', ');
  return s.kind === 'roundtable' ? `Roundtable: ${names}` : names;
}

/** Markdown rendering, suitable for Slack/Discord/Twitter long-form.
 *  Leads with the AI disclaimer as a blockquote (most clients render it as
 *  a callout). Footer repeats it in shorter form. The duplication is
 *  deliberate — readers who skim only the top or only the bottom still see
 *  the warning. */
export function snapshotToMarkdown(s: ShareSnapshot): string {
  const personaByUsername = new Map(s.personas.map((p) => [p.username, p.displayName]));
  const lines: string[] = [];
  lines.push(`# ${snapshotHeading(s)}`);
  lines.push('');
  lines.push(`> **AI impression${s.personas.length > 1 ? 's' : ''}, not the real ${s.personas.length > 1 ? 'people' : 'person'}.** ${s.disclaimer}`);
  lines.push('');
  for (const m of s.messages) {
    if (!m.text.trim()) continue;
    if (m.role === 'user') {
      lines.push(`**You:** ${m.text.trim()}`);
    } else {
      const speakerName = m.speaker
        ? (personaByUsername.get(m.speaker) ?? m.speaker)
        : (s.personas[0]?.displayName ?? 'AI');
      lines.push(`**${speakerName} (AI):** ${m.text.trim()}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push(`AI-generated impression via [wwxd](https://wwxd.chat) · ${formatGeneratedAt(s.generatedAt)}`);
  return lines.join('\n');
}

/** Plain-text rendering, suitable for iMessage / email. Leads with the
 *  disclaimer in a clearly-delimited block; footer repeats it shorter. */
export function snapshotToPlainText(s: ShareSnapshot): string {
  const personaByUsername = new Map(s.personas.map((p) => [p.username, p.displayName]));
  const lines: string[] = [];
  lines.push(snapshotHeading(s));
  lines.push('');
  lines.push(`[AI ${s.personas.length > 1 ? 'impressions' : 'impression'}, not the real ${s.personas.length > 1 ? 'people' : 'person'}] ${s.disclaimer}`);
  lines.push('');
  for (const m of s.messages) {
    if (!m.text.trim()) continue;
    if (m.role === 'user') {
      lines.push(`You: ${m.text.trim()}`);
    } else {
      const speakerName = m.speaker
        ? (personaByUsername.get(m.speaker) ?? m.speaker)
        : (s.personas[0]?.displayName ?? 'AI');
      lines.push(`${speakerName} (AI): ${m.text.trim()}`);
    }
    lines.push('');
  }
  lines.push(`— AI-generated impression via wwxd · ${formatGeneratedAt(s.generatedAt)}`);
  return lines.join('\n');
}

export function snapshotToJsonBlob(s: ShareSnapshot): Blob {
  return new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
}

export function suggestedFilename(s: ShareSnapshot): string {
  const slug = (s.title ?? s.personas.map((p) => p.username).join('-'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  const date = s.generatedAt.slice(0, 10);
  return `${slug || 'conversation'}-${date}.wwxd.json`;
}

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}
