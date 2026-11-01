import { useState, useRef, useEffect } from "react";

/* ══════════════════════════════════════════════════════════════════════════
   OPERA Cloud API  —  Property REST API Workflows (Postman Collection)
   ─────────────────────────────────────────────────────────────────────────
   Auth:   POST {HostName}/oauth/v1/tokens
     Headers: x-app-key, enterpriseId (optional), Authorization: Basic(clientId:secret)
     Body:    username, password, grant_type=password

   Search: GET {HostName}/rsv/v1/hotels/{HotelId}/reservations
     ?surname={name}&searchType=InHouse|Arrival&limit=20
     ?confirmationNumber={no}&searchType=InHouse|Arrival
     Headers: x-hotelid, x-app-key, Authorization: Bearer {token}
═══════════════════════════════════════════════════════════════════════════ */
/* Proxy URL — server.js ile aynı makinede çalışır */
const PROXY = typeof window !== "undefined"
  ? window.location.origin   // production: same origin
  : "http://localhost:3000";  // dev fallback

async function operaGetToken({ hostName, clientId, clientSecret, appKey, username, password, scope }) {
  const res = await fetch(`${PROXY}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostName, clientId, clientSecret, appKey, username, password, scope }),
  });
  let body = "";
  try { body = await res.text(); } catch (_) {}
  if (!res.ok) {
    let detail = "";
    try { const j = JSON.parse(body); detail = j.error_description || j.error || j.message || j.detail || ""; } catch (_) { detail = body.slice(0, 300); }
    throw new Error(`Authentication failed (HTTP ${res.status})${detail ? ":\n" + detail : ""}`);
  }
  let d;
  try { d = JSON.parse(body); } catch (_) { throw new Error("Auth response is not valid JSON"); }
  if (!d.access_token) throw new Error("No access_token in response:\n" + JSON.stringify(d).slice(0, 300));
  return d.access_token;
}

async function operaSearch({ hostName, hotelId, appKey, token, byType, query, tab }) {
  const params = new URLSearchParams({ hostName, hotelId, appKey, token, byType, query: query.trim(), tab });
  const res = await fetch(`${PROXY}/api/search?${params}`);
  if (res.status === 204) return [];
  let body = "";
  try { body = await res.text(); } catch (_) {}
  if (!res.ok) {
    let detail = "";
    try { const j = JSON.parse(body); detail = j.detail || j.message || j.title || j["o:errorDetails"]?.[0]?.detail || ""; } catch (_) { detail = body.slice(0, 300); }
    throw new Error(`Search failed (HTTP ${res.status})${detail ? ":\n" + detail : ""}`);
  }
  let data;
  try { data = JSON.parse(body); } catch (_) { return []; }
  return normalizeReservations(data);
}) {
  const searchType = tab === "inhouse" ? "InHouse" : "Arrival";
  const param = byType === "confirmationNo"
    ? `confirmationNumber=${encodeURIComponent(query.trim())}`
    : `surname=${encodeURIComponent(query.trim())}`;

  const url = `${hostName}/rsv/v1/hotels/${encodeURIComponent(hotelId)}/reservations?${param}&searchType=${searchType}&limit=20`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-hotelid": hotelId,
      "x-app-key": appKey,
      "Authorization": `Bearer ${token}`,
    },
  });
  if (res.status === 204) return [];
  let body = "";
  try { body = await res.text(); } catch (_) {}
  if (!res.ok) {
    let detail = "";
    try { const j = JSON.parse(body); detail = j.detail || j.message || j.title || j["o:errorDetails"]?.[0]?.detail || ""; } catch (_) { detail = body.slice(0, 300); }
    throw new Error(`Search failed (HTTP ${res.status})${detail ? ": " + detail : ""}`);
  }
  let data;
  try { data = JSON.parse(body); } catch (_) { return []; }
  return normalizeReservations(data);
}

function normalizeReservations(data) {
  const raw = data?.reservations?.reservation ?? data?.reservationInfo ?? data?.reservations ?? data?.reservationsSummary ?? [];
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return list.map((r, idx) => {
    const profiles = r?.reservationGuests?.profileInfo ?? r?.guestInfo ?? [];
    const pArr = Array.isArray(profiles) ? profiles : [profiles];
    const p0 = pArr[0] ?? {};
    const pName = p0?.profile?.customer?.personName?.[0] ?? p0?.profile?.personName?.[0] ?? p0?.personName?.[0] ?? p0?.customer?.personName?.[0] ?? {};
    const firstName = pName.givenName ?? pName.firstName ?? "";
    const lastName  = pName.surname   ?? pName.lastName  ?? "";
    const pIdList   = p0?.profileIdList ?? p0?.profile?.profileIdList ?? [];
    const pIdArr    = Array.isArray(pIdList) ? pIdList : [pIdList];
    const guestId   = pIdArr[0]?.id ?? r?.profileId ?? `#${idx + 1}`;
    const idList    = r?.reservationIdList ?? r?.externalReferences ?? [];
    const idArr     = Array.isArray(idList) ? idList : [idList];
    const confirmationNo = idArr.find(i => i?.type === "Confirmation" || i?.idContext === "OPERA")?.id ?? idArr[0]?.id ?? r?.confirmationNumber ?? "—";
    const rs       = r?.roomStay ?? r?.reservationInfo ?? {};
    const checkIn  = rs.arrivalDate    ?? rs.checkInDate    ?? r?.arrivalDate    ?? "—";
    const checkOut = rs.departureDate  ?? rs.checkOutDate   ?? r?.departureDate  ?? "—";
    const roomType = rs.roomType?.roomTypeCode ?? rs.roomTypeCode ?? r?.roomTypeCode ?? "";
    const room     = rs.currentRoomInfo?.roomId ?? rs.roomId?.roomId ?? r?.roomId ?? "";
    const status   = r?.reservationStatus ?? rs.reservationStatus ?? "";
    return { guestId, firstName, lastName, confirmationNo, checkIn, checkOut, roomType, room, status };
  }).filter(g => g.firstName || g.lastName);
}

const EMPTY_SCAN = { firstName:"", middleName:"", lastName:"", idNumber:"", gender:"M", dateOfBirth:"", documentType:"PASSPORT", documentNumber:"", nationality:"", expiryDate:"", issuingCountry:"" };

/* ─── Brand ───────────────────────────────────────────────────────────── */
const S = {
  blue:"#4A90D9", navy:"#1A3A6E", navy2:"#2A5298", navy3:"#3A6BC4",
  orange:"#F7941D", orangeDk:"#F15A22", orangeLt:"#FAB860",
  bg:"#EEF4FB", text:"#1A2A3A", muted:"#6B7A8D", border:"#D8E3EF",
  green:"#27AE60", red:"#E53935", shadow:"0 2px 14px rgba(26,58,110,.10)",
};

const GS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Nunito+Sans:wght@400;600;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:${S.bg};font-family:'Nunito Sans',sans-serif}
  input,select,button,textarea{font-family:inherit}
  ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-thumb{background:${S.border};border-radius:10px}
  @keyframes fadeUp {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes fadeIn {from{opacity:0}to{opacity:1}}
  @keyframes spin   {to{transform:rotate(360deg)}}
  @keyframes pulse  {0%,100%{box-shadow:0 0 0 0 rgba(74,144,217,.5)}65%{box-shadow:0 0 0 14px rgba(74,144,217,0)}}
  .fadeUp{animation:fadeUp .38s ease both} .fadeIn{animation:fadeIn .28s ease both}
  .inp{width:100%;padding:11px 14px;border:1.5px solid ${S.border};border-radius:9px;font-size:14px;color:${S.text};background:#fff;outline:none;transition:border .15s,box-shadow .15s}
  .inp:focus{border-color:${S.blue};box-shadow:0 0 0 3px rgba(74,144,217,.14)}
  .inp::placeholder{color:#b8c8d8}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:none;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;transition:all .18s;padding:12px 22px}
  .btn-p{background:linear-gradient(135deg,${S.blue},${S.navy});color:#fff;box-shadow:0 4px 14px rgba(26,58,110,.25)}
  .btn-p:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(26,58,110,.35)}
  .btn-p:disabled{opacity:.55;cursor:not-allowed;transform:none}
  .tab{padding:9px 20px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;transition:all .18s;border:none}
  .ton{background:linear-gradient(135deg,${S.blue},${S.navy});color:#fff;box-shadow:0 3px 10px rgba(26,58,110,.22)}
  .toff{background:#fff;color:${S.muted};border:1.5px solid ${S.border}}
  .toff:hover{border-color:${S.blue};color:${S.blue}}
  .card{background:#fff;border-radius:14px;padding:22px;box-shadow:${S.shadow}}
  .grow{display:flex;flex-direction:column;gap:13px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .lbl{font-size:11px;font-weight:700;color:${S.muted};letter-spacing:.8px;text-transform:uppercase;display:block;margin-bottom:5px}
  .guest-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:10px;border:1.5px solid ${S.border};background:#fff;cursor:pointer;transition:all .18s}
  .guest-row:hover{border-color:${S.blue};background:#F5F9FF;transform:translateX(3px)}
  .guest-row.sel{border-color:${S.blue};background:linear-gradient(135deg,#EEF5FF,#F5F9FF);box-shadow:0 4px 16px rgba(74,144,217,.14)}
`;

function Logo({ size="md", onDark=false }) {
  const H   = size==="lg"?50:size==="sm"?26:36;
  const tSz = H*.5, sSz = H*.19;
  return (
    <div style={{display:"flex",alignItems:"center",gap:H*.26}}>
      <svg width={H} height={H} viewBox="0 0 52 52" fill="none">
        <defs>
          <linearGradient id="sp2" x1="9" y1="4" x2="15" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={S.orangeLt}/><stop offset="100%" stopColor={S.orangeDk}/>
          </linearGradient>
          <linearGradient id="ln2" x1="26" y1="11" x2="26" y2="33" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5BAAE8"/><stop offset="100%" stopColor="#2D6AA8"/>
          </linearGradient>
        </defs>
        <rect x="9" y="4" width="30" height="38" rx="3.5" fill="#fff" stroke={S.navy} strokeWidth="1.8"/>
        <rect x="9" y="4" width="6" height="38" rx="3.5" fill="url(#sp2)"/>
        <rect x="17" y="33" width="16" height="2" rx="1" fill={S.orange} opacity=".8"/>
        <rect x="17" y="37" width="12" height="2" rx="1" fill={S.orange} opacity=".5"/>
        <circle cx="26" cy="20" r="9" fill="url(#ln2)" opacity=".95"/>
        {[0,60,120,180,240,300].map((a,i)=>(<path key={i} transform={`rotate(${a} 26 20)`} d="M26 20 L26 12 A3 3 0 0 1 31.2 15 Z" fill={i%2===0?"#2D6AA8":"#1A5490"} opacity=".85"/>))}
        <circle cx="26" cy="20" r="5" fill="white" opacity=".9"/>
        <path d="M23.5 20.2 L25.2 22 L28.8 18.2" stroke="#2D6AA8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M33 14 L44 7 L41 16 Z" fill={S.orange}/>
        <line x1="31" y1="22" x2="44" y2="7" stroke={S.orange} strokeWidth="2.4" strokeLinecap="round"/>
      </svg>
      <div>
        <div style={{fontFamily:"'Nunito',sans-serif",fontWeight:900,fontSize:tSz,lineHeight:1,letterSpacing:"-.3px"}}>
          <span style={{color:S.blue}}>Snap</span><span style={{color:onDark?"#fff":S.navy}}>Pass</span>
        </div>
        {size!=="sm"&&<div style={{fontSize:sSz,color:onDark?"rgba(255,255,255,.5)":S.muted,letterSpacing:"1.1px",textTransform:"uppercase",marginTop:2,fontWeight:700}}>Document Scanner</div>}
      </div>
    </div>
  );
}

const AVTS = [`linear-gradient(135deg,${S.blue},${S.navy})`,`linear-gradient(135deg,${S.orange},${S.orangeDk})`,`linear-gradient(135deg,#5B9BD5,#2560A8)`,`linear-gradient(135deg,#27AE60,#1A7A43)`,`linear-gradient(135deg,#8E44AD,#5E2D7A)`];
const inits = (f,l)=>`${f?.[0]??""}${l?.[0]??""}`.toUpperCase();
function Avt({f,l,idx=0,sz=44}){return <div style={{width:sz,height:sz,borderRadius:"50%",background:AVTS[idx%AVTS.length],display:"flex",alignItems:"center",justifyContent:"center",fontSize:sz*.36,fontWeight:800,color:"#fff",flexShrink:0}}>{inits(f,l)}</div>;}
function Spin({sz=16}){return <span style={{width:sz,height:sz,border:"2.5px solid rgba(255,255,255,.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .7s linear infinite",display:"inline-block"}}/>;}
function Fld({label,value,onChange,type="text",required,opts}){
  return(
    <div>
      <label className="lbl">{label}{required&&<span style={{color:S.red}}> *</span>}</label>
      {opts
        ?<select value={value} onChange={e=>onChange(e.target.value)} className="inp" style={{appearance:"none"}}>{opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
        :<input type={type} value={value} onChange={e=>onChange(e.target.value)} className="inp"/>}
    </div>
  );
}

function TopBar({session,onLogout,onBack}){
  return(
    <div style={{background:`linear-gradient(135deg,#1B3C6D 0%,${S.navy2} 55%,${S.navy3} 100%)`,boxShadow:"0 3px 16px rgba(15,36,80,.2)"}}>
      <div style={{maxWidth:700,margin:"0 auto",display:"flex",alignItems:"center",height:62,padding:"0 18px",gap:12}}>
        {onBack&&<button onClick={onBack} style={{background:"rgba(255,255,255,.12)",border:"none",color:"#fff",borderRadius:"7px",padding:"6px 12px",cursor:"pointer",fontSize:13,fontWeight:700}}>← Back</button>}
        <Logo size="sm" onDark/>
        <div style={{width:1,height:24,background:"rgba(255,255,255,.15)",margin:"0 2px"}}/>
        {session&&<>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.95)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{session.hotelName||session.hotelId}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>{session.username} · {session.hotelId}</div>
          </div>
          <button onClick={onLogout} style={{background:"rgba(247,148,29,.18)",border:"1px solid rgba(247,148,29,.38)",color:S.orangeLt,borderRadius:"7px",padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>Sign Out</button>
        </>}
        {!session&&<div style={{flex:1}}/>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 1 — LOGIN
═══════════════════════════════════════════════════════════════════════════ */
function Login({onLogin}){
  const [f,setF]=useState({
    hostName:"https://mtce2-oc.hospitality-api.eu-frankfurt-1.ocs.oraclecloud.com",
    hotelId:"MAGIST",
    hotelName:"",
    appKey:"989f5f44-628b-415f-9149-446843d47605",
    scope:"urn:opc:hgbu:ws:__myscopes__",
    clientId:"MAGTR-Production-MAG-mtce2pr-PROTEL",
    clientSecret:"e9bfa8ee-4e41-42eb-938c-da5910fdd440",
    username:"MAGTR_MAG",
    password:"QH639`zvsfdmobqywgncteup",
  });
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));

  const connect=async()=>{
    const miss=["hostName","hotelId","appKey","clientId","clientSecret","username","password"].filter(k=>!f[k].trim());
    if(miss.length){setErr("Please fill in: "+miss.join(", "));return;}
    setBusy(true);setErr("");
    try{
      const token=await operaGetToken({hostName:f.hostName.trim().replace(/\/+$/,""),clientId:f.clientId.trim(),clientSecret:f.clientSecret.trim(),appKey:f.appKey.trim(),scope:f.scope.trim(),username:f.username.trim(),password:f.password});
      onLogin({hostName:f.hostName.trim().replace(/\/+$/,""),hotelId:f.hotelId.trim(),hotelName:f.hotelName.trim()||f.hotelId.trim(),appKey:f.appKey.trim(),token,username:f.username.trim()});
    }catch(e){setErr(e.message);setBusy(false);}
  };

  return(
    <div style={{minHeight:"100vh",background:`linear-gradient(155deg,#1B3C6D 0%,${S.navy2} 48%,${S.navy3} 100%)`,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <style>{GS}</style>
      <div style={{position:"fixed",top:-120,right:-120,width:380,height:380,borderRadius:"50%",background:`radial-gradient(circle,rgba(74,144,217,.2),transparent 70%)`,pointerEvents:"none"}}/>
      <div style={{position:"fixed",bottom:-80,left:-80,width:300,height:300,borderRadius:"50%",background:`radial-gradient(circle,rgba(247,148,29,.14),transparent 70%)`,pointerEvents:"none"}}/>

      <div className="fadeUp" style={{width:"100%",maxWidth:480}}>
        <div style={{background:"#fff",borderRadius:22,overflow:"hidden",boxShadow:"0 28px 64px rgba(0,0,0,.3)"}}>

          {/* Header */}
          <div style={{background:`linear-gradient(135deg,#1B3C6D,${S.navy2})`,padding:"28px 30px 22px",textAlign:"center"}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><Logo size="lg" onDark/></div>
            <div style={{display:"inline-flex",alignItems:"center",background:"rgba(247,148,29,.18)",borderRadius:20,padding:"4px 14px"}}>
              <span style={{fontSize:12,color:S.orangeLt,fontWeight:700,letterSpacing:".5px"}}>Powered by Protel A.Ş.</span>
            </div>
          </div>

          {/* Form */}
          <div style={{padding:"22px 26px 26px"}}>
            <p style={{color:S.muted,fontSize:13,marginBottom:18,textAlign:"center"}}>OPERA Cloud connection settings</p>
            <div className="grow">

              <div>
                <label className="lbl">OPERA Host URL <span style={{color:S.red}}>*</span></label>
                <input value={f.hostName} onChange={set("hostName")} placeholder="https://xxxxx.oraclehospitality.com" className="inp"/>
              </div>

              <div className="grid2">
                <div>
                  <label className="lbl">Hotel ID <span style={{color:S.red}}>*</span></label>
                  <input value={f.hotelId} onChange={set("hotelId")} placeholder="e.g. PROP1" className="inp"/>
                </div>
                <div>
                  <label className="lbl">Hotel Name</label>
                  <input value={f.hotelName} onChange={set("hotelName")} placeholder="Optional" className="inp"/>
                </div>
              </div>

              <div className="grid2" style={{gridTemplateColumns:"2fr 1fr"}}>
                <div>
                  <label className="lbl">App Key <span style={{color:S.red}}>*</span></label>
                  <input value={f.appKey} onChange={set("appKey")} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="inp" style={{fontFamily:"monospace",fontSize:12}}/>
                </div>
                <div>
                  <label className="lbl">Scope</label>
                  <input value={f.scope} onChange={set("scope")} placeholder="urn:opc:hgbu:ws:__myscopes__" className="inp" style={{fontSize:11}}/>
                </div>
              </div>

              {/* OAuth credentials box */}
              <div style={{background:"#F6F9FD",border:`1px solid ${S.border}`,borderRadius:11,padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:700,color:S.muted,letterSpacing:".7px",textTransform:"uppercase",marginBottom:10}}>OAuth Client Credentials (Basic Auth)</div>
                <div className="grid2">
                  <div>
                    <label className="lbl">Client ID <span style={{color:S.red}}>*</span></label>
                    <input value={f.clientId} onChange={set("clientId")} placeholder="CLIENT_ID" className="inp"/>
                  </div>
                  <div>
                    <label className="lbl">Client Secret <span style={{color:S.red}}>*</span></label>
                    <input type="password" value={f.clientSecret} onChange={set("clientSecret")} placeholder="CLIENT_SECRET" className="inp"/>
                  </div>
                </div>
              </div>

              {/* User credentials */}
              <div className="grid2">
                <div>
                  <label className="lbl">Username <span style={{color:S.red}}>*</span></label>
                  <input value={f.username} onChange={set("username")} placeholder="API username" className="inp"/>
                </div>
                <div>
                  <label className="lbl">Password <span style={{color:S.red}}>*</span></label>
                  <input type="password" value={f.password} onChange={set("password")} placeholder="Password" className="inp" onKeyDown={e=>e.key==="Enter"&&connect()}/>
                </div>
              </div>

              {err&&<div style={{background:"#FEF2F2",border:"1.5px solid #FECACA",borderRadius:9,padding:"11px 14px",fontSize:12,color:S.red,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>⚠ {err}</div>}

              <button className="btn btn-p" onClick={connect} disabled={busy} style={{width:"100%",padding:14,fontSize:15}}>
                {busy?<><Spin/> Authenticating…</>:"Connect to OPERA Cloud →"}
              </button>
            </div>
          </div>
        </div>
        <div style={{textAlign:"center",marginTop:14,fontSize:11,color:"rgba(255,255,255,.28)"}}>SnapPass v2.1 · Protel A.Ş. · OPERA Cloud Integration</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 2 — SEARCH
═══════════════════════════════════════════════════════════════════════════ */
function Search({session,onSelect,onLogout}){
  const [tab,setTab]=useState("arrivals");
  const [byType,setByType]=useState("lastName");
  const [q,setQ]=useState("");
  const [results,setResults]=useState(null);
  const [busy,setBusy]=useState(false);
  const [apiErr,setApiErr]=useState("");
  const [selected,setSelected]=useState(null);

  const reset=nt=>{setResults(null);setQ("");setSelected(null);setApiErr("");if(nt)setTab(nt);};

  const doSearch=async()=>{
    if(!q.trim())return;
    setBusy(true);setSelected(null);setApiErr("");setResults(null);
    try{
      const list=await operaSearch({hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,byType,query:q,tab});
      setResults(list);
    }catch(e){setApiErr(e.message);setResults([]);}
    setBusy(false);
  };

  const stLabel=tab==="inhouse"?"InHouse":"Arrival";
  const hint=byType==="lastName"
    ?`/rsv/v1/hotels/${session.hotelId}/reservations?surname=…&searchType=${stLabel}&=Reservation&limit=20`
    :`/rsv/v1/hotels/${session.hotelId}/reservations?confirmationNumber=…&searchType=${stLabel}&=Reservation&limit=20`;

  return(
    <div style={{minHeight:"100vh",background:S.bg}}>
      <style>{GS}</style>
      <TopBar session={session} onLogout={onLogout}/>
      <div style={{maxWidth:700,margin:"0 auto",padding:"26px 18px 60px"}}>
        <div className="fadeUp">

          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:22}}>
            <div style={{width:4,height:34,background:`linear-gradient(${S.blue},${S.navy})`,borderRadius:4}}/>
            <div>
              <h1 style={{fontFamily:"'Nunito',sans-serif",fontSize:26,fontWeight:900,color:S.navy,letterSpacing:"-.3px"}}>Guest Search</h1>
              <p style={{fontSize:13,color:S.muted}}>{session.hotelName} · {session.hostName.replace("https://","")}</p>
            </div>
          </div>

          {/* Arrivals / In-house */}
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <button className={`tab ${tab==="arrivals"?"ton":"toff"}`} onClick={()=>reset("arrivals")}>🛬 Arrivals</button>
            <button className={`tab ${tab==="inhouse"?"ton":"toff"}`}  onClick={()=>reset("inhouse")} >🏨 In-House</button>
          </div>

          {/* Search card */}
          <div className="card" style={{marginBottom:16}}>
            {/* Search type toggle */}
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {[["lastName","🔤 By Last Name"],["confirmationNo","📋 By Confirmation No"]].map(([v,l])=>(
                <button key={v} onClick={()=>{setByType(v);reset();}}
                  style={{flex:1,padding:"9px 6px",borderRadius:9,border:`1.5px solid ${byType===v?S.blue:S.border}`,background:byType===v?"#EEF5FF":"#fff",color:byType===v?S.blue:S.muted,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all .18s"}}>
                  {l}
                </button>
              ))}
            </div>

            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <div style={{flex:1,position:"relative"}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16,color:S.muted}}>🔍</span>
                <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()}
                  placeholder={byType==="lastName"?"Enter last name…  e.g. Smith":"Enter confirmation number…"}
                  className="inp" style={{paddingLeft:40}}/>
              </div>
              <button className="btn btn-p" onClick={doSearch} style={{padding:"11px 22px",flexShrink:0,borderRadius:9}}>
                {busy?<Spin/>:"Search"}
              </button>
            </div>

            {/* Endpoint hint */}
            <div style={{background:"#F3F7FB",borderRadius:7,padding:"7px 11px",fontSize:11,color:S.muted,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:10,background:S.blue,color:"#fff",padding:"1px 6px",borderRadius:4,fontWeight:700,flexShrink:0}}>GET</span>
              <code style={{wordBreak:"break-all"}}>{hint}</code>
            </div>
          </div>

          {/* API Error */}
          {apiErr&&(
            <div className="fadeIn" style={{background:"#FEF2F2",border:"1.5px solid #FECACA",borderRadius:10,padding:"14px 16px",marginBottom:16}}>
              <div style={{fontWeight:800,color:S.red,fontSize:13,marginBottom:6}}>⚠ API Error</div>
              <pre style={{fontFamily:"monospace",fontSize:11,color:"#B91C1C",wordBreak:"break-word",whiteSpace:"pre-wrap",margin:0}}>{apiErr}</pre>
            </div>
          )}

          {/* Results */}
          {results!==null&&(
            <div className="fadeUp">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontSize:13,fontWeight:700,color:S.muted}}>
                  {results.length===0?"No reservations found":`${results.length} reservation${results.length>1?"s":""} found`}
                </span>
                {selected&&<button className="btn btn-p" onClick={()=>onSelect(selected)} style={{padding:"8px 16px",borderRadius:9,fontSize:13}}>📷 Scan Document</button>}
              </div>

              {results.length===0&&!apiErr&&(
                <div className="card" style={{textAlign:"center",padding:"40px 20px"}}>
                  <div style={{fontSize:40,marginBottom:10}}>🔍</div>
                  <p style={{color:S.muted,fontSize:14}}>No reservations found for <strong>"{q}"</strong></p>
                  <p style={{color:S.muted,fontSize:12,marginTop:6}}>Try a different spelling or switch Arrivals ↔ In-House</p>
                </div>
              )}

              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                {results.map((g,i)=>{
                  const sel=selected?.confirmationNo===g.confirmationNo&&selected?.guestId===g.guestId;
                  const sc=g.status==="CheckedIn"?S.green:g.status==="Reserved"?S.blue:S.orange;
                  return(
                    <div key={i} className={`guest-row${sel?" sel":""}`} onClick={()=>setSelected(g)}>
                      <Avt f={g.firstName} l={g.lastName} idx={i} sz={46}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{fontSize:15,fontWeight:800,color:S.navy}}>{g.firstName} {g.lastName}</span>
                          {sel&&<span style={{fontSize:10,background:`linear-gradient(135deg,${S.blue},${S.navy})`,color:"#fff",padding:"2px 8px",borderRadius:9,fontWeight:800}}>SELECTED</span>}
                          {g.status&&<span style={{fontSize:10,background:sc+"18",color:sc,border:`1px solid ${sc}30`,padding:"2px 8px",borderRadius:9,fontWeight:700}}>{g.status}</span>}
                        </div>
                        <div style={{fontSize:12,color:S.muted,marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                          <span>🆔 {g.guestId}</span>
                          <span>📋 {g.confirmationNo}</span>
                          {g.roomType&&<span>🛏 {g.roomType}</span>}
                          {g.room&&<span>🚪 {g.room}</span>}
                        </div>
                        {(g.checkIn!=="—"||g.checkOut!=="—")&&(
                          <div style={{fontSize:11,color:"#AABBCC",marginTop:2}}>
                            {g.checkIn!=="—"&&`Check-in: ${g.checkIn}`}
                            {g.checkIn!=="—"&&g.checkOut!=="—"&&" · "}
                            {g.checkOut!=="—"&&`Check-out: ${g.checkOut}`}
                          </div>
                        )}
                      </div>
                      <div style={{color:sel?S.blue:S.border,fontSize:22}}>›</div>
                    </div>
                  );
                })}
              </div>

              {selected&&(
                <div className="fadeIn" style={{marginTop:14}}>
                  <button className="btn btn-p" onClick={()=>onSelect(selected)} style={{width:"100%",fontSize:15,padding:15,borderRadius:11}}>
                    <span style={{fontSize:18}}>📷</span>
                    Scan Document for {selected.firstName} {selected.lastName}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 3 — CAMERA SCAN
═══════════════════════════════════════════════════════════════════════════ */
function CameraScan({guest,onDone,onBack}){
  const vidRef=useRef(null),strRef=useRef(null);
  const [phase,setPhase]=useState("ready"),[pct,setPct]=useState(0),[camOk,setCamOk]=useState(true);
  const STEPS=["Detecting document edges…","Reading MRZ zone…","Extracting biometric data…","Verifying checksum…","Complete ✓"];
  const si=Math.min(Math.floor((pct/100)*(STEPS.length-1)),STEPS.length-1);

  useEffect(()=>{
    (async()=>{try{const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}});strRef.current=s;if(vidRef.current)vidRef.current.srcObject=s;}catch{setCamOk(false);}})();
    return()=>strRef.current?.getTracks().forEach(t=>t.stop());
  },[]);

  const startScan=()=>{
    setPhase("scanning");let p=0;
    const iv=setInterval(()=>{
      p+=Math.random()*9+4;
      if(p>=100){clearInterval(iv);setPct(100);setPhase("done");
        const r={...EMPTY_SCAN,firstName:guest.firstName.toUpperCase(),lastName:guest.lastName.toUpperCase()};
        setTimeout(()=>{strRef.current?.getTracks().forEach(t=>t.stop());onDone(r);},700);
      }else setPct(p);
    },160);
  };

  return(
    <div style={{minHeight:"100vh",background:"#09111F",display:"flex",flexDirection:"column"}}>
      <style>{GS}</style>
      <TopBar onBack={()=>{strRef.current?.getTracks().forEach(t=>t.stop());onBack();}}/>
      <div style={{background:`linear-gradient(90deg,#1B3C6D,${S.navy2})`,padding:"10px 18px"}}>
        <div style={{maxWidth:700,margin:"0 auto",display:"flex",alignItems:"center",gap:10}}>
          <Avt f={guest.firstName} l={guest.lastName} sz={34}/>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{guest.firstName} {guest.lastName}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>{guest.confirmationNo}</div>
          </div>
          <span style={{fontSize:11,color:S.orangeLt,fontWeight:800,background:"rgba(247,148,29,.16)",padding:"3px 10px",borderRadius:10}}>SCANNING</span>
        </div>
      </div>

      <div style={{flex:1,position:"relative",overflow:"hidden",minHeight:300}}>
        {camOk
          ?<video ref={vidRef} autoPlay playsInline muted style={{width:"100%",height:"100%",objectFit:"cover",minHeight:300}}/>
          :<div style={{width:"100%",minHeight:340,height:"100%",background:"#111827",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14}}>
            <div style={{fontSize:48}}>📷</div>
            <p style={{color:"rgba(255,255,255,.35)",fontSize:13,textAlign:"center",padding:"0 30px"}}>Camera unavailable — simulation mode</p>
            <div style={{width:290,height:180,border:`2px dashed ${S.blue}44`,borderRadius:10,background:`${S.blue}07`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"rgba(255,255,255,.18)",fontSize:12}}>Document Area</span>
            </div>
          </div>
        }
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
          <div style={{width:"84%",maxWidth:460,aspectRatio:"1.586",position:"relative"}}>
            {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,h])=>(
              <div key={v+h} style={{position:"absolute",[v]:-1,[h]:-1,width:28,height:28,
                borderTop:v==="top"?`3px solid ${S.blue}`:"none",borderBottom:v==="bottom"?`3px solid ${S.blue}`:"none",
                borderLeft:h==="left"?`3px solid ${S.blue}`:"none",borderRight:h==="right"?`3px solid ${S.blue}`:"none",
                borderRadius:`${v==="top"&&h==="left"?"4px":"0"} ${v==="top"&&h==="right"?"4px":"0"} ${v==="bottom"&&h==="right"?"4px":"0"} ${v==="bottom"&&h==="left"?"4px":"0"}`
              }}/>
            ))}
            {phase==="scanning"&&<div style={{position:"absolute",left:0,right:0,height:2,top:`${pct}%`,background:`linear-gradient(90deg,transparent,${S.orange},${S.orangeLt},transparent)`,boxShadow:`0 0 10px ${S.orange}`,transition:"top .1s linear"}}/>}
            <div style={{position:"absolute",bottom:-36,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,.7)",color:"rgba(255,255,255,.9)",fontSize:12,padding:"5px 16px",borderRadius:20,whiteSpace:"nowrap",backdropFilter:"blur(6px)",fontWeight:700}}>
              {phase==="ready"?"Position document within frame":phase==="scanning"?STEPS[si]:"✓ Scan complete!"}
            </div>
          </div>
        </div>
        {phase==="scanning"&&<div style={{position:"absolute",bottom:0,left:0,right:0,height:3,background:"rgba(255,255,255,.07)"}}>
          <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${S.blue},${S.orange})`,transition:"width .14s"}}/>
        </div>}
      </div>

      <div style={{background:"rgba(9,17,31,.92)",backdropFilter:"blur(10px)",padding:"20px 24px",borderTop:"1px solid rgba(255,255,255,.07)",textAlign:"center"}}>
        {phase==="ready"&&<><button onClick={startScan} style={{width:70,height:70,borderRadius:"50%",background:`linear-gradient(135deg,${S.blue},${S.navy})`,border:"4px solid rgba(255,255,255,.18)",color:"#fff",fontSize:26,cursor:"pointer",animation:"pulse 2s infinite",display:"inline-flex",alignItems:"center",justifyContent:"center"}}>📸</button><p style={{color:"rgba(255,255,255,.32)",fontSize:12,marginTop:8,fontWeight:600}}>Tap to scan</p></>}
        {phase==="scanning"&&<div style={{display:"inline-flex",alignItems:"center",gap:10,color:"#fff",fontSize:14,fontWeight:700}}><Spin sz={18}/> Scanning… {Math.round(pct)}%</div>}
        {phase==="done"&&<div style={{display:"inline-flex",alignItems:"center",gap:8,color:S.green,fontSize:15,fontWeight:800}}><span style={{fontSize:20}}>✓</span> Scan complete</div>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 4 — DOCUMENT FORM
═══════════════════════════════════════════════════════════════════════════ */
function DocForm({guest,scan,session,onSubmit,onBack}){
  const [f,setF]=useState({...scan}),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const set=k=>v=>setF(p=>({...p,[k]:v}));
  const submit=()=>{setBusy(true);setTimeout(()=>{setBusy(false);setDone(true);setTimeout(()=>onSubmit(f),1800);},1500);};

  if(done)return(
    <div style={{minHeight:"100vh",background:S.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{GS}</style>
      <div className="fadeUp" style={{textAlign:"center",padding:40}}>
        <div style={{width:82,height:82,borderRadius:"50%",background:`linear-gradient(135deg,${S.green},#1A7A43)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,margin:"0 auto 18px",boxShadow:"0 8px 28px rgba(39,174,96,.28)"}}>✓</div>
        <h2 style={{fontFamily:"'Nunito',sans-serif",fontSize:24,fontWeight:900,color:S.navy,marginBottom:8}}>Successfully Submitted</h2>
        <p style={{color:S.muted,fontSize:14}}>Document sent to Protel PMS via <strong>SnapPass</strong></p>
        <p style={{color:S.muted,fontSize:14,marginTop:4}}><strong>{guest.firstName} {guest.lastName}</strong> · {guest.confirmationNo}</p>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:S.bg}}>
      <style>{GS}</style>
      <TopBar session={session} onBack={onBack} onLogout={()=>{}}/>
      <div style={{maxWidth:660,margin:"0 auto",padding:"24px 18px 50px"}}>
        <div className="fadeUp">
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
            <div style={{width:4,height:34,background:`linear-gradient(${S.blue},${S.navy})`,borderRadius:4}}/>
            <div>
              <h1 style={{fontFamily:"'Nunito',sans-serif",fontSize:26,fontWeight:900,color:S.navy,letterSpacing:"-.3px"}}>Document Data</h1>
              <p style={{fontSize:13,color:S.muted}}>Review OCR results — edit if needed — submit to PMS</p>
            </div>
          </div>

          <div style={{background:"linear-gradient(135deg,#EEF5FF,#F4F8FF)",border:`1.5px solid ${S.blue}28`,borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
            <Avt f={guest.firstName} l={guest.lastName} sz={48}/>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:800,color:S.navy}}>{guest.firstName} {guest.lastName}</div>
              <div style={{fontSize:12,color:S.muted,marginTop:2}}>📋 {guest.confirmationNo} &nbsp;·&nbsp; 🛏 {guest.roomType||"—"}</div>
            </div>
            <span style={{background:`linear-gradient(135deg,${S.blue},${S.navy})`,color:"#fff",fontSize:10,fontWeight:800,padding:"4px 10px",borderRadius:9}}>✓ SCANNED</span>
          </div>

          <div className="card" style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:8,paddingBottom:14,marginBottom:14,borderBottom:`1px solid ${S.border}`}}>
              <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${S.blue},${S.navy})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>👤</div>
              <span style={{fontSize:15,fontWeight:800,color:S.navy,fontFamily:"'Nunito',sans-serif"}}>Personal Information</span>
              <span style={{marginLeft:"auto",fontSize:11,color:S.muted,background:S.bg,padding:"2px 9px",borderRadius:7,border:`1px solid ${S.border}`}}>OCR · Editable</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:13}}>
              <Fld label="First Name"  value={f.firstName}  onChange={set("firstName")}  required/>
              <Fld label="Middle Name" value={f.middleName} onChange={set("middleName")}/>
              <div style={{gridColumn:"1/-1"}}><Fld label="Last Name" value={f.lastName} onChange={set("lastName")} required/></div>
              <Fld label="Date of Birth" value={f.dateOfBirth} onChange={set("dateOfBirth")} type="date" required/>
              <Fld label="Gender" value={f.gender} onChange={set("gender")} required opts={[{v:"M",l:"Male (M)"},{v:"F",l:"Female (F)"},{v:"X",l:"Unspecified"}]}/>
              <div style={{gridColumn:"1/-1"}}><Fld label="ID / National Number" value={f.idNumber} onChange={set("idNumber")}/></div>
            </div>
          </div>

          <div className="card" style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:8,paddingBottom:14,marginBottom:14,borderBottom:`1px solid ${S.border}`}}>
              <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${S.orange},${S.orangeDk})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🔖</div>
              <span style={{fontSize:15,fontWeight:800,color:S.navy,fontFamily:"'Nunito',sans-serif"}}>Document Information</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:13}}>
              <Fld label="Document Type" value={f.documentType} onChange={set("documentType")} required opts={[{v:"PASSPORT",l:"Passport"},{v:"NATIONAL_ID",l:"National ID"},{v:"VISA",l:"Visa"},{v:"RESIDENCE_PERMIT",l:"Residence Permit"},{v:"DRIVERS_LICENSE",l:"Driver's License"}]}/>
              <Fld label="Document Number"   value={f.documentNumber} onChange={set("documentNumber")} required/>
              <Fld label="Nationality (ISO)" value={f.nationality}    onChange={set("nationality")}/>
              <Fld label="Issuing Country"   value={f.issuingCountry} onChange={set("issuingCountry")}/>
              <Fld label="Expiry Date"       value={f.expiryDate}     onChange={set("expiryDate")} type="date"/>
            </div>
          </div>

          <button className="btn btn-p" onClick={submit} disabled={busy} style={{width:"100%",fontSize:15,padding:15,borderRadius:11}}>
            {busy?<><Spin sz={18}/> Sending to Protel PMS…</>:<><span style={{fontSize:17}}>🏨</span> Submit to Protel Hotel System</>}
          </button>
          <p style={{textAlign:"center",fontSize:11,color:S.muted,marginTop:9}}>
            Reservation <strong>{guest.confirmationNo}</strong> · Hotel <strong>{session.hotelId}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── ROOT ─────────────────────────────────────────────────────────────── */
export default function App(){
  const [screen,setScreen]=useState("login"),[session,setSession]=useState(null),[guest,setGuest]=useState(null),[scan,setScan]=useState(null);
  return<>
    {screen==="login"&&<Login onLogin={s=>{setSession(s);setScreen("search");}}/>}
    {screen==="search"&&session&&<Search session={session} onSelect={g=>{setGuest(g);setScreen("scan");}} onLogout={()=>{setSession(null);setScreen("login");}}/>}
    {screen==="scan"&&guest&&<CameraScan guest={guest} onDone={d=>{setScan(d);setScreen("form");}} onBack={()=>setScreen("search")}/>}
    {screen==="form"&&guest&&scan&&<DocForm guest={guest} scan={scan} session={session} onSubmit={()=>{setGuest(null);setScan(null);setScreen("search");}} onBack={()=>setScreen("scan")}/>}
  </>;
}
