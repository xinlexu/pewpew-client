import type { PewPewRouteSelection } from './pewpew-client'

export async function applyRouteSelection(
  path: PewPewRouteSelection[],
  select: (group: string, proxy: string) => Promise<unknown>,
) {
  const applied: PewPewRouteSelection[] = []
  try {
    // Configure child selectors before making the parent use them.
    for (const step of [...path].reverse()) {
      if (step.proxyName === step.previousProxy) continue
      await select(step.groupName, step.proxyName)
      applied.push(step)
    }
  } catch (error) {
    for (const step of applied.reverse()) {
      if (step.previousProxy) {
        await select(step.groupName, step.previousProxy).catch(() => undefined)
      }
    }
    throw error
  }
}
