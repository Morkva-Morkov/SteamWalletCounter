const NAME='steam-wallet-counter-v2';
function connect(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open(NAME,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('snapshots',{keyPath:'accountId'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function operation(mode,callback){const db=await connect();return new Promise((resolve,reject)=>{
  const tx=db.transaction('snapshots',mode),store=tx.objectStore('snapshots');
  let result;const request=callback(store);
  request.onsuccess=()=>{result=request.result;};
  tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error);};
});}
export const getSnapshot=id=>operation('readonly',s=>s.get(id));
export const saveSnapshot=data=>operation('readwrite',s=>s.put(data));
export const getSnapshots=()=>operation('readonly',s=>s.getAll());
export const deleteSnapshot=id=>operation('readwrite',s=>s.delete(id));
