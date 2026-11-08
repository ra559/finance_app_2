import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3,
  CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  CreditCard, Download, FileText, Filter, Gem, Landmark, LayoutDashboard,
  Loader2, LockKeyhole, LogOut, MoreHorizontal, Paperclip, Plus, RefreshCw,
  Search, Send, Settings as SettingsIcon, ShieldCheck, Sparkles, Target, TrendingUp,
  Upload, Wallet, X, Zap
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const preciseMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const COLORS = ['#2e684b', '#adc881', '#e5ae73', '#98a9ba', '#a490c5', '#77b9aa', '#e88880', '#c6a379'];
const API = '/api';
let plaidLoad;

function ensurePlaidLoaded() {
  if (window.Plaid) return Promise.resolve();
  if (plaidLoad) return plaidLoad;
  plaidLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.onload = () => resolve();
    script.onerror = () => { plaidLoad = null; reject(new Error('Plaid Link could not load. Check the server connection.')); };
    document.head.appendChild(script);
  });
  return plaidLoad;
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data;
}

function iconForType(type) {
  if (type === 'credit' || type === 'loan' || type === 'mortgage') return CreditCard;
  if (type === 'investment') return BarChart3;
  return Landmark;
}

function Label({ children, tone = 'default' }) { return <span className={`label label-${tone}`}>{children}</span>; }

function Brand({ small = false }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark"><span /><span /><span /></span><span className="brand-name">ledger<span className="brand-dot">.</span></span></div>;
}

function AuthScreen({ setupRequired, onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await request(setupRequired ? '/auth/setup' : '/auth/login', { method: 'POST', body: { username: setupRequired ? username : undefined, password, setupCode: setupRequired ? setupCode : undefined } });
      onAuthenticated(data.username);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <div className="auth-story">
      <div className="auth-brand"><Brand /></div>
      <div className="auth-copy"><div className="eyebrow"><span className="eyebrow-dot" /> A quieter kind of money app</div><h1>Your whole<br />financial life,<br /><em>in one place.</em></h1><p>Private by design. Hosted by you. A clear view of the money coming in, going out, and growing.</p>
        <div className="auth-proof"><div className="avatar-stack"><i>R</i><i>J</i><i>M</i></div><span>Just you and your own server.</span></div>
      </div>
      <div className="auth-decoration"><div className="auth-sun" /><div className="auth-line auth-line-one" /><div className="auth-line auth-line-two" /><span className="auth-note">YOUR MONEY, IN VIEW</span></div>
      <div className="auth-foot"><LockKeyhole size={14} /> Your financial data stays on your server.</div>
    </div>
    <div className="auth-form-side"><div className="auth-form-wrap">
      <div className="auth-mobile-brand"><Brand /></div>
      <div className="auth-step">{setupRequired ? 'YOUR PRIVATE FINANCE SPACE' : 'WELCOME BACK'}</div>
      <h2>{setupRequired ? 'Make it yours.' : 'Good to have you back.'}</h2>
      <p className="auth-form-desc">{setupRequired ? 'Create the local account that protects your Ledger.' : 'Sign in to see where everything stands.'}</p>
      <form className="auth-form" onSubmit={submit}>
        {setupRequired && <><label className="field"><span>One-time setup code</span><input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="off" required placeholder="Read it in the server logs" /></label><label className="field"><span>Username</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required placeholder="Your name" /></label></>}
        <label className="field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setupRequired ? 'new-password' : 'current-password'} required minLength={setupRequired ? 12 : 1} placeholder={setupRequired ? 'At least 12 characters' : 'Your password'} /></label>
        {setupRequired && <div className="secure-hint"><ShieldCheck size={16} /> Your password is hashed on this server and can’t be recovered.</div>}
        {error && <div className="form-error">{error}</div>}
        <button className="button button-primary button-wide" disabled={busy}>{busy ? <Loader2 className="spin" size={17} /> : null}{setupRequired ? 'Create my space' : 'Sign in'}<ArrowRight size={17} /></button>
      </form>
      <div className="auth-bottom"><span>Encrypted locally</span><span className="auth-bottom-dot" /><span>No ads, ever</span><span className="auth-bottom-dot" /><span>Yours to keep</span></div>
    </div></div>
  </main>;
}

function Sidebar({ page, setPage, user, logout, mobileOpen, setMobileOpen }) {
  const nav = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, section: 'YOUR MONEY' },
    { id: 'transactions', label: 'Transactions', icon: ArrowDownLeft },
    { id: 'budgets', label: 'Budgets', icon: Target },
    { id: 'recurring', label: 'Recurring', icon: RefreshCw },
    { id: 'accounts', label: 'Accounts', icon: Wallet, section: 'PORTFOLIO' },
    { id: 'investments', label: 'Investments', icon: Gem },
    { id: 'assistant', label: 'AI assistant', icon: Sparkles, badge: 'BETA', section: 'YOUR TOOLS' }
  ];
  return <><div className={`sidebar-backdrop ${mobileOpen ? 'is-open' : ''}`} onClick={() => setMobileOpen(false)} />
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="sidebar-brand"><Brand /><button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
      <div className="profile-chip"><div className="profile-avatar">{(user || 'Y').slice(0, 1).toUpperCase()}</div><div className="profile-text"><strong>{user || 'Your space'}</strong><span>Personal account</span></div><ChevronDown size={15} className="muted-icon" /></div>
      <nav className="side-nav">{nav.map((item) => <div key={item.id}>{item.section && <div className="nav-section">{item.section}</div>}<button className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setMobileOpen(false); }}><item.icon size={17} strokeWidth={page === item.id ? 2.2 : 1.8} /><span>{item.label}</span>{item.badge && <b className="nav-badge">{item.badge}</b>}</button></div>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-card"><div className="privacy-icon"><LockKeyhole size={15} /></div><div><strong>Your data stays yours</strong><p>Stored on your server.<br />Never sold. Never shared.</p></div><CheckCircle2 size={15} className="privacy-check" /></div>
        <button className={`nav-item settings-nav ${page === 'settings' ? 'active' : ''}`} onClick={() => { setPage('settings'); setMobileOpen(false); }}><SettingsIcon size={17} /><span>Settings</span></button>
        <div className="sidebar-user"><div className="sidebar-user-avatar">{(user || 'Y').slice(0, 1).toUpperCase()}</div><div className="sidebar-user-meta"><strong>{user || 'You'}</strong><span>Private workspace</span></div><button className="icon-button logout-button" title="Sign out" onClick={logout}><LogOut size={16} /></button></div>
      </div>
    </aside>
  </>;
}

function PageHeader({ title, subtitle, action, mobileMenu }) {
  return <div className="page-heading"><div className="heading-title"><button className="icon-button mobile-menu" onClick={mobileMenu}><span className="hamburger"><i /><i /><i /></span></button><div><div className="breadcrumb">YOUR FINANCES <span>/</span> <b>{title.toUpperCase()}</b></div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div></div><div className="heading-actions">{action}</div></div>;
}

function StatCard({ label, value, note, tone = 'green', icon: Icon, chart }) {
  return <article className={`stat-card stat-${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><div className="stat-value">{value}</div><div className="stat-bottom"><span>{note}</span>{chart && <span className="stat-spark"><svg viewBox="0 0 70 22" aria-hidden="true"><path d={chart} /></svg></span>}</div></article>;
}

function ChartTooltip({ active, payload, label, type = 'money' }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><b>{label}</b>{payload.map((entry) => <span key={entry.dataKey}><i style={{ background: entry.color || entry.fill }} />{entry.name}: {type === 'money' ? preciseMoney.format(Number(entry.value) || 0) : entry.value}</span>)}</div>;
}

function EmptyChart({ icon: Icon, title, description, action }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={21} /></div><strong>{title}</strong><span>{description}</span>{action}</div>;
}

function Overview({ data, history, budgets, setPage, onAddAccount, onImport, onRefresh, busy, plaidEnabled }) {
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const month = new Date().toLocaleDateString('en-US', { month: 'long' });
  const topBudget = budgets.filter((row) => row.budget > 0).sort((a, b) => b.spent / b.budget - a.spent / a.budget)[0];
  return <>
    <PageHeader title="Overview" subtitle={`A clear look at your money, as of ${date}.`} mobileMenu={() => window.dispatchEvent(new Event('ledger:menu'))} action={<><button className="button button-quiet refresh-button" onClick={onRefresh} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} /><span>Refresh</span></button><button className="button button-primary" onClick={onAddAccount}><Plus size={17} /> Add account</button></>} />
    <section className="stat-grid">
      <StatCard label="Net worth" value={money.format(data?.netWorth || 0)} note={history.length > 1 ? `${history.length} snapshots recorded` : 'Across all your accounts'} icon={Activity} chart="M1 16 C12 15, 14 9, 24 13 S37 16, 47 8 S58 12, 69 4" />
      <StatCard label={`${month} income`} value={money.format(data?.income || 0)} note="Money in this month" icon={ArrowDownLeft} tone="sage" chart="M1 18 C10 18, 17 12, 26 15 S41 6, 50 9 S61 4, 69 3" />
      <StatCard label={`${month} spending`} value={money.format(data?.spending || 0)} note="Money out this month" icon={ArrowUpRight} tone="peach" chart="M1 5 C12 8, 14 3, 24 11 S37 10, 47 15 S60 12, 69 19" />
      <StatCard label="Cash flow" value={money.format(data?.cashFlow || 0)} note="Income minus spending" icon={TrendingUp} tone="blue" chart="M1 16 C9 13, 16 19, 26 11 S38 13, 48 8 S59 10, 69 3" />
    </section>
    {(!data?.accounts?.length) && <section className="welcome-card"><div className="welcome-art"><div className="welcome-orbit orbit-one"/><div className="welcome-orbit orbit-two"/><div className="welcome-coin">$</div><span className="welcome-star star-a">✳</span><span className="welcome-star star-b">✦</span></div><div className="welcome-copy"><div className="eyebrow">A GOOD PLACE TO START</div><h2>Bring the whole picture into focus.</h2><p>Add an account and Ledger will start drawing the lines between what you earn, spend, save, and owe.</p><div className="welcome-actions"><button className="button button-primary" onClick={onAddAccount}><Plus size={16} /> Add your first account</button>{plaidEnabled && <button className="button button-light" onClick={() => setPage('accounts')}><Landmark size={16} /> Connect a bank</button>}<button className="text-button" onClick={onImport}><Upload size={15} /> Import transactions</button></div></div><div className="welcome-step"><span>01</span><i /><b>YOUR FINANCES</b></div></section>}
    <section className="dashboard-grid charts-grid">
      <article className="panel worth-panel"><div className="panel-heading"><div><div className="panel-kicker">THE BIG PICTURE</div><h2>Net worth over time</h2></div><button className="select-control">Last 6 months <ChevronDown size={14} /></button></div>
        {history.length > 1 ? <div className="chart-wrap worth-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{ top: 18, right: 12, left: -18, bottom: 0 }}><defs><linearGradient id="worthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#55916b" stopOpacity={0.18}/><stop offset="95%" stopColor="#55916b" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0eb" /><XAxis dataKey="date" tickFormatter={(dateValue) => new Date(`${dateValue}T12:00:00`).toLocaleDateString('en-US', { month: 'short' })} axisLine={false} tickLine={false} tick={{ fill: '#9aa49c', fontSize: 11 }} tickMargin={10} /><YAxis tickFormatter={(v) => compactMoney.format(v)} axisLine={false} tickLine={false} tick={{ fill: '#9aa49c', fontSize: 11 }} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="netWorth" name="Net worth" stroke="#367552" strokeWidth={2.7} fill="url(#worthFill)" activeDot={{ r: 4, strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div> : <EmptyChart icon={TrendingUp} title="Your story starts here" description="As you add accounts and update balances, your net worth history will take shape." action={<button className="text-button" onClick={onAddAccount}>Add an account <ArrowRight size={14}/></button>} />}
        <div className="chart-legend"><span><i className="legend-line" /> Net worth</span>{history.length > 1 && <span className="chart-footnote">Your balances, captured daily</span>}</div>
      </article>
      <article className="panel cashflow-panel"><div className="panel-heading"><div><div className="panel-kicker">MONEY IN & OUT</div><h2>Cash flow</h2></div><button className="more-button" aria-label="More options"><MoreHorizontal size={19}/></button></div>
        {data?.monthly?.some((r) => r.income || r.spending) ? <><div className="cashflow-key"><span><i className="key-dot income-dot"/>Income</span><span><i className="key-dot spending-dot"/>Spending</span></div><div className="chart-wrap cashflow-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.monthly} barGap={5} margin={{ top: 12, right: 0, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="#edf0eb"/><XAxis dataKey="month" tickFormatter={(m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-US',{month:'short'})} axisLine={false} tickLine={false} tick={{ fill:'#9aa49c',fontSize:11 }} tickMargin={9}/><YAxis tickFormatter={(v)=>compactMoney.format(v)} axisLine={false} tickLine={false} tick={{fill:'#9aa49c',fontSize:10}}/><Tooltip content={<ChartTooltip/>}/><Bar dataKey="income" name="Income" fill="#7da887" radius={[4,4,0,0]} maxBarSize={16}/><Bar dataKey="spending" name="Spending" fill="#e6b184" radius={[4,4,0,0]} maxBarSize={16}/></BarChart></ResponsiveContainer></div></> : <EmptyChart icon={BarChart3} title="Cash flow, at a glance" description="Import or connect transactions to see how money moves each month." action={<button className="text-button" onClick={onImport}>Import a file <ArrowRight size={14}/></button>} />}
      </article>
    </section>
    <section className="dashboard-grid bottom-grid">
      <article className="panel recent-panel"><div className="panel-heading"><div><div className="panel-kicker">FRESH OFF THE LEDGER</div><h2>Recent transactions</h2></div><button className="link-button" onClick={() => setPage('transactions')}>See all <ArrowRight size={14}/></button></div>
        {data?.recent?.length ? <TransactionRows rows={data.recent.slice(0, 5)} compact /> : <EmptyChart icon={FileText} title="No transactions yet" description="Your imported and synced activity will show up here." action={<button className="text-button" onClick={onImport}>Import a file <ArrowRight size={14}/></button>} />}
      </article>
      <article className="panel categories-panel"><div className="panel-heading"><div><div className="panel-kicker">THIS MONTH</div><h2>Where it goes</h2></div><button className="link-button" onClick={() => setPage('budgets')}>Budgets <ArrowRight size={14}/></button></div>
        {data?.categorySpend?.length ? <><div className="category-chart-row"><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.categorySpend.slice(0, 6)} dataKey="amount" innerRadius={44} outerRadius={59} paddingAngle={3} stroke="none">{data.categorySpend.slice(0, 6).map((entry, index) => <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={(value) => preciseMoney.format(value)} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{money.format(data.spending)}</strong><span>TOTAL SPENT</span></div></div><div className="category-list">{data.categorySpend.slice(0, 5).map((entry, index) => <div className="category-line" key={entry.category}><i style={{background:COLORS[index%COLORS.length]}}/><span>{entry.category}</span><b>{money.format(entry.amount)}</b></div>)}</div></div></> : <EmptyChart icon={CreditCard} title="Your spending, sorted" description="Category totals appear after you add transactions." action={<button className="text-button" onClick={onImport}>Get started <ArrowRight size={14}/></button>} />}
        {topBudget && <button className="budget-nudge" onClick={() => setPage('budgets')}><span className="nudge-icon"><Target size={15}/></span><span><b>{topBudget.category}</b> is at {Math.round(topBudget.spent / topBudget.budget * 100)}% of its budget</span><ChevronRight size={16}/></button>}
      </article>
    </section>
  </>;
}

function TransactionRows({ rows, compact = false, categories, onCategoryChange }) {
  return <div className={`transaction-list ${compact ? 'transaction-list-compact' : ''}`}>
    {rows.map((txn) => <div className="transaction-row" key={txn.id}><div className={`merchant-avatar merchant-${txn.category?.toLowerCase().replace(/[^a-z]/g,'')}`}><span>{(txn.merchant || txn.description || '?').slice(0,1).toUpperCase()}</span></div><div className="transaction-main"><strong>{txn.merchant || txn.description}</strong><span>{new Date(`${txn.date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'})}{txn.account_name ? ` · ${txn.account_name}` : ''}</span></div><div className="transaction-category">{onCategoryChange ? <select value={txn.category} onChange={(e)=>onCategoryChange(txn.id,e.target.value)}>{categories.map((c)=><option key={c}>{c}</option>)}</select> : <Label>{txn.category}</Label>}</div><div className={`transaction-amount ${txn.amount>0?'positive':''}`}>{txn.amount>0?'+':''}{preciseMoney.format(txn.amount)}</div></div>)}
  </div>;
}

function TransactionsPage({ transactions, categories, search, setSearch, category, setCategory, loading, onImport, onAdd, onCategoryChange, onDelete }) {
  return <><PageHeader title="Transactions" subtitle="Every little move, all in one place." mobileMenu={() => window.dispatchEvent(new Event('ledger:menu'))} action={<><button className="button button-light" onClick={()=>onImport()}><Upload size={16}/> Import</button><button className="button button-primary" onClick={onAdd}><Plus size={17}/> Add transaction</button></>}/>
    <section className="panel transaction-page-panel"><div className="table-toolbar"><div className="search-field"><Search size={16}/><input placeholder="Search transactions" value={search} onChange={(e)=>setSearch(e.target.value)}/>{search&&<button onClick={()=>setSearch('')}><X size={14}/></button>}</div><div className="toolbar-right"><label className="select-wrap"><Filter size={14}/><select value={category} onChange={(e)=>setCategory(e.target.value)}><option>All categories</option>{categories.map((c)=><option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label><button className="button button-light button-small" onClick={()=>window.dispatchEvent(new Event('ledger:export'))}><Download size={15}/> Export</button></div></div>
      <div className="transaction-table-head"><span>TRANSACTION</span><span>CATEGORY</span><span>AMOUNT</span><span /></div>
      {loading ? <div className="loading-state"><Loader2 className="spin"/> Loading activity…</div> : transactions.length ? transactions.map((txn)=><div className="transaction-table-row" key={txn.id}><div className="transaction-table-name"><div className={`merchant-avatar merchant-${txn.category?.toLowerCase().replace(/[^a-z]/g,'')}`}><span>{(txn.merchant||txn.description||'?').slice(0,1).toUpperCase()}</span></div><div><strong>{txn.merchant||txn.description}</strong><span>{new Date(`${txn.date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}{txn.account_name?` · ${txn.account_name}`:''}</span></div></div><div className="transaction-table-category"><select value={txn.category} onChange={(e)=>onCategoryChange(txn.id,e.target.value)}>{categories.map((c)=><option key={c}>{c}</option>)}</select></div><div className={`transaction-table-amount ${txn.amount>0?'positive':''}`}>{txn.amount>0?'+':''}{preciseMoney.format(txn.amount)}</div><button className="row-more" title="Delete transaction" onClick={()=>onDelete(txn.id)}><MoreHorizontal size={17}/></button></div>) : <EmptyChart icon={Search} title="No transactions match" description="Try a different search or bring in activity from a file." action={<button className="text-button" onClick={()=>onImport()}>Import transactions <ArrowRight size={14}/></button>}/>}
      <div className="table-footer"><span>Showing {transactions.length} transactions</span><span>Amounts shown in USD</span></div>
    </section>
  </>;
}

function BudgetsPage({ budgets, categories, onSave }) {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(()=>{ setDraft(Object.fromEntries(budgets.map((row)=>[row.category,row.budget]))); },[budgets]);
  const rows = useMemo(()=>{
    const present = new Set(budgets.map((r)=>r.category));
    return [...budgets, ...categories.filter((c)=>c!=='Income'&&c!=='Transfer'&&!present.has(c)).map((category)=>({category,budget:0,spent:0}))];
  },[budgets,categories]);
  async function save(){setSaving(true);try{await onSave(rows.map((r)=>({category:r.category,amount:Number(draft[r.category])||0})));setSaved(true);setTimeout(()=>setSaved(false),1800);}finally{setSaving(false);}}
  const totalBudget=rows.reduce((sum,row)=>sum+(Number(draft[row.category])||0),0);
  const totalSpent=budgets.reduce((sum,row)=>sum+row.spent,0);
  return <><PageHeader title="Budgets" subtitle="Give every category a little breathing room." mobileMenu={() => window.dispatchEvent(new Event('ledger:menu'))} action={<button className="button button-primary" onClick={save} disabled={saving}>{saving?<Loader2 size={16} className="spin"/>:saved?<Check size={16}/>:<CheckCircle2 size={16}/>} {saved?'Saved':'Save changes'}</button>}/>
    <section className="budget-overview"><div className="budget-overview-copy"><div className="panel-kicker">{new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'}).toUpperCase()}</div><h2>Plan for what matters.</h2><p>A little structure makes room for the things that do.</p></div><div className="budget-total"><span>Planned this month</span><strong>{money.format(totalBudget)}</strong><div><span>Spent</span><b>{money.format(totalSpent)}</b><i /> <span>Left</span><b>{money.format(totalBudget-totalSpent)}</b></div></div><div className="budget-deco"><div/><div/><div/></div></section>
    <section className="panel budget-panel"><div className="panel-heading"><div><div className="panel-kicker">CATEGORY PLAN</div><h2>Your monthly budgets</h2></div><span className="budget-hint"><Target size={15}/> Set a limit that feels right</span></div>
      <div className="budget-table-head"><span>CATEGORY</span><span>SPENT THIS MONTH</span><span>MONTHLY LIMIT</span><span>REMAINING</span></div>
      {rows.map((row,index)=>{const budget=Number(draft[row.category])||0;const pct=budget?Math.min(100,row.spent/budget*100):0;const over=budget>0&&row.spent>budget;return <div className="budget-row" key={row.category}><div className="budget-category-name"><span className={`budget-category-icon budget-tone-${index%5}`}><CategoryIcon category={row.category}/></span><div><strong>{row.category}</strong><span>{row.spent>0?'Activity this month':'No activity yet'}</span></div></div><div className="budget-spent-cell"><strong>{money.format(row.spent)}</strong><div className="budget-progress"><i className={over?'over':''} style={{width:`${pct}%`}}/></div></div><div className="budget-input-wrap"><span>$</span><input type="number" min="0" step="25" value={draft[row.category]||''} placeholder="Set limit" onChange={(e)=>setDraft((curr)=>({...curr,[row.category]:e.target.value}))}/><span>/ mo</span></div><div className={`budget-remaining ${over?'over':''}`}>{budget?money.format(budget-row.spent):'—'}{over&&<span>Over budget</span>}</div></div>})}
      <div className="budget-footnote"><ShieldCheck size={15}/> Your budgets stay private on this server. Set a category to zero to remove its budget.</div>
    </section>
  </>;
}

function CategoryIcon({ category }) { const Icon = /housing/i.test(category)?Landmark:/grocer|dining/i.test(category)?Wallet:/transport/i.test(category)?ArrowRight:/health/i.test(category)?Activity:/entertain/i.test(category)?Sparkles:/travel/i.test(category)?ArrowUpRight:CreditCard;return <Icon size={16}/>; }

function RecurringPage({ recurring, onImport }) {
  const monthly=recurring.reduce((sum,row)=>sum+(row.cadence==='Monthly'?row.amount:row.cadence==='Weekly'?row.amount*4.33:row.cadence==='Biweekly'?row.amount*2.17:row.amount/12),0);
  return <><PageHeader title="Recurring" subtitle="The regulars, collected in one tidy place." mobileMenu={() => window.dispatchEvent(new Event('ledger:menu'))} action={<button className="button button-light" onClick={onImport}><Upload size={15}/> Import activity</button>}/>
    <section className="recurring-hero"><div className="recurring-hero-icon"><RefreshCw size={21}/></div><div className="recurring-hero-copy"><span>ESTIMATED RECURRING OUTFLOW</span><strong>{money.format(monthly)}<small> / month</small></strong><p>Based on patterns found in your transactions.</p></div><div className="recurring-hero-side"><div className="recurring-circle"><span>{recurring.length}</span><small>DETECTED</small></div></div><div className="recurring-line-art"><i/><i/><i/><i/></div></section>
    <section className="panel recurring-panel"><div className="panel-heading"><div><div className="panel-kicker">SUBSCRIPTIONS & BILLS</div><h2>What comes around</h2></div><span className="detected-label"><span/> {recurring.length} patterns found</span></div>
      {recurring.length ? <><div className="recurring-head"><span>MERCHANT</span><span>CADENCE</span><span>LAST PAYMENT</span><span>AMOUNT</span></div>{recurring.map((row,index)=><div className="recurring-row" key={`${row.merchant}-${row.lastDate}`}><div className="recurring-merchant"><div className={`merchant-avatar recurring-avatar tone-${index%4}`}><span>{row.merchant.slice(0,1).toUpperCase()}</span></div><div><strong>{row.merchant}</strong><span>{row.category} · {row.occurrences} payments seen</span></div></div><div><Label tone={row.cadence==='Monthly'?'sage':'default'}>{row.cadence}</Label></div><div className="recurring-date">{new Date(`${row.lastDate}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div><div className="recurring-amount">{preciseMoney.format(row.amount)}<small> / {row.cadence==='Weekly'?'wk':row.cadence==='Annual'?'yr':'mo'}</small></div></div>)}</> : <EmptyChart icon={RefreshCw} title="Patterns take a little time" description="After a few months of imported transactions, regular bills and subscriptions will appear here." action={<button className="button button-light" onClick={onImport}><Upload size={15}/> Import transactions</button>}/>}
      <div className="recurring-note"><CircleHelp size={15}/><span>Ledger looks for similar merchants, amounts, and timing. Patterns are estimates; check your statement for the exact bill.</span></div>
    </section>
  </>;
}

function AccountsPage({ accounts, plaidStatus, onAddAccount, onConnectBank, onSync, onDeleteAccount, onEditBalance, onImport, loading }) {
  const assets=accounts.filter((a)=>!['credit','loan','mortgage'].includes(a.type)).reduce((sum,a)=>sum+a.balance,0);
  const debt=accounts.filter((a)=>['credit','loan','mortgage'].includes(a.type)).reduce((sum,a)=>sum+Math.abs(a.balance),0);
  return <><PageHeader title="Accounts" subtitle="Everything you own and owe, in one place." mobileMenu={() => window.dispatchEvent(new Event('ledger:menu'))} action={<><button className="button button-light" onClick={onImport}><Upload size={15}/> Import</button><button className="button button-primary" onClick={onAddAccount}><Plus size={16}/> Add account</button></>}/>
    <section className="account-summary-strip"><div><span>TOTAL ASSETS</span><strong>{money.format(assets)}</strong></div><i/><div><span>TOTAL LIABILITIES</span><strong>{money.format(debt)}</strong></div><div className="summary-strip-action"><button className="link-button" onClick={onSync} disabled={loading}><RefreshCw size={14} className={loading?'spin':''}/> {plaidStatus?.enabled?'Sync balances':'Refresh view'}</button></div></section>
    <section className="panel accounts-panel"><div className="panel-heading"><div><div className="panel-kicker">YOUR FINANCIAL PICTURE</div><h2>Connected accounts</h2></div>{plaidStatus?.enabled?<button className="button button-light button-small" onClick={onConnectBank}><Landmark size={15}/> Connect bank</button>:<Label>Manual</Label>}</div>
      {accounts.length ? accounts.map((account)=>{const Icon=iconForType(account.type);return <div className="account-row" key={account.id}><div className={`account-icon account-${account.type}`}><Icon size={18}/></div><div className="account-info"><strong>{account.name}</strong><span>{account.institution} <i/> {account.subtype||account.type.replace('_',' ')}</span></div><div className="account-sync-status"><span className={`status-dot ${account.connected?'online':''}`}/>{account.connected?'Synced':'Manual'}</div><div className={`account-balance ${['credit','loan','mortgage'].includes(account.type)?'liability':''}`}>{['credit','loan','mortgage'].includes(account.type)?'−':''}{preciseMoney.format(Math.abs(account.balance))}</div><button className="button button-quiet button-small balance-edit" onClick={()=>onEditBalance(account)} disabled={account.connected}>Update</button>{!account.connected&&<button className="row-more" title="Remove account" onClick={()=>onDeleteAccount(account.id)}><MoreHorizontal size={18}/></button>}</div>}) : <EmptyChart icon={Wallet} title="Nothing connected yet" description="Add balances manually, link a supported bank, or import a statement." action={<div className="empty-actions"><button className="button button-primary" onClick={onAddAccount}><Plus size={15}/> Add an account</button>{plaidStatus?.enabled&&<button className="button button-light" onClick={onConnectBank}><Landmark size={15}/> Connect bank</button>}</div>}/>}
      <div className="accounts-foot"><span><span className={`status-dot ${accounts.some((account)=>account.connected)?'online':''}`}/> {accounts.some((account)=>account.connected)?'Bank sync enabled':'Balances stored locally'}</span><span>Last balance update is recorded in your net worth history.</span></div>
    </section>
    {!plaidStatus?.enabled&&<div className="integration-callout"><div className="callout-lock"><LockKeyhole size={16}/></div><div><strong>Want automatic bank sync?</strong><p>Add Plaid sandbox or production credentials to your server environment, then restart Ledger. Your access tokens are encrypted in the local database.</p></div><button className="link-button" onClick={()=>window.dispatchEvent(new Event('ledger:settings'))}>Setup guide <ArrowRight size={14}/></button></div>}
  </>;
}

function InvestmentsPage({ holdings, history, holdingsHistory, accounts, onAddAccount }) {
  const investmentAccounts=accounts.filter((a)=>a.type==='investment');
  const total=investmentAccounts.reduce((sum,account)=>sum+account.balance,0);
  const latestDate=holdingsHistory.at(-1)?.date;
  const latestPositions=holdingsHistory.filter((row)=>row.date===latestDate).sort((a,b)=>b.value-a.value).slice(0,5);
  const topPositions=latestPositions.map((row,index)=>({...row,key:`position${index}`}));
  const historyDates=[...new Set(holdingsHistory.map((row)=>row.date))].sort();
  const positionValues=new Map(holdingsHistory.map((row)=>[`${row.date}|${row.security_id}`,row.value]));
  const positionHistory=historyDates.map((date)=>{
    const point={date};
    for(const position of topPositions){point[position.key]=positionValues.get(`${date}|${position.security_id}`)??null;}
    return point;
  });
  return <><PageHeader title="Investments" subtitle="Your holdings, without the noise." mobileMenu={() => window.dispatchEvent(new Event('ledger:menu'))} action={<button className="button button-light" onClick={onAddAccount}><Plus size={15}/> Add investment account</button>}/>
    <section className="investment-summary"><div className="investment-value"><span>PORTFOLIO VALUE</span><strong>{money.format(total)}</strong><p>From connected or manually updated account balances</p></div><div className="investment-mini"><div className="investment-mini-icon"><TrendingUp size={19}/></div><span>{holdings.length} holdings</span><strong>{investmentAccounts.length} accounts</strong></div><div className="investment-decoration"><i/><i/><i/></div></section>
    <section className="panel portfolio-history-panel"><div className="panel-heading"><div><div className="panel-kicker">BALANCES CAPTURED DAILY</div><h2>Portfolio value over time</h2></div><span className="holdings-currency">From your recorded account balances</span></div>{history.length>1?<div className="portfolio-history-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{top:15,right:14,left:-15,bottom:0}}><defs><linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#79a57b" stopOpacity={.2}/><stop offset="100%" stopColor="#79a57b" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0eb"/><XAxis dataKey="date" tickFormatter={(dateValue)=>new Date(`${dateValue}T12:00:00`).toLocaleDateString('en-US',{month:'short',year:'2-digit'})} axisLine={false} tickLine={false} tick={{fill:'#9aa49c',fontSize:10}} tickMargin={9}/><YAxis tickFormatter={(v)=>compactMoney.format(v)} axisLine={false} tickLine={false} tick={{fill:'#9aa49c',fontSize:10}}/><Tooltip content={<ChartTooltip/>}/><Area type="monotone" dataKey="value" name="Portfolio value" stroke="#5a8b61" strokeWidth={2.5} fill="url(#portfolioFill)" activeDot={{r:4,strokeWidth:2}}/></AreaChart></ResponsiveContainer></div>:<EmptyChart icon={TrendingUp} title="Your investment history starts here" description="Ledger records the total value of your investment accounts with each daily snapshot and balance sync."/>}</section>
    <section className="panel holdings-history-panel"><div className="panel-heading"><div><div className="panel-kicker">TOP CURRENT POSITIONS</div><h2>Holdings over time</h2></div><span className="holdings-currency">Daily recorded value · top five</span></div>{historyDates.length>1&&topPositions.length?<div className="holdings-history-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={positionHistory} margin={{top:14,right:14,left:-15,bottom:0}}><CartesianGrid vertical={false} stroke="#edf0eb"/><XAxis dataKey="date" tickFormatter={(dateValue)=>new Date(`${dateValue}T12:00:00`).toLocaleDateString('en-US',{month:'short',year:'2-digit'})} axisLine={false} tickLine={false} tick={{fill:'#9aa49c',fontSize:10}} tickMargin={9}/><YAxis tickFormatter={(v)=>compactMoney.format(v)} axisLine={false} tickLine={false} tick={{fill:'#9aa49c',fontSize:10}}/><Tooltip content={<ChartTooltip/>}/><Legend iconType="circle" iconSize={6} wrapperStyle={{fontSize:9,color:'#849187'}} formatter={(value)=>String(value).length>20?`${String(value).slice(0,18)}…`:value}/>{topPositions.map((position,index)=><Line key={position.security_id} type="monotone" dataKey={position.key} name={position.ticker||position.name} stroke={COLORS[index%COLORS.length]} strokeWidth={2} dot={false} activeDot={{r:3}} connectNulls={false}/>)}</LineChart></ResponsiveContainer></div>:<EmptyChart icon={BarChart3} title="Position history builds daily" description={holdingsHistory.length?'Ledger has its first snapshot. Another daily snapshot will start the holdings trend.':'Connect an investment account with Plaid to record your positions and their values over time.'}/>}</section>
    <section className="panel holdings-panel"><div className="panel-heading"><div><div className="panel-kicker">PORTFOLIO</div><h2>Current holdings</h2></div><span className="holdings-currency">Values in USD</span></div>
      {holdings.length?<><div className="holdings-head"><span>ASSET</span><span>QUANTITY</span><span>PRICE</span><span>VALUE</span></div>{holdings.map((row,index)=><div className="holding-row" key={`${row.security_id}-${index}`}><div className="holding-asset"><div className="ticker-badge">{(row.ticker||row.name||'•').slice(0,2).toUpperCase()}</div><div><strong>{row.name}</strong><span>{row.ticker||row.account_name||'Investment'}</span></div></div><div>{Number(row.quantity).toLocaleString('en-US',{maximumFractionDigits:5})}</div><div>{preciseMoney.format(row.price)}</div><strong>{preciseMoney.format(row.value)}</strong></div>)}</>:<EmptyChart icon={Gem} title="Room to grow" description={investmentAccounts.length?'No holding details came back from the linked institution yet. Your account balance still appears in Net worth.':'Connect an investment account to see your positions and values here.'} action={!investmentAccounts.length&&<button className="button button-light" onClick={onAddAccount}><Plus size={15}/> Add investment account</button>}/>}
      <div className="holdings-note"><ShieldCheck size={15}/> Market values are provided by your connected bank and may not be real-time.</div>
    </section>
  </>;
}

function AssistantPage({ enabled, model, accounts, onSettings }) {
  const [messages,setMessages]=useState([{role:'assistant',content:'Hi there. I’ve got your latest finance summary ready. What would you like to understand?'}]);
  const [input,setInput]=useState(''); const [busy,setBusy]=useState(false);const bottom=useRef(null);
  useEffect(()=>bottom.current?.scrollIntoView({behavior:'smooth'}),[messages,busy]);
  async function send(text=input){const prompt=text.trim();if(!prompt||busy)return;const history=messages.slice(1).map((m)=>({role:m.role,content:m.content}));setMessages((prev)=>[...prev,{role:'user',content:prompt}]);setInput('');setBusy(true);try{const data=await request('/chat',{method:'POST',body:{message:prompt,history}});setMessages((prev)=>[...prev,{role:'assistant',content:data.reply}]);}catch(err){setMessages((prev)=>[...prev,{role:'assistant',content:`I couldn't reach the configured AI service. ${err.message}`}]);}finally{setBusy(false);}}
  const prompts=['How much did I spend on dining this month?','What bills are coming back regularly?','How does my budget look this month?'];
  return <><PageHeader title="AI assistant" subtitle="Ask a question. Get a clearer picture." mobileMenu={() => window.dispatchEvent(new Event('ledger:menu'))} action={<span className="ai-private-tag"><span/> PRIVATE CHAT</span>}/>
    <section className="assistant-layout"><div className="assistant-main panel"><div className="assistant-topline"><div className="assistant-mark"><Sparkles size={18}/></div><div><strong>Your money, in plain English.</strong><span>Answers grounded in your Ledger data</span></div><Label tone="sage">{enabled?'READY':'SETUP NEEDED'}</Label></div>
      <div className="assistant-messages">{messages.map((message,index)=><div className={`chat-message ${message.role}`} key={index}><div className="chat-avatar">{message.role==='assistant'?<Sparkles size={15}/>:<span>Y</span>}</div><div className="chat-bubble"><div className="chat-sender">{message.role==='assistant'?'LEDGER ASSISTANT':'YOU'}</div><p>{message.content}</p></div></div>)}{busy&&<div className="chat-message assistant"><div className="chat-avatar"><Sparkles size={15}/></div><div className="chat-bubble"><div className="chat-sender">LEDGER ASSISTANT</div><span className="typing"><i/><i/><i/></span></div></div>}<div ref={bottom}/></div>
      {messages.length===1&&<div className="prompt-suggestions">{prompts.map((prompt)=><button key={prompt} onClick={()=>send(prompt)} disabled={!enabled}>{prompt}<ArrowUpRight size={14}/></button>)}</div>}
      <form className="chat-composer" onSubmit={(e)=>{e.preventDefault();send();}}><input value={input} onChange={(e)=>setInput(e.target.value)} placeholder={enabled?'Ask about your spending, budgets, or cash flow…':'Configure a local AI model to start chatting'} disabled={!enabled||busy}/><button type="button" className="chat-attach" title="Financial data is included as context"><Paperclip size={17}/></button><button type="submit" className="send-button" disabled={!enabled||busy||!input.trim()}><Send size={16}/></button></form><div className="chat-disclaimer"><LockKeyhole size={13}/>{enabled?`Your question, account balances, budget progress, category totals, current investment holdings, 12 months of investment values, and up to 40 recent transaction details go to ${model||'your configured AI endpoint'}. Chat history is not saved.`:'AI is off until you configure a local Ollama model or an OpenAI-compatible API in your server environment.'}</div>
    </div><aside className="assistant-aside"><div className="assistant-side-card privacy-side"><div className="side-card-icon"><LockKeyhole size={18}/></div><div className="panel-kicker">PRIVATE BY DEFAULT</div><h3>Your data stays close.</h3><p>Your question goes with account balances, budget progress, category totals, investment holdings, and recent transaction details to the AI endpoint you configure. A local Ollama model keeps that conversation on your own server.</p><button className="link-button" onClick={onSettings}>AI settings <ArrowRight size={14}/></button><div className="privacy-orbit"/></div><div className="assistant-side-card connected-side"><div className="panel-kicker">CONTEXT INCLUDED</div><h3>Your current picture</h3><div className="context-item"><span>Connected accounts</span><b>{accounts.length}</b></div><div className="context-item"><span>Latest activity</span><b>Up to 40 transactions</b></div><div className="context-item"><span>Budget progress</span><b>Monthly categories</b></div><div className="context-item"><span>Investments</span><b>Holdings & history</b></div><div className="context-foot"><CheckCircle2 size={14}/> Read-only access</div></div></aside></section>
  </>;
}

function SettingsPage({ settings, onCreateToken, onDeleteToken, newestToken, setNewestToken }) {
  const [label,setLabel]=useState('Cursor / Claude'); const [copied,setCopied]=useState(false);
  return <><PageHeader title="Settings" subtitle="A few simple dials for your private finance space." mobileMenu={() => window.dispatchEvent(new Event('ledger:menu'))}/>
    <div className="settings-grid"><section className="panel settings-panel"><div className="settings-section"><div className="settings-section-icon"><ShieldCheck size={18}/></div><div className="settings-content"><div className="panel-kicker">YOUR ACCOUNT</div><h2>Private by default.</h2><p>This Ledger instance has one local account. Your password is stored as a one-way hash and your data is kept in a local SQLite database.</p><div className="settings-info-row"><span>Signed in as</span><strong>{settings?.username||'…'}</strong></div><div className="settings-info-row"><span>Data folder</span><code>./data</code></div></div></div>
      <div className="settings-divider"/><div className="settings-section"><div className="settings-section-icon purple"><Sparkles size={18}/></div><div className="settings-content"><div className="panel-kicker">AI ASSISTANT</div><h2>Choose where thinking happens.</h2><p>Ledger works best with Ollama running on this server. Your finance summary is sent only to the AI service configured in the server environment.</p><div className="integration-status"><span className={`status-dot ${settings?.ai?.enabled?'online':''}`}/><span>{settings?.ai?.enabled?`Configured · ${settings.ai.model}`:'Not configured'}</span><button className="link-button" onClick={()=>document.getElementById('ai-deploy-note')?.scrollIntoView({behavior:'smooth'})}>Configuration notes <ArrowRight size={14}/></button></div><div className="settings-note" id="ai-deploy-note"><b>On your server:</b> Set <code>OLLAMA_URL</code> and <code>OLLAMA_MODEL</code>, or supply an OpenAI-compatible base URL, key, and model. Restart Ledger to apply changes. See the README for Docker examples.</div></div></div>
      <div className="settings-divider"/><div className="settings-section"><div className="settings-section-icon blue"><Landmark size={18}/></div><div className="settings-content"><div className="panel-kicker">BANK CONNECTION</div><h2>Sync at your pace.</h2><p>Plaid access tokens are encrypted with an instance key stored alongside your database. The app checks for new transactions every six hours while Plaid refreshes institution data on its schedule.</p><div className="integration-status"><span className={`status-dot ${settings?.plaidEnabled?'online':''}`}/><span>{settings?.plaidEnabled?'Plaid is configured':'Plaid is not configured'}</span><span className="settings-spacer"/><span className="small-muted">Optional</span></div><div className="settings-note">Set <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code>, and <code>PLAID_ENV</code> in your server environment. Start with sandbox credentials.</div>{settings?.plaidInstitutions?.length>0&&<div className="linked-institutions">{settings.plaidInstitutions.map((item)=><div className="linked-institution" key={item.id}><div className="token-lock"><Landmark size={14}/></div><div className="token-label"><strong>{item.institution}</strong><span>Last sync {new Date(`${item.updated_at}Z`).toLocaleString()}</span></div><button className="button button-quiet button-small revoke-button" onClick={()=>window.dispatchEvent(new CustomEvent('ledger:disconnect-bank',{detail:{id:item.id,name:item.institution}}))}>Disconnect</button></div>)}</div>}</div></div>
      <div className="settings-divider"/><div className="settings-section mcp-section"><div className="settings-section-icon gold"><Zap size={18}/></div><div className="settings-content"><div className="panel-kicker">MODEL CONTEXT PROTOCOL</div><h2>Connect your tools.</h2><p>Issue a read-only token for MCP clients such as Claude Desktop or Cursor. The endpoint exposes summaries and finance queries, never write actions.</p>
        {newestToken&&<div className="new-token-box"><div><CheckCircle2 size={16}/><strong>Copy this token now</strong><span>It is shown only once and stored as a hash.</span></div><code>{newestToken}</code><button className="button button-light button-small" onClick={async()=>{await navigator.clipboard.writeText(newestToken);setCopied(true);setTimeout(()=>setCopied(false),1500);}}>{copied?<Check size={14}/>:<FileText size={14}/>} {copied?'Copied':'Copy token'}</button><button className="icon-button token-dismiss" onClick={()=>setNewestToken('')}><X size={15}/></button></div>}
        <div className="token-create-row"><input value={label} onChange={(e)=>setLabel(e.target.value)} placeholder="Token label"/><button className="button button-primary button-small" onClick={()=>onCreateToken(label)}><Plus size={15}/> Create read-only token</button></div>
        {settings?.mcpTokens?.length?<div className="token-list">{settings.mcpTokens.map((token)=><div className="token-row" key={token.id}><div className="token-lock"><LockKeyhole size={15}/></div><div className="token-label"><strong>{token.label}</strong><span>Created {new Date(token.created_at).toLocaleDateString()}{token.last_used_at?` · Last used ${new Date(`${token.last_used_at}Z`).toLocaleDateString()}`:' · Not used yet'}</span></div><button className="button button-quiet button-small revoke-button" onClick={()=>onDeleteToken(token.id)}>Revoke</button></div>)}</div>:<div className="no-tokens">No MCP tokens yet.</div>}
        <div className="settings-note"><b>Endpoint:</b> <code>/mcp</code> · <b>Transport:</b> Streamable HTTP · <b>Auth:</b> bearer token</div>
      </div></div>
    </section><aside className="settings-aside"><div className="setup-card"><div className="setup-card-orb"><ShieldCheck size={24}/></div><div className="panel-kicker">THE LEDGER PROMISE</div><h3>Your server.<br/>Your rules.</h3><p>Ledger is designed to keep the sensitive stuff close to home. You choose when to connect an institution or an AI service.</p><div className="promise-list"><span><Check size={14}/> Local-first database</span><span><Check size={14}/> Encrypted bank tokens</span><span><Check size={14}/> Read-only MCP tools</span><span><Check size={14}/> No tracking or ads</span></div></div><div className="settings-version"><Brand small/><span>Self-hosted personal finance</span></div></aside></div>
  </>;
}

function Modal({ title, subtitle, onClose, children, wide = false }) {
  useEffect(()=>{function key(e){if(e.key==='Escape')onClose();}window.addEventListener('keydown',key);document.body.classList.add('modal-open');return()=>{window.removeEventListener('keydown',key);document.body.classList.remove('modal-open');};},[onClose]);
  return <div className="modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><div className={`modal ${wide?'modal-wide':''}`}><div className="modal-heading"><div><div className="panel-kicker">LEDGER WORKSPACE</div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button modal-close" onClick={onClose}><X size={18}/></button></div>{children}</div></div>;
}

function AddAccountModal({ onClose, onAdd }) {
  const [form,setForm]=useState({name:'',institution:'',type:'checking',balance:''});const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{await onAdd({...form,balance:Number(form.balance)});onClose();}catch(err){setError(err.message);}finally{setBusy(false);}}
  return <Modal title="Add an account" subtitle="A simple balance is a good start. You can update it whenever you like." onClose={onClose}><form className="modal-form" onSubmit={submit}><label className="field"><span>Account name</span><input autoFocus placeholder="Everyday checking" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required/></label><label className="field"><span>Institution <small>Optional</small></span><input placeholder="Your bank or provider" value={form.institution} onChange={(e)=>setForm({...form,institution:e.target.value})}/></label><label className="field"><span>Account type</span><select value={form.type} onChange={(e)=>setForm({...form,type:e.target.value})}>{[['checking','Checking'],['savings','Savings'],['investment','Investment'],['credit','Credit card'],['loan','Loan'],['mortgage','Mortgage'],['cash','Cash'],['other_asset','Other asset']].map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label className="field"><span>Current balance</span><div className="input-prefix"><span>$</span><input type="number" step="0.01" placeholder="0.00" value={form.balance} onChange={(e)=>setForm({...form,balance:e.target.value})} required/></div></label>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy?<Loader2 size={16} className="spin"/>:<Plus size={16}/>} Add account</button></div></form></Modal>;
}

function AddTransactionModal({ onClose, onSave, categories, accounts }) {
  const today=new Date().toISOString().slice(0,10);
  const [form,setForm]=useState({date:today,description:'',amount:'',category:'Uncategorized',accountId:''});
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{await onSave({...form,amount:Number(form.amount),accountId:form.accountId||null});onClose();}catch(err){setError(err.message);}finally{setBusy(false);}}
  return <Modal title="Add a transaction" subtitle="Record a payment or a deposit by hand." onClose={onClose}><form className="modal-form" onSubmit={submit}><label className="field"><span>Description</span><input autoFocus placeholder="Coffee shop, paycheck…" value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} required/></label><label className="field"><span>Date</span><input type="date" value={form.date} onChange={(e)=>setForm({...form,date:e.target.value})} required/></label><label className="field"><span>Amount <small>Use a minus sign for spending</small></span><div className="input-prefix"><span>$</span><input type="number" step="0.01" placeholder="-24.50" value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})} required/></div></label><label className="field"><span>Category</span><select value={form.category} onChange={(e)=>setForm({...form,category:e.target.value})}>{categories.map((item)=><option key={item}>{item}</option>)}</select></label><label className="field"><span>Account <small>Optional</small></span><select value={form.accountId} onChange={(e)=>setForm({...form,accountId:e.target.value})}><option value="">No account</option>{accounts.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy?<Loader2 size={16} className="spin"/>:<Plus size={16}/>} Add transaction</button></div></form></Modal>;
}

function BalanceModal({ account, onClose, onSave }) {
  const [balance,setBalance]=useState(account.balance);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);try{await onSave(account.id,Number(balance));onClose();}catch(err){setError(err.message);}finally{setBusy(false);}}
  return <Modal title="Update balance" subtitle={`Update ${account.name}'s current balance.`} onClose={onClose}><form className="modal-form" onSubmit={submit}><label className="field"><span>Balance</span><div className="input-prefix"><span>$</span><input type="number" step="0.01" autoFocus value={balance} onChange={(e)=>setBalance(e.target.value)}/></div></label><div className="balance-update-note"><CalendarDays size={15}/> This update will be recorded in today's net worth snapshot.</div>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy?<Loader2 size={16} className="spin"/>:<Check size={16}/>} Save balance</button></div></form></Modal>;
}

function ImportModal({ onClose, accounts, onImport }) {
  const [file,setFile]=useState(null);const [accountId,setAccountId]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [result,setResult]=useState(null);const input=useRef(null);
  async function submit(e){e.preventDefault();if(!file)return;setBusy(true);setError('');try{const form=new FormData();form.append('file',file);if(accountId)form.append('accountId',accountId);const response=await onImport(form);setResult(response);}catch(err){setError(err.message);}finally{setBusy(false);}}
  return <Modal title={result?'Import complete':'Bring in your activity'} subtitle={result?'Your transactions are ready to explore.':'Import a CSV, OFX, or QFX file exported from your bank.'} onClose={onClose} wide>
    {result?<div className="import-success"><div className="success-mark"><CheckCircle2 size={25}/></div><h3>{result.imported} transactions added</h3><p>{result.skipped?`${result.skipped} duplicate or unreadable rows were skipped. `:''}Your history is ready.</p><button className="button button-primary" onClick={onClose}>View transactions <ArrowRight size={15}/></button></div>:<form onSubmit={submit} className="import-form"><button type="button" className={`drop-zone ${file?'has-file':''}`} onClick={()=>input.current?.click()} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();const chosen=e.dataTransfer.files?.[0];if(chosen)setFile(chosen);}}><input ref={input} type="file" accept=".csv,.ofx,.qfx,text/csv,application/x-ofx" hidden onChange={(e)=>setFile(e.target.files?.[0]||null)}/><div className="upload-icon">{file?<FileText size={22}/>:<Upload size={22}/>}</div><strong>{file?file.name:'Drop a statement here'}</strong><span>{file?`${(file.size/1024).toFixed(0)} KB · Click to choose a different file`:'or click to browse your files'}</span><div className="supported-files"><i>CSV</i><i>OFX</i><i>QFX</i></div></button><div className="import-options"><label className="field"><span>Assign to an account <small>Optional</small></span><select value={accountId} onChange={(e)=>setAccountId(e.target.value)}><option value="">No account</option>{accounts.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><div className="import-callout"><LockKeyhole size={16}/><span>Your file is processed on this server. Duplicate transactions are skipped automatically.</span></div></div>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><span className="upload-size-note">Max file size: 10 MB</span><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!file||busy}>{busy?<Loader2 size={16} className="spin"/>:<Upload size={16}/>} Import activity</button></div></form>}
  </Modal>;
}

function Toast({ toast, onClose }) { useEffect(()=>{if(!toast)return;const id=setTimeout(onClose,3600);return()=>clearTimeout(id);},[toast,onClose]);if(!toast)return null;return <div className={`toast ${toast.type||''}`}><span>{toast.type==='error'?<CircleHelp size={17}/>:<CheckCircle2 size={17}/>}</span>{toast.message}<button onClick={onClose}><X size={15}/></button></div>; }

export default function App() {
  const [status,setStatus]=useState(null);const [user,setUser]=useState('');const [page,setPage]=useState('overview');const [mobileOpen,setMobileOpen]=useState(false);
  const [data,setData]=useState({netWorth:0,assets:0,liabilities:0,income:0,spending:0,cashFlow:0,accounts:[],recent:[],monthly:[],categorySpend:[]});
  const [transactions,setTransactions]=useState([]);const [categories,setCategories]=useState([]);const [budgets,setBudgets]=useState([]);const [history,setHistory]=useState([]);const [investmentHistory,setInvestmentHistory]=useState([]);const [holdingsHistory,setHoldingsHistory]=useState([]);const [recurring,setRecurring]=useState([]);const [holdings,setHoldings]=useState([]);const [plaidStatus,setPlaidStatus]=useState({enabled:false,institutions:[]});const [settings,setSettings]=useState(null);
  const [search,setSearch]=useState('');const [category,setCategory]=useState('All categories');const [loading,setLoading]=useState(false);const [syncing,setSyncing]=useState(false);const [modal,setModal]=useState('');const [editingAccount,setEditingAccount]=useState(null);const [toast,setToast]=useState(null);const [newestToken,setNewestToken]=useState('');

  const notify=useCallback((message,type='success')=>setToast({message,type}),[]);
  const closeToast=useCallback(()=>setToast(null),[]);
  const loadEverything=useCallback(async()=>{
    setLoading(true);
    try{
      const [dashboard,txns,cats,budgetRows,worth,investmentWorth,positionHistory,bills,positions,plaid,settingRows]=await Promise.all([
        request('/dashboard'),request('/transactions'),request('/categories'),request('/budgets'),request('/net-worth'),request('/investment-history'),request('/holding-history'),request('/recurring'),request('/holdings'),request('/plaid/status'),request('/settings')
      ]);
      setData(dashboard);setTransactions(txns);setCategories(cats);setBudgets(budgetRows);setHistory(worth);setInvestmentHistory(investmentWorth);setHoldingsHistory(positionHistory);setRecurring(bills);setHoldings(positions);setPlaidStatus(plaid);setSettings(settingRows);
    }catch(err){if(err.message.includes('Sign in')){setUser('');setStatus((prev)=>({...prev,signedIn:false}));}else notify(err.message,'error');}
    finally{setLoading(false);}
  },[notify]);

  useEffect(()=>{request('/status').then(async(state)=>{setStatus(state);if(state.signedIn){try{const me=await request('/me');setUser(me.username);await loadEverything();}catch{setStatus({...state,signedIn:false});}}}).catch(()=>setStatus({setupRequired:true,signedIn:false}));},[loadEverything]);
  useEffect(()=>{const menu=()=>setMobileOpen(true);const settingsEvent=()=>setPage('settings');const exportEvent=()=>exportCsv();const disconnectEvent=(event)=>disconnectBank(event.detail.id,event.detail.name);window.addEventListener('ledger:menu',menu);window.addEventListener('ledger:settings',settingsEvent);window.addEventListener('ledger:export',exportEvent);window.addEventListener('ledger:disconnect-bank',disconnectEvent);return()=>{window.removeEventListener('ledger:menu',menu);window.removeEventListener('ledger:settings',settingsEvent);window.removeEventListener('ledger:export',exportEvent);window.removeEventListener('ledger:disconnect-bank',disconnectEvent);};});

  const authSuccess=async(name)=>{setUser(name);setStatus((prev)=>({...prev,signedIn:true,setupRequired:false}));await loadEverything();};
  async function logout(){await request('/auth/logout',{method:'POST'}).catch(()=>{});setUser('');setStatus((prev)=>({...prev,signedIn:false}));setPage('overview');}
  async function refresh(){setSyncing(true);try{if(plaidStatus.enabled)await request('/plaid/sync',{method:'POST'});await loadEverything();notify(plaidStatus.enabled?'Balances and transactions refreshed.':'Your finance data is up to date.');}catch(err){notify(err.message,'error');}finally{setSyncing(false);}}
  async function addAccount(body){await request('/accounts',{method:'POST',body});await loadEverything();notify('Account added.');}
  async function updateBalance(id,balance){await request(`/accounts/${id}`,{method:'PATCH',body:{balance}});await loadEverything();notify('Balance updated.');}
  async function deleteAccount(id){if(!window.confirm('Remove this account? Linked transactions will stay in your history.'))return;try{await request(`/accounts/${id}`,{method:'DELETE'});await loadEverything();notify('Account removed.');}catch(err){notify(err.message,'error');}}
  async function deleteTransaction(id){if(!window.confirm('Delete this transaction?'))return;try{await request(`/transactions/${id}`,{method:'DELETE'});await loadEverything();notify('Transaction removed.');}catch(err){notify(err.message,'error');}}
  async function changeCategory(id,value){try{await request(`/transactions/${id}`,{method:'PATCH',body:{category:value}});await loadEverything();}catch(err){notify(err.message,'error');}}
  async function addTransaction(body){await request('/transactions',{method:'POST',body});await loadEverything();notify('Transaction added.');}
  async function importFile(form){const result=await request('/import',{method:'POST',body:form});await loadEverything();notify(`${result.imported} transactions imported.`);return result;}
  async function saveBudgets(rows){const result=await request('/budgets',{method:'PUT',body:{budgets:rows}});setBudgets(result);const dashboard=await request('/dashboard');setData(dashboard);notify('Budget plan saved.');return result;}
  async function connectBank(){
    try{await ensurePlaidLoaded();const {linkToken}=await request('/plaid/link-token',{method:'POST'});const handler=window.Plaid.create({token:linkToken,onSuccess:async(publicToken)=>{try{await request('/plaid/exchange',{method:'POST',body:{publicToken}});await loadEverything();notify('Your bank account is connected.');}catch(err){notify(err.message,'error');}},onExit:(error)=>{if(error)notify(error.display_message||error.error_message||'Bank connection was not completed.','error');}});handler.open();}catch(err){notify(err.message,'error');}
  }
  async function createToken(label){try{const token=await request('/mcp-tokens',{method:'POST',body:{label}});setNewestToken(token.token);setSettings((curr)=>({...curr,mcpTokens:[{id:token.id,label:token.label,created_at:new Date().toISOString(),last_used_at:null},...(curr?.mcpTokens||[])]}));}catch(err){notify(err.message,'error');}}
  async function deleteToken(id){if(!window.confirm('Revoke this MCP token? Connected clients will lose access.'))return;try{await request(`/mcp-tokens/${id}`,{method:'DELETE'});setSettings((curr)=>({...curr,mcpTokens:curr.mcpTokens.filter((token)=>token.id!==id)}));notify('MCP token revoked.');}catch(err){notify(err.message,'error');}}
  async function disconnectBank(id,name){if(!window.confirm(`Disconnect ${name}? Its linked accounts will be removed from your account list. Existing transaction history will be kept.`))return;try{await request(`/plaid/items/${id}`,{method:'DELETE'});await loadEverything();notify(`${name} disconnected.`);}catch(err){notify(err.message,'error');}}

  const filteredTransactions=useMemo(()=>transactions.filter((txn)=>{
    const query=search.trim().toLowerCase();const matchesSearch=!query||`${txn.merchant||''} ${txn.description||''}`.toLowerCase().includes(query);const matchesCategory=category==='All categories'||txn.category===category;return matchesSearch&&matchesCategory;
  }),[transactions,search,category]);

  function exportCsv(){const rows=filteredTransactions;if(!rows.length){notify('There are no transactions to export.','error');return;}const csv=[['Date','Description','Category','Amount','Currency','Account'],...rows.map((t)=>[t.date,t.description,t.category,t.amount,t.currency,t.account_name||''])].map((row)=>row.map((v)=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const link=document.createElement('a');link.href=url;link.download='ledger-transactions.csv';link.click();URL.revokeObjectURL(url);}

  if(!status)return <div className="boot-screen"><Brand/><span><Loader2 size={17} className="spin"/> Opening your private workspace…</span></div>;
  if(!status.signedIn)return <><AuthScreen setupRequired={status.setupRequired} onAuthenticated={authSuccess}/><Toast toast={toast} onClose={closeToast}/></>;

  const titleMap={overview:'Overview',transactions:'Transactions',budgets:'Budgets',recurring:'Recurring',accounts:'Accounts',investments:'Investments',assistant:'AI assistant',settings:'Settings'};
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} user={user} logout={logout} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main className="main-area"><div className="content-wrap" key={page}>
    {page==='overview'&&<Overview data={data} history={history} budgets={budgets} setPage={setPage} onAddAccount={()=>setModal('account')} onImport={()=>setModal('import')} onRefresh={refresh} busy={syncing} plaidEnabled={plaidStatus.enabled}/>}
    {page==='transactions'&&<TransactionsPage transactions={filteredTransactions} categories={categories} search={search} setSearch={setSearch} category={category} setCategory={setCategory} loading={loading} onImport={()=>setModal('import')} onAdd={()=>setModal('transaction')} onCategoryChange={changeCategory} onDelete={deleteTransaction}/>}
    {page==='budgets'&&<BudgetsPage budgets={budgets} categories={categories} onSave={saveBudgets}/>}
    {page==='recurring'&&<RecurringPage recurring={recurring} onImport={()=>setModal('import')}/>}
    {page==='accounts'&&<AccountsPage accounts={data.accounts} plaidStatus={plaidStatus} onAddAccount={()=>setModal('account')} onConnectBank={connectBank} onSync={refresh} onDeleteAccount={deleteAccount} onEditBalance={(account)=>setEditingAccount(account)} onImport={()=>setModal('import')} loading={syncing}/>}
    {page==='investments'&&<InvestmentsPage holdings={holdings} history={investmentHistory} holdingsHistory={holdingsHistory} accounts={data.accounts} onAddAccount={()=>setModal('account')}/>}
    {page==='assistant'&&<AssistantPage enabled={settings?.ai?.enabled} model={settings?.ai?.model} accounts={data.accounts} onSettings={()=>setPage('settings')}/>}
    {page==='settings'&&<SettingsPage settings={settings} onCreateToken={createToken} onDeleteToken={deleteToken} newestToken={newestToken} setNewestToken={setNewestToken}/>}
    <footer className="app-footer"><span><LockKeyhole size={13}/> Your finances live on your server.</span><span>LEDGER <i>·</i> PRIVATE FINANCE</span></footer>
  </div></main>
    {modal==='account'&&<AddAccountModal onClose={()=>setModal('')} onAdd={addAccount}/>}{modal==='transaction'&&<AddTransactionModal onClose={()=>setModal('')} onSave={addTransaction} categories={categories} accounts={data.accounts}/>}{modal==='import'&&<ImportModal onClose={()=>setModal('')} accounts={data.accounts} onImport={importFile}/>}{editingAccount&&<BalanceModal account={editingAccount} onClose={()=>setEditingAccount(null)} onSave={updateBalance}/>}
    <Toast toast={toast} onClose={closeToast}/>
  </div>;
}
