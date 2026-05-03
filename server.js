const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_ANALYZE = `Jesteś ekspertem ds. zamówień publicznych w Polsce. Analizujesz SWZ i wyciągasz kluczowe informacje. Odpowiedz TYLKO w JSON bez markdown, bez komentarzy:
{"subject":["..."],"requirements":["..."],"deadlines":["..."],"docs":["..."],"wadium":{"wymagane":false,"kwota":null,"forma":null,"termin":null,"uwagi":null},"ocena":{"kryteria":[{"nazwa":"Cena","waga":60,"opis":"opis"}],"max_punktow":100,"uwagi":null},"flagi":[{"poziom":"wysoki","tytul":"tytuł","opis":"opis z odniesieniem do rozdziału SWZ"}]}
Zasady: minimum 4 punkty w każdej kategorii tekstowej. Wadium ZAWSZE wypełnij — jeśli nie wymagane ustaw wymagane:false i resztę null. Ocena ZAWSZE wypełnij. Flagi ZAWSZE wypełnij — szukaj: limitów czasowych grożących odrzuceniem, wymaganych koncesji, wymogów podpisu elektronicznego, wizji lokalnej, podstaw wykluczenia. Poziomy: wysoki=grozi odrzuceniem, sredni=wymaga uwagi, niski=warto wiedzieć. Minimum 3 flagi. Odpowiedź musi być kompletnym, poprawnym JSON.`;

const SYSTEM_DRAFT = `Jesteś ekspertem ds. zamówień publicznych w Polsce. Na podstawie opisu SWZ wygeneruj profesjonalny draft oferty przetargowej zgodny z PZP. Użyj placeholderów [FIRMA], [NIP], [ADRES], [CENA], [DATA] itp. Zwróć TYLKO tekst draftu, bez JSON, bez markdown.`;

async function callAnthropic(system, pdfBase64, userText) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 6000,
      system,
      messages: [
        {
          role: 'user',
          content: pdfBase64 ? [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: userText }
          ] : [{ type: 'text', text: userText }]
        },
        {
          role: 'assistant',
          content: '{'
        }
      ]
    })
  });
  return response;
}

app.post('/api/analyze', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: 'Brak klucza API na serwerze.' });
  const { pdfBase64 } = req.body;
  if (!pdfBase64) return res.status(400).json({ error: 'Brak pliku PDF.' });

  try {
    const response = await callAnthropic(SYSTEM_ANALYZE, pdfBase64, 'Przeanalizuj tę SWZ i zwróć wynik w formacie JSON.');

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Błąd API' });
    }

    const data = await response.json();
    const raw = '{' + data.content.filter(b => b.type === 'text').map(b => b.text).join('');

    console.log('STOP REASON:', data.stop_reason);
    console.log('RAW (first 200):', raw.substring(0, 200));

    const lastBrace = raw.lastIndexOf('}');
    if (lastBrace === -1) {
      console.log('NO CLOSING BRACE FOUND');
      return res.status(500).json({ error: 'AI nie zwróciło poprawnej odpowiedzi. Spróbuj ponownie.' });
    }

    const jsonStr = raw.substring(0, lastBrace + 1);

    try {
      const parsed = JSON.parse(jsonStr);
      res.json(parsed);
    } catch (parseErr) {
      console.log('PARSE ERROR:', parseErr.message);
      console.log('JSON END (last 300):', jsonStr.substring(jsonStr.length - 300));
      return res.status(500).json({ error: 'Błąd parsowania odpowiedzi AI. Spróbuj ponownie.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/draft', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: 'Brak klucza API na serwerze.' });
  const { pdfBase64 } = req.body;
  if (!pdfBase64) return res.status(400).json({ error: 'Brak pliku PDF.' });

  try {
    const response = await callAnthropic(SYSTEM_DRAFT, pdfBase64, 'Wygeneruj draft oferty przetargowej dla tej SWZ.');

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Błąd API' });
    }

    const data = await response.json();
    const draft = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`sparkle SWZ analyzer running on port ${PORT}`);
});
