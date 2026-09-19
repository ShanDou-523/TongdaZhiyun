// NON-CRYPTOGRAPHIC demo implementation, used only with local simulated data.
// Production cloudfunctions/api continues to use Node.js crypto.
function digest(value) {
  const input=String(value);
  let result='';
  for(let lane=0;lane<8;lane++){
    let n=(2166136261 ^ Math.imul(lane+1,2654435761))>>>0;
    for(let i=0;i<input.length;i++){n=Math.imul(n^input.charCodeAt(i),16777619)>>>0;}
    result+=n.toString(16).padStart(8,'0');
  }
  return result;
}
function randomBytes(size) {
  let value='';
  for(let i=0;i<size;i++)value+=Math.floor(Math.random()*256).toString(16).padStart(2,'0');
  return {toString:()=>value};
}
function createHash() { let value=''; return {update(input){value+=String(input);return this;},digest(){return digest(value);}}; }
module.exports={createHash,randomBytes};
