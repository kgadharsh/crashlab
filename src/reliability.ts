import { lapSteps, runBrain } from './sim'
import { DEFAULT_TRACK, makeTrack } from './track'
import { trainWithHistory } from './train'
import { genomeToBrain } from './genome'
const [from,to]=[+process.argv[2],+process.argv[3]]
const hidden = Array.from({length:40},(_,i)=>makeTrack(5000+i,1))
for (let seed=from; seed<=to; seed++) {
  const t0=Date.now()
  const {winner,history}=trainWithHistory(seed,40,undefined,true)
  const b=genomeToBrain(winner.genome)
  const lap=lapSteps(b,DEFAULT_TRACK)
  const firstLearn = history.findIndex(h=>h.best>=30)
  console.log(JSON.stringify({seed,gens:history.length,cp:winner.checkpoints,lap:lap===null?null:lap/60,unseen:hidden.filter(t=>lapSteps(b,t)!==null).length,firstLearn:firstLearn<0?null:firstLearn+1,secs:(Date.now()-t0)/1000}))
}