'use client';

import {FormEvent,useCallback,useEffect,useState} from 'react';

type Candidate={
 id:number;
 fragrance_id:number;
 candidate_url:string;
 thumbnail_url:string|null;
 source_page:string;
 license_name:string|null;
 license_url:string|null;
 creator:string|null;
 matched_title:string;
 fragrances:{brand:string;name:string;concentration:string}|null;
};

export default function AdminPhotos(){
 const [authenticated,setAuthenticated]=useState(false);
 const [loading,setLoading]=useState(true);
 const [token,setToken]=useState('');
 const [candidates,setCandidates]=useState<Candidate[]>([]);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [brand,setBrand]=useState('');
 const [name,setName]=useState('');
 const [concentration,setConcentration]=useState('');
 const [family,setFamily]=useState('Other');
 const [notes,setNotes]=useState('');
 const [confirmations,setConfirmations]=useState<Record<number,{edition:boolean;license:boolean}>>({});

 const loadCandidates=useCallback(async()=>{
  setLoading(true);
  try{
   const response=await fetch('/api/admin/photos/candidates');
   if(response.status===401){setAuthenticated(false);setCandidates([]);return}
   const result=await response.json() as {candidates?:Candidate[];error?:string};
   if(!response.ok)throw Error(result.error||'Could not load photo candidates');
   setCandidates(result.candidates||[]);
   setAuthenticated(true);
  }catch(error){
   setMessage(error instanceof Error?error.message:'Could not load photo candidates');
  }finally{setLoading(false)}
 },[]);

 useEffect(()=>{void loadCandidates()},[loadCandidates]);

 async function login(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/admin/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
   const result=await response.json() as {error?:string};
   if(!response.ok)throw Error(result.error||'Sign in failed');
   setToken('');
   await loadCandidates();
  }catch(error){setMessage(error instanceof Error?error.message:'Sign in failed')}
  finally{setBusy(false)}
 }

 async function logout(){
  try{
   const response=await fetch('/api/admin/session',{method:'DELETE'});
   if(!response.ok)throw Error('Sign out failed');
   setAuthenticated(false);setCandidates([]);setMessage('Signed out.');
  }catch(error){setMessage(error instanceof Error?error.message:'Sign out failed')}
 }

 async function processQueue(){
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/admin/photos/process',{method:'POST'});
   const result=await response.json() as {checked?:number;candidates?:number;failures?:number;error?:string};
   if(!response.ok)throw Error(result.error||'Photo discovery failed');
   setMessage(`Processed ${result.checked||0} jobs; found ${result.candidates||0} exact-title candidates; ${result.failures||0} errors.`);
   await loadCandidates();
  }catch(error){setMessage(error instanceof Error?error.message:'Photo discovery failed')}
  finally{setBusy(false)}
 }

 async function importFragrance(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/admin/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{brand,name,concentration,family,notes:notes.split(',').map(note=>note.trim()).filter(Boolean)}]})});
   const result=await response.json() as {imported?:number;queued?:number;error?:string};
   if(!response.ok)throw Error(result.error||'Could not add fragrance');
   setMessage(result.imported?`Fragrance added; ${result.queued||0} photo job queued.`:'This fragrance already exists.');
   setBrand('');setName('');setConcentration('');setFamily('Other');setNotes('');
  }catch(error){setMessage(error instanceof Error?error.message:'Could not add fragrance')}
  finally{setBusy(false)}
 }

 async function review(candidateId:number,action:'approve'|'reject'){
  setBusy(true);setMessage('');
  try{
   const response=await fetch(`/api/admin/photos/${action}`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(action==='approve'?{candidateId,confirmedExactEdition:Boolean(confirmations[candidateId]?.edition),confirmedLicense:Boolean(confirmations[candidateId]?.license)}:{candidateId})
   });
   const result=await response.json() as {error?:string};
   if(!response.ok)throw Error(result.error||`Could not ${action} candidate`);
   setConfirmations(current=>{const remaining={...current};delete remaining[candidateId];return remaining});
   setMessage(action==='approve'?'Photo approved and published.':'Candidate rejected.');
   await loadCandidates();
  }catch(error){setMessage(error instanceof Error?error.message:`Could not ${action} candidate`)}
  finally{setBusy(false)}
 }

 return <main className="wrap admin-page">
  <div className="admin-heading">
   <div><span className="brand">SCENTVERSE ADMIN</span><h1>Photo review</h1><p>Commons matches stay private until you confirm both the exact edition and reuse license.</p></div>
   {authenticated&&<button className="admin-button secondary" onClick={()=>void logout()}>Sign out</button>}
  </div>
  {message&&<p className="admin-message" role="status">{message}</p>}
  {!authenticated?<form className="admin-panel login-panel" onSubmit={login}>
   <h2>Secure sign in</h2><label>Admin token<input type="password" autoComplete="current-password" value={token} onChange={event=>setToken(event.target.value)} required/></label>
   <button className="admin-button" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
  </form>:<>
   <form className="admin-panel add-fragrance" onSubmit={importFragrance}>
    <h2>Add fragrance</h2><p>Adding a product automatically queues a Commons search. No AI service or AI credits are used.</p>
    <div className="admin-form-grid">
     <label>Brand<input value={brand} onChange={event=>setBrand(event.target.value)} required maxLength={150}/></label>
     <label>Fragrance name<input value={name} onChange={event=>setName(event.target.value)} required maxLength={200}/></label>
     <label>Concentration<input value={concentration} onChange={event=>setConcentration(event.target.value)} required maxLength={100}/></label>
     <label>Family<input value={family} onChange={event=>setFamily(event.target.value)} maxLength={80}/></label>
     <label className="wide-field">Notes, comma separated<input value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Cedar, bergamot, amber"/></label>
    </div>
    <button className="admin-button" disabled={busy}>Add fragrance</button>
   </form>
   <section className="admin-panel">
    <div className="admin-section-heading"><div><h2>Photo candidates</h2><p>Showing {candidates.length} candidates awaiting verification (up to 100)</p></div>
     <button className="admin-button secondary" onClick={()=>void processQueue()} disabled={busy}>Run photo search</button>
    </div>
    {loading?<p>Loading review queue…</p>:candidates.length===0?<p>No candidate photos are waiting for review.</p>:
     <div className="candidate-list">{candidates.map(candidate=><article className="candidate" key={candidate.id}>
      <a className="candidate-preview" href={candidate.source_page} target="_blank" rel="noreferrer">
       {candidate.thumbnail_url?<img src={candidate.thumbnail_url} alt={`Commons match for ${candidate.matched_title}`} loading="lazy"/>:<span>Preview unavailable</span>}
      </a>
      <div className="candidate-details">
       <p className="brand">{candidate.fragrances?`${candidate.fragrances.brand} · ${candidate.fragrances.name}`:`Fragrance ${candidate.fragrance_id}`}</p>
       <h3>{candidate.matched_title||'Untitled Commons match'}</h3>
       <p>{candidate.fragrances?.concentration}</p>
       <p>License: {candidate.license_url?<a href={candidate.license_url} target="_blank" rel="noreferrer">{candidate.license_name}</a>:candidate.license_name||'Unknown'}</p>
       <p>Creator: {candidate.creator||'Not credited'}</p>
       <a href={candidate.source_page} target="_blank" rel="noreferrer">View Commons file page ↗</a>
       <div className="candidate-confirmations">
        <label><input type="checkbox" checked={Boolean(confirmations[candidate.id]?.edition)} onChange={event=>setConfirmations(current=>({...current,[candidate.id]:{edition:event.target.checked,license:Boolean(current[candidate.id]?.license)}}))}/> I verified this is the exact fragrance edition.</label>
        <label><input type="checkbox" checked={Boolean(confirmations[candidate.id]?.license)} onChange={event=>setConfirmations(current=>({...current,[candidate.id]:{edition:Boolean(current[candidate.id]?.edition),license:event.target.checked}}))}/> I verified this license permits reuse.</label>
       </div>
       <div className="candidate-actions">
        <button className="admin-button" disabled={busy||!confirmations[candidate.id]?.edition||!confirmations[candidate.id]?.license} onClick={()=>void review(candidate.id,'approve')}>Approve and publish</button>
        <button className="admin-button secondary" disabled={busy} onClick={()=>void review(candidate.id,'reject')}>Reject</button>
       </div>
      </div>
     </article>)}</div>}
   </section>
  </>}
 </main>;
}
