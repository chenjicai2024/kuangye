import { createRequire } from 'node:module'
import { getErrorMessage } from '../error-utils'

type RobotModule = typeof import('@hurdlegroup/robotjs')
const runtimeRequire = createRequire(import.meta.url)

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
export const randomDelayIn = (min: number, max: number): Promise<void> =>
  delay(min + Math.random() * (max - min))

export function getRobot(): RobotModule | null {
  try {
    // We use runtime require to prevent Vite/Webpack from attempting to eagerly bundle
    // native C++ add-ons which can cause build failures or crash the main process on load.
    return runtimeRequire('@hurdlegroup/robotjs') as RobotModule
  } catch (error: unknown) {
    console.error(
      'Failed to load @hurdlegroup/robotjs. Core RPA functions will not work.',
      getErrorMessage(error)
    )
    return null
  }
}
