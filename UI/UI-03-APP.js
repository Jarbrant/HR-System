
/* ============================================================
AO-002 | FIL-ID: UI/UI-02-STYLES.css
Minimal modernisering för medarbetar-dashboard (grid + kort)
Policy: Ingen stor redesign, men modern layout med tydliga rutor.
============================================================ */
:root { color-scheme: light; }
* { box-sizing: border-box; }
body{
  margin:0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  line-height:1.5;
  background:#fff;
  color:#111;
}
a{ color:inherit; text-decoration:none; }
a:hover{ text-decoration:underline; }

.top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:14px 18px;
  border-bottom:1px solid #eee;
}
.brand{ display:flex; gap:8px; align-items:baseline; }
.nav{ display:flex; gap:12px; flex-wrap:wrap; }
.nav a{ padding:6px 8px; border-radius:8px; }
.nav a[aria-current="page"]{ background:#f3f4f6; }

.container{
  max-width: 980px;
  margin: 0 auto;
  padding: 18px;
}

.card{
  border:1px solid #eee;
  border-radius:16px;
  padding:16px;
  box-shadow: 0 1px 0 rgba(0,0,0,0.03);
}

.muted{ color:#4b5563; }
.small{ font-size:0.92rem; }
.tight{ margin:0 0 6px; }
.wrap{ flex-wrap:wrap; }

.form{ margin-top: 12px; display:flex; flex-direction:column; gap:12px; }
.field{ display:flex; flex-direction:column; gap:6px; }

input{
  width:100%;
  padding:10px 12px;
  border:1px solid #e5e7eb;
  border-radius:12px;
  font-size:1rem;
}
textarea.textarea{
  width:100%;
  padding:10px 12px;
  border:1px solid #e5e7eb;
  border-radius:12px;
  font-size:1rem;
  resize:vertical;
}

button{
  padding:10px 12px;
  border-radius:12px;
  border:1px solid #e5e7eb;
  background:#111;
  color:#fff;
  cursor:pointer;
}
button.secondary{
  background:#fff;
  color:#111;
}
button:disabled{ opacity:0.6; cursor:not-allowed; }

.btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid #e5e7eb;
  background:#fff;
  color:#111;
  text-decoration:none;
}
.btn.secondary:hover{ background:#f9fafb; text-decoration:none; }

.row{ display:flex; gap:10px; align-items:center; }
.space-between{ justify-content:space-between; width:100%; }

.message{
  min-height: 22px;
  padding: 8px 10px;
  border-radius:12px;
  border:1px solid transparent;
}
.message.ok{ border-color:#d1fae5; background:#ecfdf5; color:#065f46; }
.message.err{ border-color:#fee2e2; background:#fef2f2; color:#991b1b; }
.message.warn{ border-color:#fde68a; background:#fffbeb; color:#92400e; }

.box{
  margin-top: 12px;
  padding: 12px;
  border-radius: 14px;
  border:1px solid #eee;
  background:#fafafa;
}

.subnav{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
  margin: 14px 0 10px;
}
.subnav a{
  padding:8px 10px;
  border-radius:12px;
  border:1px solid #eee;
  background:#fff;
}
.subnav a[aria-current="page"]{ background:#f3f4f6; }

.grid-cards{
  display:grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap:12px;
  margin-top: 14px;
}
@media (max-width: 700px){
  .grid-cards{ grid-template-columns: 1fr; }
}

.bigcard{
  display:block;
  border:1px solid #eee;
  border-radius:16px;
  padding:14px;
  background:#fff;
}
.bigcard:hover{ background:#f9fafb; text-decoration:none; }
.bigcard-title{ font-weight:700; margin-bottom:6px; }

.tag{
  display:inline-block;
  margin-left:6px;
  padding:2px 8px;
  border-radius:999px;
  border:1px solid #eee;
  background:#f9fafb;
  font-size:0.82rem;
  color:#4b5563;
}

.dashgrid{
  display:grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap:12px;
  margin-top: 12px;
}
@media (max-width: 900px){
  .dashgrid{ grid-template-columns: 1fr; }
}

.panel{
  border:1px solid #eee;
  border-radius:16px;
  padding:14px;
  background:#fff;
}
.panel-title{ font-weight:700; margin-bottom:10px; }

.list{
  list-style:none;
  padding:0;
  margin:0;
  display:flex;
  flex-direction:column;
  gap:10px;
}
.list > li{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:flex-start;
}
.list > li.stack{
  flex-direction:column;
  align-items:stretch;
}

.pill{
  padding:2px 10px;
  border-radius:999px;
  border:1px solid #eee;
  background:#f3f4f6;
  color:#111;
  font-size:0.85rem;
  white-space:nowrap;
}

.link{
  display:inline-block;
  margin-top:10px;
  color:#111;
  text-decoration:underline;
}

.routehead{
  margin: 12px 0 10px;
}

.sep{
  border:none;
  border-top:1px solid #eee;
  margin: 14px 0;
}

.inline{
  flex: 1;
  min-width: 220px;
}

