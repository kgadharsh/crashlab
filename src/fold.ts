// Folding side panels: in each tab, panels fold down to their heading and only one is open at a time, so the side
// column stays short. A panel marked data-fixed (the one with the tab's main button, or a result) never folds.
// The open panel of each tab is remembered in this browser, and reveal() opens the panel holding an element
// whenever the game needs the player to see it (a race starts, a sign-in comes back, a name is needed).
const KEY = 'crashlab.fold'

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}
function save(tab: string, index: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), [tab]: index }))
  } catch {
    /* storage blocked: the choice lasts this visit */
  }
}

const foldable = (tab: HTMLElement) => [...tab.querySelectorAll<HTMLElement>(':scope > .panel')].filter((p) => p.querySelector(':scope > h2') && !p.hasAttribute('data-fixed'))

function setOpen(panel: HTMLElement, open: boolean) {
  panel.classList.toggle('folded', !open)
  panel.querySelector(':scope > h2')!.setAttribute('aria-expanded', String(open))
}

// Open one panel of a tab and fold the rest (index -1 folds them all)
function openIndex(tab: HTMLElement, index: number) {
  foldable(tab).forEach((p, i) => setOpen(p, i === index))
}

// A panel's name, from its heading without the step number or the note on the right
const titleOf = (panel: HTMLElement) => {
  const h2 = panel.querySelector(':scope > h2')!.cloneNode(true) as HTMLElement
  h2.querySelectorAll('.n, .aside').forEach((e) => e.remove())
  return h2.textContent!.trim()
}

// steps: tabs whose panels are steps in order, so each one ends with a button that opens the next
export function setupFolds(tabIds: string[], steps: string[] = []) {
  const saved = load()
  for (const id of tabIds) {
    const tab = document.getElementById(id)!
    const panels = foldable(tab)
    if (steps.includes(id)) {
      panels.slice(0, -1).forEach((panel, i) => {
        const next = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small primary', textContent: 'Next: ' + titleOf(panels[i + 1]) + ' →' })
        next.addEventListener('click', () => {
          openIndex(tab, i + 1)
          save(id, i + 1)
          panels[i + 1].scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
        const row = Object.assign(document.createElement('div'), { className: 'actions next' })
        row.append(next)
        panel.append(row)
      })
    }
    panels.forEach((panel, i) => {
      panel.classList.add('fold')
      const h2 = panel.querySelector<HTMLElement>(':scope > h2')!
      h2.tabIndex = 0
      h2.setAttribute('role', 'button')
      const toggle = () => {
        const open = panel.classList.contains('folded')
        openIndex(tab, open ? i : -1)
        save(id, open ? i : -1)
      }
      h2.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button, input, select, a')) return // buttons in a heading do their own thing
        toggle()
      })
      h2.addEventListener('keydown', (e) => {
        if (e.target !== h2 || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        toggle()
      })
    })
    const start = saved[id]
    openIndex(tab, typeof start === 'number' && start < panels.length ? start : 0)
  }
}

// Open the panel holding this element (folding the others in its tab), so the player can see it
export function reveal(el: HTMLElement) {
  const panel = el.closest<HTMLElement>('.panel.fold')
  if (!panel || !panel.classList.contains('folded')) return
  const tab = panel.parentElement!
  const i = foldable(tab).indexOf(panel)
  openIndex(tab, i)
  if (tab.id) save(tab.id, i)
}
