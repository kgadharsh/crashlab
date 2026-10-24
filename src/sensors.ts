export type Point = { x: number; y: number }
export type Segment = { a: Point; b: Point }

// Shoot a ray from (ox, oy) in the given direction.
// Returns how far it travels before hitting a wall (or maxRange if it hits nothing).
export function castRay(
  ox: number,
  oy: number,
  angle: number,
  maxRange: number,
  walls: Segment[],
): number {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let nearest = maxRange

  for (const w of walls) {
    const ex = w.b.x - w.a.x
    const ey = w.b.y - w.a.y
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-9) continue // ray runs parallel to this wall

    const ax = w.a.x - ox
    const ay = w.a.y - oy
    const t = (ax * ey - ay * ex) / denom // how far along the ray
    const u = (ax * dy - ay * dx) / denom // how far along the wall segment

    if (t >= 0 && t < nearest && u >= 0 && u <= 1) nearest = t
  }
  return nearest
}