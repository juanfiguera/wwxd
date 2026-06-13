import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listConversations } from '@/lib/db';
import { listGroups } from '@/lib/groups';
import { loadCorpus } from '@/lib/persona';
import { personaStyle } from '@/lib/persona-styling';
import { ChatRailClient, type RailGroup, type RailConv } from './chat-rail-client';

type PersonaLite = {
  username: string;
  displayName: string;
  tweetCount: number;
  fetchedAt: string;
};

async function listPersonas(): Promise<PersonaLite[]> {
  const dir = resolve(process.cwd(), 'data');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const usernames = entries
    .filter(
      (f) =>
        f.endsWith('.json') && !f.endsWith('.embeddings.json') && f !== 'groups.json',
    )
    .map((f) => f.replace(/\.json$/, ''));
  const out: PersonaLite[] = [];
  for (const username of usernames) {
    try {
      const corpus = await loadCorpus(username);
      out.push({
        username,
        displayName: corpus.displayName || username,
        tweetCount: corpus.tweets.length,
        fetchedAt: corpus.fetchedAt,
      });
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));
}

export async function ChatRail() {
  const [personas, groupsRaw, conversations] = await Promise.all([
    listPersonas(),
    listGroups(),
    Promise.resolve(listConversations()),
  ]);

  const personaByUsername = new Map(personas.map((p) => [p.username, p]));

  // For each saved group, find the most recent roundtable conversation whose
  // current active participants exactly match the group's lineup. Clicking
  // the group in the rail will resume that conversation instead of always
  // forking a fresh one — that's the fix for the "two AI Lounge rows that
  // look identical" duplication problem. New conversations still happen
  // explicitly via "+ New conversation" at the top of the rail.
  const sortedKey = (us: string[]): string => [...us].sort().join(',');
  const latestByLineup = new Map<string, string>(); // sortedKey → conversation id
  for (const c of conversations) {
    if (c.kind !== 'roundtable' || c.messageCount === 0) continue;
    const k = sortedKey(c.participants);
    if (!latestByLineup.has(k)) latestByLineup.set(k, c.id);
  }

  const groups: RailGroup[] = groupsRaw.map((g) => ({
    id: g.id,
    name: g.name,
    personas: g.personas,
    personaDisplayNames: g.personas.map(
      (u) => personaByUsername.get(u)?.displayName ?? u,
    ),
    accent: g.personas[0] ? personaStyle(g.personas[0]).color : '#2e6bf6',
    // Latest conversation id with this group's lineup (if any). The rail's
    // client picks this up to route to /compare?...&conversation=<id>.
    latestConversationId: latestByLineup.get(sortedKey(g.personas)),
  }));

  // Map sorted-persona-set → saved group, so a roundtable conversation that
  // matches a saved group can render with the group's name + ID for routing.
  const groupBySortedKey = new Map(
    groupsRaw.map((g) => [[...g.personas].sort().join(','), g]),
  );

  // Dedupe roundtables by lineup unconditionally — only the latest
  // conversation per unique participant set surfaces in the rail's Recent
  // section, whether the lineup matches a saved group or not. The earlier
  // group-only gating let identical-lineup ad-hoc roundtables slip through
  // when they didn't match anything in the Groups list.
  // listConversations() is sorted by updatedAt desc, so the first row seen
  // for a given lineup is the most recent one.
  const seenLatestForLineup = new Set<string>();
  const recent: RailConv[] = conversations
    .filter((c) => c.messageCount > 0)
    .map((c): RailConv | null => {
      if (c.kind === 'solo') {
        const persona = c.participants[0];
        if (!persona) return null;
        const p = personaByUsername.get(persona);
        if (!p) return null;
        return {
          kind: 'solo',
          key: c.id,
          displayName: p.displayName,
          members: [persona],
          messageCount: c.messageCount,
          updatedAt: c.updatedAt,
          accent: personaStyle(persona).color,
        };
      }
      // Roundtable. Skip if every active member has been deleted.
      const resolved = c.participants
        .map((u) => personaByUsername.get(u))
        .filter((p): p is PersonaLite => Boolean(p));
      if (resolved.length === 0) return null;
      const lineupKey = [...c.participants].sort().join(',');
      if (seenLatestForLineup.has(lineupKey)) return null;
      seenLatestForLineup.add(lineupKey);
      const matchedGroup = groupBySortedKey.get(lineupKey);
      return {
        kind: matchedGroup ? 'group' : 'roundtable',
        key: c.id,
        displayName:
          matchedGroup?.name ?? resolved.map((p) => p.displayName).join(', '),
        members: c.participants,
        memberDisplayNames: c.participants.map(
          (u) => personaByUsername.get(u)?.displayName ?? u,
        ),
        groupId: matchedGroup?.id,
        messageCount: c.messageCount,
        updatedAt: c.updatedAt,
        accent: personaStyle(c.participants[0]!).color,
      };
    })
    .filter((c): c is RailConv => Boolean(c));

  return (
    <ChatRailClient
      personas={personas.map((p) => ({
        ...p,
        accent: personaStyle(p.username).color,
      }))}
      groups={groups}
      recent={recent}
    />
  );
}
