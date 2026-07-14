// Voice assistant (fork) — turn a transcript into an action. Classification
// runs through the household LLM (completeJson) with a regex fallback, then
// simple intents execute server-side: grocery items are added directly, smart
// home commands resolve against the PINNED Home Assistant entities only, and
// questions get a short spoken answer built from today's household context.
// Anything else bounces back as 'capture' so the kiosk's existing capture bar
// (visual preview + commit) handles it.
import { query } from '../../platform/db'
import { completeJson, getAiConfig } from '../../platform/llm'
import { moduleEnabled } from '../../platform/modules'
import { getOrCreateGroceryList, addItem } from '../lists/lists.service'
import { listEntities, callService } from '../homeassistant/homeassistant.service'
import { actionForDomain } from './voice.ha'
import type { Tenant } from '../households/households'
import type { VoiceAction } from './voice.types'

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['timer', 'grocery', 'smarthome', 'question', 'other'] },
    timerSeconds: { type: 'integer', description: 'timer length in seconds (timer only)' },
    timerLabel: { type: 'string', description: "short label like 'pasta' (timer only)" },
    groceryItems: { type: 'array', items: { type: 'string' }, description: 'items to add (grocery only)' },
    deviceName: { type: 'string', description: 'the device/scene being controlled (smarthome only)' },
    deviceAction: { type: 'string', enum: ['turn_on', 'turn_off', 'toggle'], description: 'smarthome only' },
  },
  required: ['kind'],
} as const

interface Classified {
  kind: 'timer' | 'grocery' | 'smarthome' | 'question' | 'other'
  timerSeconds?: number
  timerLabel?: string
  groceryItems?: string[]
  deviceName?: string
  deviceAction?: 'turn_on' | 'turn_off' | 'toggle'
}

// No-LLM fallback: cover the highest-value phrasings with regexes.
export function classifyHeuristic(text: string): Classified {
  const t = text.toLowerCase().trim()
  const timer = /(?:set )?(?:a )?timer (?:for )?(\d+)\s*(hour|hr|minute|min|second|sec)/.exec(t)
  if (timer) {
    const n = parseInt(timer[1], 10)
    const unit = timer[2].startsWith('h') ? 3600 : timer[2].startsWith('m') ? 60 : 1
    return { kind: 'timer', timerSeconds: n * unit, timerLabel: 'Timer' }
  }
  const grocery = /add (.+?) to (?:the |my )?(?:grocery|shopping) list/.exec(t)
  if (grocery) {
    return { kind: 'grocery', groceryItems: grocery[1].split(/,| and /).map((s) => s.trim()).filter(Boolean) }
  }
  const ha = /turn (on|off) (?:the )?(.+)/.exec(t)
  if (ha) return { kind: 'smarthome', deviceName: ha[2].trim(), deviceAction: ha[1] === 'on' ? 'turn_on' : 'turn_off' }
  if (/^(what|when|who|how|is|are|do|does)\b/.test(t)) return { kind: 'question' }
  return { kind: 'other' }
}

async function classify(householdId: string, transcript: string): Promise<Classified> {
  const { provider } = await getAiConfig(householdId)
  if (provider === 'heuristic') return classifyHeuristic(transcript)
  try {
    const { data } = await completeJson(householdId, {
      system:
        'Classify a spoken kitchen-assistant command. kinds: timer (set a countdown), ' +
        'grocery (add items to the shopping list), smarthome (control a light/switch/scene), ' +
        'question (asks about schedule, meals, family, or general knowledge), ' +
        'other (create events/chores/notes — anything that changes the calendar or tasks).',
      user: transcript,
      schema: CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'voice_command',
      maxTokens: 300,
    })
    return data as Classified
  } catch (err) {
    console.error('voice classify via LLM failed; using heuristic', err)
    return classifyHeuristic(transcript)
  }
}

// Today's context for spoken answers: agenda + tonight's dinner.
async function todayContext(householdId: string): Promise<string> {
  const { rows: hh } = await query<{ timezone: string }>(`select timezone from households where id = $1`, [householdId])
  const tz = hh[0]?.timezone ?? 'UTC'
  const { rows: events } = await query<{ title: string; starts_at: Date; all_day: boolean }>(
    `select title, starts_at, all_day from events
      where household_id = $1 and deleted_at is null and status <> 'cancelled'
        and starts_at >= date_trunc('day', now() at time zone $2) at time zone $2
        and starts_at <  (date_trunc('day', now() at time zone $2) + interval '1 day') at time zone $2
      order by starts_at limit 12`,
    [householdId, tz]
  )
  const { rows: dinner } = await query<{ title: string | null; recipe_title: string | null }>(
    `select e.title, r.title as recipe_title
       from meal_plan_entries e
       join meal_plans p on p.id = e.meal_plan_id and p.household_id = $1
       left join recipes r on r.id = e.recipe_id
      where e.date = (now() at time zone $2)::date and e.meal_type = 'dinner' and e.deleted_at is null
      limit 1`,
    [householdId, tz]
  )
  const agenda = events.map((e) => {
    const time = e.all_day ? 'all day' : new Date(e.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
    return `${e.title} (${time})`
  })
  const lines = [
    `Today's events: ${agenda.length ? agenda.join('; ') : 'none'}.`,
    `Tonight's dinner: ${dinner[0]?.recipe_title ?? dinner[0]?.title ?? 'not planned yet'}.`,
  ]
  return lines.join('\n')
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string', description: 'a short spoken answer, one or two sentences' } },
  required: ['answer'],
} as const

async function answerQuestion(householdId: string, transcript: string): Promise<string> {
  const { provider } = await getAiConfig(householdId)
  if (provider === 'heuristic') return "I can't answer questions without an AI provider configured."
  const context = await todayContext(householdId)
  const { data } = await completeJson(householdId, {
    system:
      'You are the voice of a family kitchen hub. Answer briefly for text-to-speech — one or two ' +
      'short sentences, no lists or markdown. Use the household context when relevant.\n' + context,
    user: transcript,
    schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'voice_answer',
    maxTokens: 300,
  })
  return (data as { answer: string }).answer
}

async function householdSettings(householdId: string): Promise<unknown> {
  const { rows } = await query<{ settings: unknown }>(`select settings from households where id = $1`, [householdId])
  return rows[0]?.settings ?? {}
}

async function runSmartHome(tenant: Tenant, c: Classified): Promise<VoiceAction> {
  const settings = await householdSettings(tenant.householdId)
  if (!moduleEnabled(settings, 'smartHome')) {
    return { kind: 'none', say: 'Smart home control is turned off in Settings.' }
  }
  const name = (c.deviceName ?? '').toLowerCase().trim()
  if (!name) return { kind: 'none', say: "I didn't catch which device you meant." }
  const entities = await listEntities(tenant.householdId).catch(() => [])
  if (!entities.length) return { kind: 'none', say: 'No smart home devices are pinned yet.' }
  // Fuzzy match against the PINNED entities only: exact > contains > token
  // overlap. The overlap needs a 60% ratio so a generic word ("light") can't
  // route "porch light" to "Kitchen Lights".
  const scored = entities
    .map((e) => {
      const n = e.name.toLowerCase()
      const tokens = name.split(/\s+/).filter((w) => w.length > 2)
      const ratio = tokens.length ? tokens.filter((w) => n.includes(w)).length / tokens.length : 0
      const s = n === name ? 3 : n.includes(name) || name.includes(n) ? 2 : ratio >= 0.6 ? 1 : 0
      return { e, s }
    })
    .sort((a, b) => b.s - a.s)
  const best = scored[0]
  if (!best || best.s === 0) return { kind: 'none', say: `I couldn't find a pinned device called ${c.deviceName}.` }
  const action = actionForDomain(best.e.domain, c.deviceAction ?? 'toggle')
  if (!action) return { kind: 'none', say: `${best.e.name} can't be controlled by voice.` }
  await callService(tenant.householdId, action.domain, action.service, best.e.entityId)
  const verb = action.service === 'turn_on' ? 'on' : action.service === 'turn_off' ? 'off' : 'toggled'
  return { kind: 'ha', entityId: best.e.entityId, say: `Okay, ${best.e.name} ${verb === 'toggled' ? 'toggled' : `turned ${verb}`}.` }
}

/** Execute a transcript. Never throws for user-facing failures — it speaks them. */
export async function runCommand(tenant: Tenant, transcript: string): Promise<VoiceAction> {
  const text = transcript.trim()
  if (!text) return { kind: 'none', say: "I didn't hear anything." }
  const c = await classify(tenant.householdId, text)

  switch (c.kind) {
    case 'timer': {
      const seconds = Math.min(Math.max(Math.round(c.timerSeconds ?? 0), 5), 24 * 3600)
      if (!seconds || seconds < 5) return { kind: 'none', say: 'How long should the timer be?' }
      const label = (c.timerLabel ?? 'Timer').slice(0, 40)
      const mins = Math.round(seconds / 60)
      const spoken = seconds < 120 ? `${seconds} seconds` : `${mins} minutes`
      return { kind: 'timer', seconds, label, say: `${label} set for ${spoken}.` }
    }
    case 'grocery': {
      const items = (c.groceryItems ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10)
      if (!items.length) return { kind: 'none', say: "I didn't catch what to add." }
      const settings = await householdSettings(tenant.householdId)
      if (!moduleEnabled(settings, 'lists')) return { kind: 'none', say: 'Lists are turned off in Settings.' }
      const list = await getOrCreateGroceryList(tenant)
      for (const name of items) await addItem(tenant, list.id, { name })
      const say = items.length === 1 ? `Added ${items[0]} to the grocery list.` : `Added ${items.length} items to the grocery list.`
      return { kind: 'grocery', added: items, say }
    }
    case 'smarthome':
      return runSmartHome(tenant, c)
    case 'question': {
      try {
        return { kind: 'query', say: await answerQuestion(tenant.householdId, text) }
      } catch (err) {
        console.error('voice answer failed', err)
        return { kind: 'none', say: "Sorry, I couldn't come up with an answer." }
      }
    }
    default:
      // Calendar/chore/meal mutations get the visual capture flow on the kiosk.
      return { kind: 'capture', transcript: text, say: null }
  }
}
