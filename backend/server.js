require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Camunda8 } = require('@camunda8/sdk');

const app = express();
app.use(cors());
app.use(express.json());

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
    const { termin } = job.variables;

    if (!termin) {
      return job.fail('Termin nije odabran', 8);
    }

    console.log(`odabir-termin: ${termin}`);
    const available = Math.random() < 0.7;
    console.log(`dostupnost: ${available}`);

    rezultati[String(job.processInstanceKey)] = { available };

    return job.complete({ termin, available });
  }
});

app.post('/start-process', async (req, res) => {
  try {
    const { usluga } = req.body;

    const reservationId = `res-${Date.now()}`;

    const result = await zeebe.createProcessInstance({
      bpmnProcessId: 'odabir-proces',
      version: -1,
      variables: { usluga, reservationId }
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
      variables: { termin },
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

app.listen(3001, () => console.log('Server radi na portu 3001'));