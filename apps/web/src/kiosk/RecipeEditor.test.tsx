import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { RecipeEditor } from './RecipeEditor'
import { TopbarSlotProvider } from './topbar-slot'

interface Sent { method: string; url: string; body: unknown }

function mockApi(sent: Sent[], parsed?: unknown, suggest?: unknown) {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    sent.push({ method, url: u, body })
    if (u.endsWith('/api/recipes/parse-markdown') && method === 'POST') {
      return { ok: true, json: async () => parsed }
    }
    if (u.endsWith('/api/recipes/suggest-metadata') && method === 'POST') {
      if (!suggest) return { ok: false, status: 501, json: async () => ({}) }
      return { ok: true, json: async () => suggest }
    }
    if (u.endsWith('/api/recipes') && method === 'POST') {
      return { ok: true, json: async () => ({ recipe: { id: 'new-id', title: body.title } }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/meals/recipe/new']}>
      <TopbarSlotProvider>
        <Routes>
          <Route path="/meals/recipe/new" element={<RecipeEditor />} />
          <Route path="/meals/recipe/:id" element={<div>recipe page</div>} />
        </Routes>
      </TopbarSlotProvider>
    </MemoryRouter>,
  )
}

// A minimal recipe detail for edit-mode tests; override fields per test.
function makeDetail(recipe: Record<string, unknown> = {}) {
  return {
    recipe: {
      id: 'r1', title: 'Lentil Soup', emoji: '🍲', servings: 4,
      prepTimeMinutes: 10, cookTimeMinutes: 30,
      cuisine: null, protein: null, mealType: null, base: null, effort: null,
      cookMethod: null, flavorProfile: null, collection: null,
      dietary: [], vegetables: [], tags: [],
      imageUrl: null, storageKey: null,
      notes: null, userNotes: null,
      ...recipe,
    },
    ingredients: [{ id: 'i1', name: 'lentils', amount: 1, unit: 'cup', prepNote: null, section: null }],
    steps: [{ stepNumber: 1, instruction: 'Simmer until tender.', ingredients: [], timerSeconds: null }],
  }
}

function mockEditApi(sent: Sent[], detail: ReturnType<typeof makeDetail>) {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    sent.push({ method, url: u, body })
    if (u.endsWith('/api/recipes/r1') && method === 'GET') {
      return { ok: true, json: async () => detail }
    }
    if (u.endsWith('/api/recipes/r1') && method === 'PATCH') {
      return { ok: true, json: async () => ({ recipe: detail.recipe }) }
    }
    if (u.endsWith('/api/recipes/sections')) {
      return { ok: true, json: async () => ({ sections: [] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={['/edit/r1']}>
      <TopbarSlotProvider>
        <Routes>
          <Route path="/edit/:id" element={<RecipeEditor />} />
          <Route path="/meals/recipe/:id" element={<div>recipe page</div>} />
        </Routes>
      </TopbarSlotProvider>
    </MemoryRouter>,
  )
}

describe('RecipeEditor — edit: recipe notes vs your notes', () => {
  it('prefills recipe notes and your notes into separate fields', async () => {
    const sent: Sent[] = []
    mockEditApi(sent, makeDetail({ notes: 'Soak the lentils overnight.', userNotes: 'Kids love it — double the batch.' }))
    renderEdit()

    await waitFor(() => expect((screen.getByPlaceholderText('Recipe title') as HTMLInputElement).value).toBe('Lentil Soup'))
    expect((screen.getByLabelText('Recipe notes') as HTMLTextAreaElement).value).toBe('Soak the lentils overnight.')
    expect((screen.getByLabelText('Your notes') as HTMLTextAreaElement).value).toBe('Kids love it — double the batch.')
  })

  it('does NOT copy personal notes into the shared notes column on save', async () => {
    // The reported bug: a recipe with ONLY userNotes got them saved into `notes`.
    const sent: Sent[] = []
    mockEditApi(sent, makeDetail({ notes: null, userNotes: 'Use less salt.' }))
    renderEdit()

    await waitFor(() => expect((screen.getByPlaceholderText('Recipe title') as HTMLInputElement).value).toBe('Lentil Soup'))
    fireEvent.click(screen.getByText('Save changes'))

    await waitFor(() => expect(sent.some((s) => s.method === 'PATCH')).toBe(true))
    const b = sent.find((s) => s.method === 'PATCH')!.body as { notes: string | null; userNotes?: string }
    expect(b.notes).toBeNull() // source notes stay untouched
    expect(b.userNotes).toBe('Use less salt.') // personal notes stay personal
  })

  it('saves edits to each notes field into its own column', async () => {
    const sent: Sent[] = []
    mockEditApi(sent, makeDetail({ notes: 'Soak overnight.', userNotes: 'Double the batch.' }))
    renderEdit()

    await waitFor(() => expect((screen.getByPlaceholderText('Recipe title') as HTMLInputElement).value).toBe('Lentil Soup'))
    fireEvent.change(screen.getByLabelText('Recipe notes'), { target: { value: 'Soak overnight, then rinse.' } })
    fireEvent.change(screen.getByLabelText('Your notes'), { target: { value: 'Triple the batch.' } })
    fireEvent.click(screen.getByText('Save changes'))

    await waitFor(() => expect(sent.some((s) => s.method === 'PATCH')).toBe(true))
    const b = sent.find((s) => s.method === 'PATCH')!.body as { notes: string | null; userNotes?: string }
    expect(b.notes).toBe('Soak overnight, then rinse.')
    expect(b.userNotes).toBe('Triple the batch.')
  })
})

describe('RecipeEditor — new', () => {
  it('builds the create payload from the form (title, ingredient, step)', async () => {
    const sent: Sent[] = []
    mockApi(sent)
    renderNew()

    fireEvent.change(screen.getByPlaceholderText('Recipe title'), { target: { value: 'Test Soup' } })
    fireEvent.change(screen.getByPlaceholderText('ingredient'), { target: { value: 'carrots' } })
    fireEvent.change(screen.getByPlaceholderText('2'), { target: { value: '3' } })
    fireEvent.change(screen.getByPlaceholderText('cups'), { target: { value: 'cups' } })
    fireEvent.change(screen.getByPlaceholderText('Describe this step…'), { target: { value: 'Simmer everything.' } })

    // Tag the ingredient onto the step via the popover (no retyping); default amount "3 cups".
    fireEvent.click(screen.getByText('+ Tag ingredient'))
    fireEvent.click(screen.getByLabelText('Tag carrots'))

    fireEvent.click(screen.getByText('Create recipe'))

    await waitFor(() => expect(sent.some((s) => s.url.endsWith('/api/recipes') && s.method === 'POST')).toBe(true))
    const post = sent.find((s) => s.url.endsWith('/api/recipes') && s.method === 'POST')!
    const b = post.body as { title: string; ingredients: { name: string; amount: number }[]; steps: { instruction: string; ingredients: string[] }[] }
    expect(b.title).toBe('Test Soup')
    expect(b.ingredients).toHaveLength(1)
    expect(b.ingredients[0]).toMatchObject({ name: 'carrots', amount: 3 })
    expect(b.steps).toHaveLength(1)
    expect(b.steps[0].instruction).toBe('Simmer everything.')
    expect(b.steps[0].ingredients).toEqual(['3 cups carrots'])
  })

  it('per-step amount can be split (override the chip amount)', async () => {
    const sent: Sent[] = []
    mockApi(sent)
    renderNew()

    fireEvent.change(screen.getByPlaceholderText('Recipe title'), { target: { value: 'Water Test' } })
    fireEvent.change(screen.getByPlaceholderText('ingredient'), { target: { value: 'water' } })
    fireEvent.change(screen.getByPlaceholderText('2'), { target: { value: '2' } })
    fireEvent.change(screen.getByPlaceholderText('cups'), { target: { value: 'cups' } })
    fireEvent.change(screen.getByPlaceholderText('Describe this step…'), { target: { value: 'Add half the water.' } })

    fireEvent.click(screen.getByText('+ Tag ingredient'))
    fireEvent.click(screen.getByLabelText('Tag water'))
    // override the prefilled "2 cups" down to "1 cup" for this step (in the popover)
    fireEvent.change(screen.getByLabelText('Amount of water'), { target: { value: '1 cup' } })

    fireEvent.click(screen.getByText('Create recipe'))
    await waitFor(() => expect(sent.some((s) => s.url.endsWith('/api/recipes') && s.method === 'POST')).toBe(true))
    const b = sent.find((s) => s.url.endsWith('/api/recipes') && s.method === 'POST')!.body as { steps: { ingredients: string[] }[] }
    expect(b.steps[0].ingredients).toEqual(['1 cup water'])
  })

  it('quiet AI suggestion fills empty fields only and merges arrays', async () => {
    const sent: Sent[] = []
    mockApi(sent, undefined, {
      suggestion: {
        cuisine: 'Italian', mealType: 'dinner', protein: 'chicken', base: 'pasta',
        effort: null, cookMethod: 'stovetop', flavorProfile: null,
        dietary: ['gluten-free'], vegetables: ['spinach'], tags: ['quick'],
      },
      via: 'test',
    })
    renderNew()

    fireEvent.change(screen.getByPlaceholderText('Recipe title'), { target: { value: 'Spaghetti' } })
    fireEvent.change(screen.getByPlaceholderText('ingredient'), { target: { value: 'noodles' } })
    // pre-fill protein so we can prove it is NOT overwritten
    fireEvent.change(screen.getByPlaceholderText('chicken, beef, tofu…'), { target: { value: 'beef' } })

    // suggestions surface after the debounced background call; Keep all applies them
    const keepAll = await screen.findByText('Keep all', {}, { timeout: 4000 })
    fireEvent.click(keepAll)

    expect((screen.getByPlaceholderText('Italian, Thai…') as HTMLInputElement).value).toBe('Italian') // empty → filled
    expect((screen.getByPlaceholderText('chicken, beef, tofu…') as HTMLInputElement).value).toBe('beef') // yours → kept
    expect(screen.getByText('spinach')).toBeTruthy() // vegetable chip merged in
    expect(screen.getByText('gluten-free')).toBeTruthy()
  })

  it('accepts a single inline suggestion via ✓ without applying the others', async () => {
    const sent: Sent[] = []
    mockApi(sent, undefined, {
      suggestion: {
        cuisine: 'Italian', mealType: null, protein: null, base: 'pasta',
        effort: null, cookMethod: null, flavorProfile: null,
        dietary: [], vegetables: [], tags: [],
      },
      via: 'test',
    })
    renderNew()
    fireEvent.change(screen.getByPlaceholderText('Recipe title'), { target: { value: 'Spaghetti' } })
    fireEvent.change(screen.getByPlaceholderText('ingredient'), { target: { value: 'noodles' } })

    await screen.findByLabelText('Use Italian', {}, { timeout: 4000 })
    fireEvent.click(screen.getByLabelText('Use Italian'))

    expect(screen.getByDisplayValue('Italian')).toBeTruthy() // cuisine accepted
    expect(screen.getByPlaceholderText('✨ pasta')).toBeTruthy() // base suggestion still pending
  })

  it('paste → parse prefills the form', async () => {
    const sent: Sent[] = []
    mockApi(sent, {
      recipe: { title: 'Parsed Dish', emoji: '🍲', servings: 2, tags: [], notes: null, sourceName: null, mealType: 'dinner', protein: null, base: null, cuisine: 'Thai', effort: null, cookMethod: null, flavorProfile: null, dietary: [], vegetables: [] },
      ingredients: [{ name: 'rice', amount: 1, unit: 'cup', prepNote: null, section: null }],
      steps: [{ instruction: 'Cook the rice.', ingredients: [] }],
    })
    renderNew()

    fireEvent.click(screen.getByText('📋 Paste markdown'))
    fireEvent.change(screen.getByPlaceholderText('Paste frontmatter + markdown here…'), { target: { value: '# Parsed Dish' } })
    fireEvent.click(screen.getByText('Parse → fill the form'))

    await waitFor(() => expect((screen.getByPlaceholderText('Recipe title') as HTMLInputElement).value).toBe('Parsed Dish'))
    expect((screen.getByPlaceholderText('ingredient') as HTMLInputElement).value).toBe('rice')
    expect((screen.getByPlaceholderText('Describe this step…') as HTMLTextAreaElement).value).toBe('Cook the rice.')
  })

  it('paste → parse carries a step timer into the timer control', async () => {
    const sent: Sent[] = []
    mockApi(sent, {
      recipe: { title: 'Timed Dish', emoji: '🍲', servings: 2, tags: [], notes: null, sourceName: null, mealType: null, protein: null, base: null, cuisine: null, effort: null, cookMethod: null, flavorProfile: null, dietary: [], vegetables: [] },
      ingredients: [{ name: 'rice', amount: 1, unit: 'cup', prepNote: null, section: null }],
      steps: [{ instruction: 'Cook on the grill for 6 minutes.', ingredients: [], timerSeconds: 360 }],
    })
    renderNew()

    fireEvent.click(screen.getByText('📋 Paste markdown'))
    fireEvent.change(screen.getByPlaceholderText('Paste frontmatter + markdown here…'), { target: { value: '# Timed Dish' } })
    fireEvent.click(screen.getByText('Parse → fill the form'))

    // The parsed timerSeconds should surface as a "6:00" timer pill, not "Add timer".
    await waitFor(() => expect(screen.getByText('6:00')).toBeTruthy())
    expect(screen.queryByText('⏱ Add timer')).toBeNull()
  })
})
