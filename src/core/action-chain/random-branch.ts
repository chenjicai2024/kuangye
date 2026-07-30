export interface WeightedBranch {
  probabilityWeight?: number
}

export interface WeightedBranchSelection<T extends WeightedBranch> {
  branch: T
  index: number
  weight: number
  totalWeight: number
  probability: number
}

export function normalizedBranchWeight(branch: WeightedBranch): number {
  const weight = branch.probabilityWeight
  if (weight === undefined) return 1
  if (!Number.isFinite(weight)) return 0
  return Math.max(0, weight)
}

export function selectWeightedBranch<T extends WeightedBranch>(
  branches: T[],
  random: () => number = Math.random
): WeightedBranchSelection<T> | null {
  if (branches.length === 0) return null

  const weights = branches.map(normalizedBranchWeight)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) return null

  const sample = Math.min(Math.max(random(), 0), 1 - Number.EPSILON) * totalWeight
  let cumulative = 0
  for (let index = 0; index < branches.length; index++) {
    const weight = weights[index]
    cumulative += weight
    if (sample < cumulative) {
      return {
        branch: branches[index],
        index,
        weight,
        totalWeight,
        probability: weight / totalWeight
      }
    }
  }

  return null
}
