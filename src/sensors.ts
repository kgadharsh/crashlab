export type Point = { x: number; y: number }
export type Segment = { a: Point; b: Point }

// Shoot a ray from (ox, oy) in the given direction.
// Returns how far it travels before hitting a wall (or maxRange if it hits nothing).
// The walls come as flat numbers, four per wall: where it starts (x, y) and its length along
// x and y. That is the same maths as reading each wall's two end points, just quicker.
export function castRay(
  ox: number,
  oy: number,
  angle: number,
  maxRange: number,
  walls: Float64Array,
): number {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let nearest = maxRange

  for (let k = 0; k < walls.length; k += 4) {
    const ex = walls[k + 2]
    const ey = walls[k + 3]
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-9) continue // ray runs parallel to this wall

    const ax = walls[k] - ox
    const ay = walls[k + 1] - oy
    const t = (ax * ey - ay * ex) / denom // how far along the ray
    const u = (ax * dy - ay * dx) / denom // how far along the wall segment

    if (t >= 0 && t < nearest && u >= 0 && u <= 1) nearest = t
  }
  return nearest
}
