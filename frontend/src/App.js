import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API = 'http://localhost:3001';

export default function App() {
  const [korak, setKorak] = useState(0);
  const [usluga, setUsluga] = useState('');
  const [datum, setDatum] = useState('');
  const [sat, setSat] = useState('');
  const [processKey, setProcessKey] = useState(null);
  const [reservationId, setReservationId] = useState(null);
  const [available, setAvailable] = useState(null);
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef(null);
  const [usluge, setUsluge] = useState([]);

  useEffect(() => {
    const fetchUsluge = async () => {
      try {
        const { data } = await axios.get(`${API}/usluge`);
        setUsluge(data);
      } catch (e) {
        console.error('Greška pri dohvaćanju usluga', e);
      }
    };

    fetchUsluge();
  }, []);

  const nazivUsluge = (id) => {
    const odabrana = usluge.find(u => String(u.usluga_id) === String(id));
    return odabrana ? odabrana.naziv : id;
  };

  const danas = () => new Date().toISOString().split('T')[0];
  const dostupniSati = () => {
    const svi = Array.from({ length: 12 }, (_, i) => i + 8);
    if (datum !== danas()) return svi;
    const trenutniSat = new Date().getHours();
    return svi.filter(s => s > trenutniSat);
  };

  useEffect(() => () => clearInterval(pollingRef.current), []);

  const potvrdiUslugu = async () => {
    if (!usluga) return alert('Odaberi uslugu!');
    setLoading(true);
    try {
      const { data } = await axios.post(`http://localhost:3001/start-process`, { uslugaID: usluga });
      setProcessKey(data.processInstanceKey);
      setReservationId(data.reservationId);
      setKorak(1);
    } catch (e) {
      alert('Greška: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const potvrdiTermin = async () => {
    if (!datum || !sat) return alert('Odaberi datum i sat!');
    const termin = `${datum}T${String(sat).padStart(2, '0')}:00`;
    setLoading(true);
    try {
      await axios.post(`${API}/submit-termin`, { processInstanceKey: processKey, termin });
      setKorak(2);
      startPolling(processKey);
    } catch (e) {
      alert('Greška: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (key) => {
    pollingRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API}/process-status/${key}`);
        if (data.done) {
          clearInterval(pollingRef.current);
          setAvailable(data.available);
          if (!data.available) {
            alert('Termin nije dostupan!');
            setKorak(4);
          } else {
            setKorak(3);
          }
        }
      } catch {
      }
    }, 2000);
  };

  const potvrdiDolazak = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/potvrdi-rezervaciju`, { reservationId });
      setKorak(4);
    } catch (e) {
      alert('Greška: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const resetiraj = () => {
    clearInterval(pollingRef.current);
    setKorak(0);
    setUsluga('');
    setDatum('');
    setSat('');
    setProcessKey(null);
    setReservationId(null);
    setAvailable(null);
  };

  const page = {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', 
    padding: '2rem', background: '#fff5eb', fontFamily: "sans-serif"
  };
  const card = {
    background: '#ffffff', borderRadius: '12px', padding: '2.5rem 3rem', maxWidth: '420px',
    width: '100%', textAlign: 'center'
  };
  const btn = (bg = '#2563eb') => ({
    marginTop: '1.5rem', padding: '0.75rem 2rem', fontSize: '1rem', background: bg, 
    color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', width: '100%'
  });
  const field = {
    padding: '0.6rem 1rem', fontSize: '1rem', borderRadius: '8px', border: '1px solid #d1d5db',
    width: '100%', marginTop: '0.75rem', boxSizing: 'border-box'
  };
  const infoRow = {
    background: '#f9fafb', borderRadius: '8px', padding: '0.75rem 1rem',
    marginTop: '1rem', textAlign: 'left', fontSize: '0.95rem', color: '#374151'
  };


  if (korak === 0) return (
    <div style={page}><div style={card}>
      <h2>Odabir usluge</h2>
      <p style={{ color: '#6b7280' }}>Odaberite uslugu:</p>
      <select style={field} value={usluga} onChange={e => setUsluga(e.target.value)}>
        <option value="">-- Odaberi --</option>
        {usluge.map(u => <option key={u.usluga_id} value={u.usluga_id}>{u.naziv}</option>)}
      </select>
      <button style={btn()} onClick={potvrdiUslugu} disabled={loading}>
        {loading ? 'Slanje…' : 'Potvrdi uslugu'}
      </button>
    </div></div>
  );

  if (korak === 1) return (
    <div style={page}><div style={card}>
      <h2>Odabir termina</h2>
      <p style={{ color: '#6b7280' }}>Usluga: <strong>{nazivUsluge(usluga)}</strong></p>

      <label style={{ display: 'block', textAlign: 'left', marginTop: '1rem', fontSize: '0.9rem', color: '#374151' }}>
        Datum
      </label>
      <input type="date" style={field} value={datum} min={danas()}
        onChange={e => { setDatum(e.target.value); setSat(''); }} />

      <label style={{ display: 'block', textAlign: 'left', marginTop: '1rem', fontSize: '0.9rem', color: '#374151' }}>
        Sat
      </label>
      <select style={field} value={sat} onChange={e => setSat(e.target.value)} disabled={!datum}>
        <option value="">-- Odaberi sat --</option>
        {dostupniSati().map(s => (
          <option key={s} value={s}>{String(s).padStart(2, '0')}:00</option>
        ))}
      </select>

      {datum && dostupniSati().length === 0 && (
        <p style={{ color: '#dc2626', marginTop: '0.75rem', fontSize: '0.9rem' }}>
          Za danas nema više dostupnih termina. Odaberi drugi datum.
        </p>
      )}

      <button style={btn()} onClick={potvrdiTermin} disabled={loading || !datum || !sat}>
        {loading ? 'Slanje…' : 'Potvrdi termin'}
      </button>
    </div></div>
  );

  if (korak === 2) return (
    <div style={page}><div style={card}>
      <h2>Provjera dostupnosti…</h2>
      <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>Molimo pričekajte trenutak.</p>
    </div></div>
  );

  if (korak === 3) return (
    <div style={page}><div style={card}>
      <h2>Potvrdite rezervaciju</h2>
      <p style={{ color: '#6b7280', marginTop: '0.25rem' }}>Provjerite detalje i potvrdite:</p>

      <div style={infoRow}>
        <div><strong>Usluga:</strong> {nazivUsluge(usluga)}</div>
        <div style={{ marginTop: '0.4rem' }}>
          <strong>Termin:</strong> {datum} u {String(sat).padStart(2, '0')}:00
        </div>
      </div>

      <button style={btn('#16a34a')} onClick={potvrdiDolazak} disabled={loading}>
        {loading ? 'Slanje…' : '✓ Potvrdi rezervaciju'}
      </button>
      
    </div></div>
  );

  if (korak === 4) return (
    <div style={page}><div style={card}>
      {available ? (
        <>
          <h2 style={{ color: '#16a34a', marginTop: '0.5rem' }}>Rezervacija uspješna!</h2>
          <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>
            <strong>{nazivUsluge(usluga)}</strong><br />
            {datum} u {String(sat).padStart(2, '0')}:00
          </p>
        </>
      ) : (
        <>
          <h2 style={{ color: '#dc2626', marginTop: '0.5rem' }}>Termin nije dostupan</h2>
          <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>Odaberite drugi termin.</p>
        </>
      )}
      <button style={btn('#4b5563')} onClick={resetiraj}>Povratak na početak</button>
    </div></div>
  );
}