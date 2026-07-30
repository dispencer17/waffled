import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PersonModal } from './PersonModal'

// The member color picker: the classic 8 swatches PLUS a free custom color —
// picking either lands in the POST /api/persons payload as colorHex.

function mockCreate(calls: Array<Record<string, unknown>>) {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (String(url).includes('/api/persons') && init?.method === 'POST') {
      calls.push(JSON.parse(String(init.body)))
      return { ok: true, json: async () => ({ person: { id: 'p9' } }) }
    }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
}

describe('PersonModal colors', () => {
  it('creates a person with a preset swatch color', async () => {
    const calls: Array<Record<string, unknown>> = []
    mockCreate(calls)
    render(<PersonModal person={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Wally'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'color #E0A500' }))
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ name: 'Ada', colorHex: '#E0A500' })
  })

  it('creates a person with a custom (non-preset) color', async () => {
    const calls: Array<Record<string, unknown>> = []
    mockCreate(calls)
    render(<PersonModal person={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Wally'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Pick a custom color'), { target: { value: '#4b0082' } })
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ name: 'Ada', colorHex: '#4b0082' })
  })
})
