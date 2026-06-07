require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Camunda8 } = require('@camunda8/sdk');

const app = express();
app.use(cors());
app.use(express.json());

const { Pool } = require('pg');

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "frizerski_salon",
  password: "bazepodataka",
  port: 5432,
});

app.get('/usluge', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT usluga_id, naziv, trajanje, cijena FROM usluga'
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const camunda = new Camunda8();
const zeebe = camunda.getZeebeGrpcApiClient();


const rezultati = {};

zeebe.createWorker({
  taskType: 'odabir-usluga',
  taskHandler: async (job) => {
    console.log('odabir-usluga: ', job.variables);
    return job.complete({ usluga: job.variables.usluga });
  }
});

zeebe.createWorker({
  taskType: 'odabir-termin',
  pollInterval: 3000,
  taskHandler: async (job) => {
    const { termin, uslugaID } = job.variables;

    console.log('odabir-termin: ', job.variables);

    if (!termin) {
      return job.fail('Termin nije odabran', 8);
    }

    const [datum, pocetak] = termin.split('T');

    const uslugaResult = await pool.query(
      `
      SELECT trajanje
      FROM usluga
      WHERE usluga_id = $1
      `,
      [uslugaID]
    );

    if (uslugaResult.rows.length === 0) {
      return job.fail('Usluga ne postoji', 0);
    }

    const trajanje = uslugaResult.rows[0].trajanje;

    const [h, m] = pocetak.split(':').map(Number);

    let total = h * 60 + m + trajanje;

    const krajH = String(Math.floor(total / 60)).padStart(2, '0');
    const krajM = String(total % 60).padStart(2, '0');

    const krajTimestamp = `${datum}T${krajH}:${krajM}:00`;

    const pocetakTimestamp = `${datum}T${pocetak}:00`;

    console.log('POCETAK:', pocetakTimestamp);
    console.log('KRAJ:', krajTimestamp);

    const rezervacije = await pool.query(
          `SELECT 1 FROM rezervacija
          WHERE zaposlenik_id = 2
            AND datum_rezervacije = $1
            AND status != 'otkazana'
            AND (pocetak < $3 AND kraj > $2)
          LIMIT 1`,
          [datum, pocetakTimestamp, krajTimestamp]
        );

    const available = rezervacije.rows.length === 0;
    console.log('Rezervacije u konfliktu:', rezervacije.rows);

    rezultati[String(job.processInstanceKey)] = { available };

    return job.complete({ available, datum, pocetak: pocetakTimestamp, kraj: krajTimestamp});
  }
});

app.post('/start-process', async (req, res) => {
  try {
    const { uslugaID } = req.body;

    const reservationId = `res-${Date.now()}`;

    const result = await zeebe.createProcessInstance({
      bpmnProcessId: 'odabir-proces',
      version: -1,
      variables: { uslugaID, reservationId }
    });

    res.json({
      success: true,
      processInstanceKey: result.processInstanceKey,
      reservationId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/submit-termin', async (req, res) => {
  try {
    const { processInstanceKey, termin } = req.body;

    await zeebe.setVariables({
      elementInstanceKey: processInstanceKey,
      variables: {termin},
      local: false
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/process-status/:key', (req, res) => {
  const key = String(req.params.key);
  const rezultat = rezultati[key];

  if (rezultat) {
    delete rezultati[key];
    return res.json({ done: true, available: rezultat.available });
  }

  res.json({ done: false });
});

app.post('/potvrdi-rezervaciju', async (req, res) => {
  try {
    const { reservationId } = req.body;

    await zeebe.publishMessage({
      name: 'arrival-confirmed',
      correlationKey: reservationId,
      variables: { confirmed: true },
      timeToLive: 60000 
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

zeebe.createWorker({
  taskType: 'spremi-rezervaciju',
  taskHandler: async (job) => {
    const { uslugaID, datum, pocetak, kraj} = job.variables;

    await pool.query(
      `INSERT INTO rezervacija
       (usluga_id, zaposlenik_id, klijent_id, datum_rezervacije, pocetak, kraj, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'aktivna')`,
      [uslugaID, 2, 3, datum, pocetak, kraj]
    );

    return job.complete();
  }
});

app.listen(3001, () => console.log('Server radi na portu 3001'));