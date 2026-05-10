import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { anthropicToolDefinitions, dispatchStatsTool, statsTools } from '@/lib/stats-tools';
import { getTrackedPlayers } from '@/lib/player-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ClientMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ToolCallRecord = {
  name: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

function sse(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function cleanHistory(history: unknown): ClientMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (message): message is ClientMessage =>
        Boolean(message) &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string'
    )
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 2000) }));
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (block && typeof block === 'object' && 'type' in block && block.type === 'text' && 'text' in block) {
        return String(block.text);
      }
      return '';
    })
    .join('');
}

async function buildSystemPrompt(timezone: string): Promise<string> {
  const players = await getTrackedPlayers();
  const roster = players.map((player) => `${player.displayName} => ${player.name} (${player.platform})`).join('\n');
  const toolList = statsTools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `You answer natural-language Battlefield 6 RedSec stat questions for a small friend tracker.

Today's date in the user's timezone (${timezone}) is ${today}.

Tracked roster. Resolve display names to canonical names before calling tools:
${roster}

Available deterministic tools:
${toolList}

Rules:
- Claude only routes and explains. Numeric claims must come from tool results.
- Never write SQL, invent fields, or imply direct database access.
- If the user says "I", "me", or "my" without naming a tracked player, ask which player they mean.
- If no tool fits, say what is missing from the available data.
- For roster-wide questions like "everyone", "all players", "the whole roster", or "who has the most/lowest", call compare_players with all_players true instead of manually listing players.
- If a named player is ambiguous or missing, ask a clarifying question. Never silently exclude a requested player from the answer.
- For last-N-match leaderboard/ranking answers, only ranked players with at least N included matches are returned. If included_matches is higher than requested_matches, explain that stored event rows can contain multiple matches and the tool includes complete rows rather than splitting partial rows.
- Prefer the most focused tool. Use top_matches for best/worst single-game questions, not broad match_history.
- Use stat_trend for "over time", "trend", "by day/week/month", "graph my K/D", or "how has X changed" questions.
- Use compare_squadmates for "who do I play best/worst with", "best teammate", or teammate ranking questions. Use squadmate_stats for one named pair.
- Use weapon_usage for player weapon usage questions from tracked match data, such as "my top LMGs", "who has the most SCW-10 kills", or "weapon damage in April".
- For weapon questions, use compare_weapons for named weapon TTK/stat comparisons, recommend_weapon_build for attachments on one named weapon, rank_weapons for best weapon/category/metric questions, and weapon_details for damage profiles or available attachment slots.
- For weapon build answers, distinguish mathematical TTK from practical build value. Do not say an attachment improves TTK unless ttk_delta/tool result shows the build actually lowers TTK; otherwise say it improves handling, hipfire, sustain, control, reload, magazine capacity, or practical usability.
- For "fastest TTK at 20m" style category questions, use rank_weapons with metric "ttk" and distance_m.
- When a tool result includes local_time, use local_time in the answer rather than interpreting raw ISO dates yourself.
- For weapon ratings such as control, mobility, hipfire, precision, and bullet_velocity, higher is better. For TTK, ADS, and reload, lower is better.
- Use canonical weapon/player names from tool result rows in the answer, even if the user typed an alias or typo.
- Keep answers to one or two short plain sentences.
- Do not use Markdown formatting, bullets, numbered lists, or Markdown tables in the prose answer; the UI renders structured tool results below.
- Always cite which tool and parameters you used in the answer.`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const timezone = typeof body.timezone === 'string' && body.timezone ? body.timezone : 'America/Los_Angeles';

  if (!message) {
    return new Response('Missing message', { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('ANTHROPIC_API_KEY is not configured', { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt(timezone);
  const tools = anthropicToolDefinitions();
  const history = cleanHistory(body.history);
  const toolCalls: ToolCallRecord[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const messages: Anthropic.Messages.MessageParam[] = [
          ...history.map((entry) => ({ role: entry.role, content: entry.content })),
          { role: 'user', content: message },
        ];

        for (let i = 0; i < 5; i++) {
          const anthropicStream = client.messages.stream({
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
            max_tokens: 1200,
            system: [{ type: 'text', text: await system, cache_control: { type: 'ephemeral' } }],
            messages,
            tools,
            cache_control: { type: 'ephemeral' },
          });

          let text = '';
          anthropicStream.on('text', (delta) => {
            text += delta;
          });

          const response = await anthropicStream.finalMessage();
          console.log('[ask] token usage', response.usage);
          const toolUses = response.content.filter((block) => block.type === 'tool_use');

          if (toolUses.length === 0) {
            if (!text) text = contentText(response.content);
            controller.enqueue(sse({ type: 'delta', text }));
            controller.enqueue(sse({ type: 'done', toolCalls }));
            controller.close();
            return;
          }

          messages.push({ role: 'assistant', content: response.content });

          const resultBlocks: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const toolUse of toolUses) {
            const input =
              toolUse.input && typeof toolUse.input === 'object'
                ? (toolUse.input as Record<string, unknown>)
                : {};
            const result = await dispatchStatsTool(toolUse.name, input, { timezone });
            toolCalls.push({ name: toolUse.name, input, result });
            resultBlocks.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          }

          messages.push({ role: 'user', content: resultBlocks });
        }

        controller.enqueue(
          sse({
            type: 'delta',
            text: 'I stopped after 5 stat queries to avoid looping. Try narrowing the question.',
          })
        );
        controller.enqueue(sse({ type: 'done', toolCalls }));
        controller.close();
      } catch (error) {
        controller.enqueue(
          sse({
            type: 'error',
            error: error instanceof Error ? error.message : 'Ask failed',
          })
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
