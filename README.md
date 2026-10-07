# Yahtzee Scoreblok

Een scoreblok voor Yahtzee zonder reclame. Het is een installeerbare webapp: je zet hem op het beginscherm van je iPhone of Samsung en daarna opent hij schermvullend, zonder balk van de browser. De scores staan op de server, dus wat je op de ene telefoon invult, zie je meteen op de andere.

- Bonus van 35 (bij 63 of meer), Yahtzee bonus en alle totalen worden zelf uitgerekend
- Een rij met gewonnen potjes per speler, over alle afgemaakte potjes
- Werkt ook zonder verbinding: wijzigingen wachten op de telefoon en gaan mee zodra er weer verbinding is
- Afgeschermd met één spelcode die je per toestel één keer invult

## Draaien

```bash
SPELCODE=geheim npm start      # http://localhost:3000
npm test
```

Geen dependencies, alleen Node 20 of nieuwer.

| Variabele | Betekenis |
|-----------|-----------|
| `SPELCODE` | De code die je op elk toestel invult. Hoofdletters, spaties eromheen en aanhalingstekens tellen niet mee. Leeg betekent geen code (alleen lokaal gebruiken). |
| `DATA_DIR` | Map voor `games.json`. In Docker is dat `/data`. |
| `PORT` | Standaard 3000. |

## Online zetten met Coolify

1. Nieuwe resource, kies deze repo, build pack **Dockerfile**.
2. Zet `SPELCODE` als environment variable.
3. Voeg een **persistent storage** toe met destination `/data`, anders ben je de scores kwijt bij elke deploy.
4. Geef hem een domein, bijvoorbeeld `yahtzee.jouwdomein.nl`, met HTTPS. Zonder HTTPS werkt installeren niet.

## Op je telefoon zetten

- **iPhone**: open het adres in Safari, tik op Deel en kies Zet op beginscherm.
- **Samsung**: open het adres in Chrome of Samsung Internet, tik op het menu en kies App installeren of Toevoegen aan startscherm.

Vul daarna één keer de spelcode in.

## Hoe het werkt

`public/apply.js` past één wijziging toe op de lijst met potjes en draait zowel in de browser als op de server. Elke wijziging zet een absolute waarde (dit vakje is 24), dus een wijziging twee keer versturen geeft hetzelfde resultaat. Daardoor kan de telefoon wijzigingen veilig opsparen als hij offline is. De server bewaart alles in één JSON-bestand en meldt nieuwe versies via Server-Sent Events.

De iconen maak je opnieuw met `python3 scripts/make-icons.py public/icons` (vereist Pillow).
