const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Brak klucza API na serwerze.' });
  }

  const { pdfBase64 } = req.body;
  if (!pdfBase64) {
    return res.status(400).json({ error: 'Brak pliku PDF.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        system: `Jesteś ekspertem ds. zamówień publicznych w Polsce. Analizujesz SWZ i wyciągasz kluczowe informacje. Odpowiedz TYLKO w JSON bez markdown:
{"subject":["..."],"requirements":["..."],"deadlines":["..."],"docs":["..."],"wadium":{"wymagane":true,"kwota":"np. 5 000 PLN lub null","forma":"np. pieniądz, gwarancja bankowa lub null","termin":"termin wniesienia lub null","uwagi":"dodatkowe informacje lub null"},"ocena":{"kryteria":[{"nazwa":"np. Cena","waga":60,"opis":"opis zasad oceny tego kryterium"}],"max_punktow":100,"uwagi":"dodatkowe uwagi lub null"},"flagi":[{"poziom":"wysoki/sredni/niski","tytul":"krótki tytuł flagi","opis":"dokładny opis ryzyka z cytatem lub odniesieniem do rozdziału SWZ"}],"draft":"..."}
Minimum 4 punkty w każdej kategorii tekstowej. Pole wadium i ocena ZAWSZE wypełnij — jeśli wadium nie wymagane ustaw wymagane:false. Pole flagi ZAWSZE wypełnij — szukaj aktywnie warunków które mogą skutkować ODRZUCENIEM oferty lub WYKLUCZENIEM wykonawcy: wymóg wizji lokalnej, specyficzne terminy, wymogi formalne podpisu, limity czasowe dostawy grożące odrzuceniem, specjalne koncesje, kary umowne, warunki techniczne trudne do spełnienia, niejasne zapisy. Każda flaga musi mieć poziom: wysoki (grozi odrzuceniem/wykluczeniem), sredni (wymaga uwagi), niski (warto wiedzieć). Minimum 3 flagi. Draft oferty profesjonalny, zgodny z PZP, z placeholderami [FIRMA], [DATA], [KWOTA].`,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: 'Przeanalizuj tę SWZ i zwróć wynik w formacie JSON.' }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Błąd Anthropic API' });
    }

    const data = await response.json();
    const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      // próba naprawy uciętego JSON
      const lastBrace = clean.lastIndexOf('}');
      if (lastBrace > -1) {
        try {
          parsed = JSON.parse(clean.substring(0, lastBrace + 1) + '}');
        } catch {
          return res.status(500).json({ error: 'Odpowiedź AI była zbyt długa. Spróbuj z krótszym dokumentem.' });
        }
      } else {
        return res.status(500).json({ error: 'Błąd parsowania odpowiedzi AI.' });
      }
    }

    res.json(parsed);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`sparkle SWZ analyzer running on port ${PORT}`);
});
