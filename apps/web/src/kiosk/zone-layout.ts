// fork — Pure zone-tree layout helpers for the Today board (FancyZones-style).
// A layout is a recursive split-tree: leaves hold ordered card stacks, splits
// divide space in a direction with per-child flex ratios. Zone identity is the
// pre-order child-index path ('' = root, '1.0' = root.children[1].children[0]),
// stamped on the DOM as data-region. A card lives in exactly one leaf.
// Shared by Customize mode and live drag; the server mirrors the shape and
// clamps in apps/api/src/modules/layout/today-layout.ts — keep them in sync.

export type ZoneLeaf = { cards: string[]; size?: number }
export type ZoneSplit = { dir: 'row' | 'col'; size?: number; children: ZoneNode[] }
export type ZoneNode = ZoneLeaf | ZoneSplit
export type ZonePath = string

// Flex-ratio clamps and structure caps — mirrored on the server.
export const SIZE_MIN = 0.25
export const SIZE_MAX = 4
export const MAX_LEAVES = 12
export const MAX_DEPTH = 4

export function isLeaf(n: ZoneNode): n is ZoneLeaf {
  return 'cards' in n
}

export const clampSize = (v: number): number => Math.min(SIZE_MAX, Math.max(SIZE_MIN, v))

function clone(node: ZoneNode): ZoneNode {
  if (isLeaf(node)) return { ...node, cards: [...node.cards] }
  return { ...node, children: node.children.map(clone) }
}

const parsePath = (path: ZonePath): number[] => (path === '' ? [] : path.split('.').map(Number))

export function getNode(root: ZoneNode, path: ZonePath): ZoneNode | null {
  let node: ZoneNode = root
  for (const i of parsePath(path)) {
    if (isLeaf(node) || !node.children[i]) return null
    node = node.children[i]
  }
  return node
}

/** All leaves, pre-order, with their paths. */
export function listLeaves(root: ZoneNode): { path: ZonePath; leaf: ZoneLeaf }[] {
  const out: { path: ZonePath; leaf: ZoneLeaf }[] = []
  const walk = (node: ZoneNode, path: string) => {
    if (isLeaf(node)) out.push({ path, leaf: node })
    else node.children.forEach((c, i) => walk(c, path ? `${path}.${i}` : String(i)))
  }
  walk(root, '')
  return out
}

/**
 * Split the leaf at `path`: if its parent already splits in `dir`, insert an
 * empty sibling right after it (both sharing the leaf's former space);
 * otherwise wrap the leaf in a new 2-child split, halving nothing — the two
 * children split the wrapper evenly.
 */
export function splitZone(root: ZoneNode, path: ZonePath, dir: 'row' | 'col'): ZoneNode {
  const next = clone(root)
  const target = getNode(next, path)
  if (!target || !isLeaf(target)) return root
  const idxs = parsePath(path)
  const parent = idxs.length ? getNode(next, idxs.slice(0, -1).join('.')) : null
  if (parent && !isLeaf(parent) && parent.dir === dir) {
    const i = idxs[idxs.length - 1]
    const half = (target.size ?? 1) / 2
    target.size = half
    parent.children.splice(i + 1, 0, { cards: [], size: half })
    return next
  }
  // Wrap: the leaf keeps its footprint; inside, old cards and the new empty
  // zone split it evenly.
  const wrapper: ZoneSplit = {
    dir,
    size: target.size ?? 1,
    children: [{ cards: [...target.cards], size: 1 }, { cards: [], size: 1 }],
  }
  if (idxs.length === 0) return wrapper
  const p = getNode(next, idxs.slice(0, -1).join('.')) as ZoneSplit
  p.children[idxs[idxs.length - 1]] = wrapper
  return next
}

/** Collapse single-child splits (the child inherits the outer size). */
function collapse(node: ZoneNode): ZoneNode {
  if (isLeaf(node)) return node
  const children = node.children.map(collapse)
  if (children.length === 1) return { ...children[0], size: node.size ?? children[0].size }
  return { ...node, children }
}

/**
 * Delete the leaf at `path`, merging its cards into the previous sibling's
 * first leaf (next sibling when it's the first child). Refuses to delete the
 * last remaining leaf.
 */
export function deleteZone(root: ZoneNode, path: ZonePath): ZoneNode {
  if (listLeaves(root).length <= 1) return root
  const next = clone(root)
  const target = getNode(next, path)
  const idxs = parsePath(path)
  if (!target || !isLeaf(target) || idxs.length === 0) return root
  const parent = getNode(next, idxs.slice(0, -1).join('.'))
  if (!parent || isLeaf(parent)) return root
  const i = idxs[idxs.length - 1]
  const sibling = parent.children[i - 1] ?? parent.children[i + 1]
  if (!sibling) return root
  const firstLeafOf = (n: ZoneNode): ZoneLeaf => (isLeaf(n) ? n : firstLeafOf(n.children[0]))
  const heir = firstLeafOf(sibling)
  // Deleting the first child puts its cards ahead of the heir's? No — the heir
  // keeps priority when it precedes the deleted zone; when the heir follows
  // (deleting the first child), the deleted cards prepend so their board
  // position stays roughly stable.
  if (parent.children[i - 1]) heir.cards = [...heir.cards, ...target.cards]
  else heir.cards = [...target.cards, ...heir.cards]
  parent.children.splice(i, 1)
  return collapse(next)
}

/** Shift the flex ratio between siblings i and i+1 of the split at parentPath. */
export function resizeSiblings(root: ZoneNode, parentPath: ZonePath, i: number, delta: number): ZoneNode {
  const next = clone(root)
  const parent = getNode(next, parentPath)
  if (!parent || isLeaf(parent)) return root
  const a = parent.children[i]
  const b = parent.children[i + 1]
  if (!a || !b) return root
  a.size = clampSize((a.size ?? 1) + delta)
  b.size = clampSize((b.size ?? 1) - delta)
  return next
}

export function removeCardEverywhere(root: ZoneNode, card: string): ZoneNode {
  const next = clone(root)
  for (const { leaf } of listLeaves(next)) leaf.cards = leaf.cards.filter((c) => c !== card)
  return next
}

/**
 * Move a card into the leaf at `path` at `index`. Indices are relative to the
 * tree WITHOUT the card (the board renders the dragged card as a no-data-card
 * placeholder, so dropTargetAt's indices map straight in). Unknown/non-leaf
 * paths fall back to the last leaf.
 */
export function insertAtZone(root: ZoneNode, card: string, path: ZonePath, index: number): ZoneNode {
  const next = removeCardEverywhere(root, card)
  const node = getNode(next, path)
  const leaves = listLeaves(next)
  const leaf = node && isLeaf(node) ? node : leaves[leaves.length - 1]?.leaf
  if (!leaf) return root
  leaf.cards.splice(index, 0, card)
  return next
}

/** Append a card to the preferred leaf, else the one with the fewest cards. */
export function appendCard(root: ZoneNode, card: string, preferPath?: ZonePath): ZoneNode {
  const next = clone(root)
  const leaves = listLeaves(next)
  if (leaves.length === 0) return root
  let target = preferPath != null ? leaves.find((l) => l.path === preferPath) : undefined
  if (!target) {
    target = leaves[0]
    for (const l of leaves) if (l.leaf.cards.length < target.leaf.cards.length) target = l
  }
  target.leaf.cards.push(card)
  return next
}

const placed = (root: ZoneNode, card: string): boolean => listLeaves(root).some((l) => l.leaf.cards.includes(card))

/**
 * Reconcile an optional module's card with the layout: drop it when the module
 * is off or the user hid it; inject it (preferred/emptiest leaf) when it's on,
 * not hidden, and not already placed. `hidden` wins — a card the user
 * explicitly hid never auto-reappears just because its module is on.
 */
export function applyModuleCard(root: ZoneNode, card: string, show: boolean, hidden: string[], preferPath?: ZonePath): ZoneNode {
  const present = placed(root, card)
  if (hidden.includes(card)) return present ? removeCardEverywhere(root, card) : root
  if (show && !present) return appendCard(root, card, preferPath)
  if (!show && present) return removeCardEverywhere(root, card)
  return root
}

/** Strip a default-layout card when its module is off, but never inject. */
export function hideModuleCard(root: ZoneNode, card: string, show: boolean): ZoneNode {
  return show ? root : removeCardEverywhere(root, card)
}

/**
 * Which zone (by path) + insertion index is under the pointer, read from the
 * live DOM (leaves carry data-region=path, cards data-card). Cards stack
 * vertically inside a leaf, so the y-midpoint test decides the index; the
 * x-axis is resolved for free because each leaf is its own DOM element.
 */
export function dropTargetAt(x: number, y: number): { path: ZonePath; index: number } | null {
  const el = document.elementFromPoint(x, y)
  const zoneEl = el && (el as Element).closest('[data-region]')
  if (!zoneEl) return null
  const path = zoneEl.getAttribute('data-region') ?? ''
  const cards = [...zoneEl.querySelectorAll('[data-card]')]
  let index = cards.length
  for (let k = 0; k < cards.length; k++) {
    const r = cards[k].getBoundingClientRect()
    if (y < r.top + r.height / 2) {
      index = k
      break
    }
  }
  return { path, index }
}
