import { useEffect, useState, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useBucket } from '../lib/BucketContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Plus } from 'lucide-react';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const formatINR = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
const USER_COLORS = ['#b8451f','#c9a449','#4a6b3a','#6b4d8a','#2e5a6b','#8a4a2e','#5a6b4a','#a8341e','#3d5a8a','#8a6b3d'];

const getContributions = (t) => {
  if (t.isSplit && Array.isArray(t.splitDetails) && t.splitDetails.length > 0) {
    return t.splitDetails.map(s => ({ name: s.name || 'Unknown', email: s.email, amount: s.amount || 0 }));
  }
  return [{ name: t.paidByName || 'Unknown', email: t.paidByEmail, amount: t.amount || 0 }];
};

const Dashboard = ({ onAddEntry }) => {
  const currentYear = new Date().getFullYear();
  const { activeBucket } = useBucket();
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(currentYear);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'transactions'));
        const all = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => t.bucketId === activeBucket.id)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setTxns(all);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, [activeBucket]);

  const totalAllYears = useMemo(() => txns.reduce((s, t) => s + (t.amount || 0), 0), [txns]);
  const years = useMemo(() => {
    const s = new Set(txns.map(t => t.year || new Date(t.date).getFullYear()));
    s.add(currentYear);
    return Array.from(s).sort((a, b) => b - a);
  }, [txns, currentYear]);

  const filtered = useMemo(() => txns.filter(t => (t.year || new Date(t.date).getFullYear()) === parseInt(year)), [txns, year]);
  const yearTotal = useMemo(() => filtered.reduce((s, t) => s + (t.amount || 0), 0), [filtered]);

  const usersInYear = useMemo(() => {
    const map = new Map();
    filtered.forEach(t => getContributions(t).forEach(c => map.set(c.name, (map.get(c.name) || 0) + c.amount)));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [filtered]);

  const monthlyData = useMemo(() => {
    const data = MONTHS.map(m => { const row = { month: m }; usersInYear.forEach(u => { row[u] = 0; }); return row; });
    filtered.forEach(t => {
      const idx = (t.month || (new Date(t.date).getMonth() + 1)) - 1;
      getContributions(t).forEach(c => { data[idx][c.name] = (data[idx][c.name] || 0) + c.amount; });
    });
    return data;
  }, [filtered, usersInYear]);

  const userTotals = useMemo(() => {
    const map = new Map();
    filtered.forEach(t => getContributions(t).forEach(c => {
      const key = c.email || c.name || 'Unknown';
      const prev = map.get(key) || { name: c.name, total: 0, count: 0 };
      prev.total += c.amount; prev.count += 1;
      map.set(key, prev);
    }));
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const modeTotals = useMemo(() => {
    const map = new Map();
    filtered.forEach(t => {
      const mode = t.mode || 'Unknown';
      const prev = map.get(mode) || { mode, total: 0, count: 0 };
      prev.total += t.amount || 0; prev.count += 1;
      map.set(mode, prev);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const StackTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const total = payload.reduce((s, p) => s + (p.value || 0), 0);
    const sorted = [...payload].filter(p => p.value > 0).sort((a, b) => b.value - a.value);
    return (
      <div style={{ background: '#1a1815', color: '#f4ede0', padding: '10px 14px', borderRadius: 4, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', minWidth: 180 }}>
        <div style={{ color: '#c9a449', fontFamily: 'Fraunces, serif', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{label}</div>
        {sorted.map(p => (
          <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 3 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, background: p.color, borderRadius: 2, display: 'inline-block' }}></span>{p.name}
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>₹{formatINR(p.value)}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid rgba(244,237,224,0.2)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
          <span>Total</span><span style={{ fontFamily: 'JetBrains Mono, monospace' }}>₹{formatINR(total)}</span>
        </div>
      </div>
    );
  };

  if (loading) return <div className="loading-shell"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="section-head">
        <div className="section-title-block">
          <span className="section-eyebrow">Overview — {activeBucket.name}</span>
          <h2>Dashboard</h2>
        </div>
        {onAddEntry && <button className="btn btn-primary" onClick={onAddEntry}><Plus size={14} /> Add an Entry</button>}
      </div>

      <div className="stat-grid">
        <div className="stat-card featured">
          <div className="stat-label">Total — All Years</div>
          <div className="stat-value"><span className="currency">₹</span>{formatINR(totalAllYears)}</div>
          <div className="stat-sub">{txns.length} transaction{txns.length !== 1 ? 's' : ''} on record</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Spent in {year}</div>
          <div className="stat-value"><span className="currency">₹</span>{formatINR(yearTotal)}</div>
          <div className="stat-sub">{filtered.length} transaction{filtered.length !== 1 ? 's' : ''} this year</div>
        </div>
      </div>

      <div className="card filter-card">
        <label className="label" style={{ marginBottom: 0 }}>Filter by year</label>
        <select className="select" value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ width: 'auto', minWidth: 140 }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="chart-card">
        <div className="chart-title">Monthly Spend — {year} <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>stacked by contributor</span></div>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ded2bd" />
            <XAxis dataKey="month" stroke="#6b6357" style={{ fontSize: 11 }} />
            <YAxis stroke="#6b6357" style={{ fontSize: 11 }} tickFormatter={v => `₹${formatINR(v)}`} />
            <Tooltip content={<StackTooltip />} cursor={{ fill: 'rgba(184,69,31,0.06)' }} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
            {usersInYear.map((u, i) => (
              <Bar key={u} dataKey={u} stackId="spend" fill={USER_COLORS[i % USER_COLORS.length]} radius={i === usersInYear.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="section-head">
        <div className="section-title-block">
          <span className="section-eyebrow">Breakdown</span>
          <h3 style={{ fontSize: '1.25rem' }}>Total paid — by user · {year}</h3>
        </div>
      </div>

      {userTotals.length === 0 ? (
        <div className="empty-state card"><h3>No transactions in {year}</h3><p>Add a transaction to get started.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="txn-table">
            <thead><tr><th>User</th><th>Contributions</th><th style={{ textAlign: 'right' }}>Total Paid</th></tr></thead>
            <tbody>
              {userTotals.map(u => (
                <tr key={u.name}>
                  <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: USER_COLORS[usersInYear.indexOf(u.name) % USER_COLORS.length], marginRight: 8, verticalAlign: 'middle' }}></span>{u.name}</td>
                  <td>{u.count}</td>
                  <td className="amount-cell" style={{ textAlign: 'right' }}>₹{formatINR(u.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: 'var(--cream-2)', fontWeight: 600 }}><td>Total</td><td>{userTotals.reduce((s, u) => s + u.count, 0)}</td><td className="amount-cell" style={{ textAlign: 'right' }}>₹{formatINR(yearTotal)}</td></tr></tfoot>
          </table>
        </div>
      )}

      {modeTotals.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 32 }}>
            <div className="section-title-block">
              <span className="section-eyebrow">Payment mix</span>
              <h3 style={{ fontSize: '1.25rem' }}>Top payment methods · {year}</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table className="txn-table">
              <thead><tr><th>Mode</th><th>Transactions</th><th style={{ textAlign: 'right' }}>Total Paid</th><th style={{ textAlign: 'right' }}>Share</th></tr></thead>
              <tbody>
                {modeTotals.map(m => {
                  const share = yearTotal > 0 ? (m.total / yearTotal) * 100 : 0;
                  return (
                    <tr key={m.mode}>
                      <td><span className={`mode-pill ${(m.mode || '').toLowerCase()}`}>{m.mode}</span></td>
                      <td>{m.count}</td>
                      <td className="amount-cell" style={{ textAlign: 'right' }}>₹{formatINR(m.total)}</td>
                      <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>{share.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr style={{ background: 'var(--cream-2)', fontWeight: 600 }}><td>Total</td><td>{filtered.length}</td><td className="amount-cell" style={{ textAlign: 'right' }}>₹{formatINR(yearTotal)}</td><td style={{ textAlign: 'right', fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}>100.0%</td></tr></tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
