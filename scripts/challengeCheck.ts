// Checks challenge links: a car survives the trip through a link exactly, and anything damaged,
// oversized or tampered with is refused with a reason. Usage: npx tsx scripts/challengeCheck.ts
import { carFromChallenge, challengeCode } from '../src/challenge'
import { carToJson, type CarFile } from '../src/carFile'
import { DEFAULT_BUILD, genomeLength, shapeOf } from '../src/setup'
import { makeRng } from '../src/random'

const rng = makeRng(3)
const wide = { ...DEFAULT_BUILD, sensors: { count: 9, spread: 180 } }
let failures = 0
const check = (name: string, ok: boolean) => {
  if (!ok) failures++
  console.log((ok ? 'ok   ' : 'FAIL ') + name)
}
const carWith = (build = DEFAULT_BUILD, name = 'Team Crash'): CarFile => ({
  name,
  build,
  genome: Array.from({ length: genomeLength(shapeOf(build.sensors)) }, () => rng() * 4 - 2),
})
const isCar = (x: unknown): x is CarFile => !!x && typeof x === 'object' && 'genome' in (x as object)

for (const car of [carWith(), carWith(wide, 'Wide Ünïcode ✓ car')]) {
  const code = challengeCode(car)
  const back = carFromChallenge(code)
  check('round trip keeps every weight exactly (' + car.build.sensors.count + ' rays, ' + code.length + ' characters)', isCar(back) && carToJson(back) === carToJson(car))
  check('the link is only characters that are safe in an address', /^#challenge=[A-Za-z0-9_-]+$/.test(code))
}
const good = challengeCode(carWith())
check('an address without a challenge is not one', carFromChallenge('') === null && carFromChallenge('#other=1') === null)
check('empty code is refused', 'error' in (carFromChallenge('#challenge=') as object))
const notACar = carFromChallenge('#challenge=AAAAnotacar')
check('a link that is not a car says "link", never "file"', !!notACar && 'error' in notACar && notACar.error === 'That challenge link is damaged.')
check('not base64 is refused', 'error' in (carFromChallenge('#challenge=!!!') as object))
check('half a car is refused', 'error' in (carFromChallenge(good.slice(0, 60)) as object))
check('an oversized link is refused', 'error' in (carFromChallenge('#challenge=' + 'A'.repeat(13000)) as object))
const tampered = JSON.parse(carToJson(carWith()))
tampered.genome[3] = 1e9
const tamperedCode = '#challenge=' + btoa(JSON.stringify(tampered)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
check('a silly weight is refused', 'error' in (carFromChallenge(tamperedCode) as object))
const wrongSize = JSON.parse(carToJson(carWith()))
wrongSize.genome.pop()
check('the wrong number of weights is refused', 'error' in (carFromChallenge('#challenge=' + btoa(JSON.stringify(wrongSize)).replace(/=+$/, '')) as object))
const hostile = JSON.parse(carToJson(carWith()))
hostile.name = '<img src=x onerror=alert(1)>' + 'x'.repeat(100)
const back = carFromChallenge('#challenge=' + btoa(JSON.stringify(hostile)).replace(/=+$/, ''))
check('a long hostile name is cut to 40 characters (it is shown as plain text)', isCar(back) && back.name.length === 40)
console.log(failures ? failures + ' failed' : 'all passed')
process.exit(failures ? 1 : 0)
