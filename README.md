📧 Automatisierte Bestätigungsmails (lokal)

Mit diesem Projekt wird nach einer erfolgreichen Terminbuchung automatisch eine Bestätigungsmail an den Patienten gesendet.
Für lokale Entwicklung verwenden wir Mailtrap Sandbox (SMTP) – alle Mails werden abgefangen und nicht an echte Postfächer zugestellt.

✅ Was wird benötigt

- Node.js installiert

- Zugriff auf das Git-Repo (Branch main)

- Ein Mailtrap-Account -> können wir bei der Demo meinen nehmen

⚙️ Einrichtung (einmalig pro Person)

1. Pull damit alle neuen Änderungen drin sind
2. .env unter server erzeugen
Im Terminal in Unterordner server und dort nano .env
Dann in der Datei die Sachen aus .env.example (ist im Repo nach dem Pull unter server vorhanden)
da rein kopieren
3. Abhängigkeit installieren mit npm install
4. Server starten mit npm run dev und dann sollte man über die Webseite Termin buchen können
und eine Nachricht in Mailtrap bekommen

Ich habe alles getestet also es sollte aktuell alles funktionieren. Email ist aktuell sehr rudimentär 
aber das kann man ja noch ändern. Für die Präsentation kann ich mich dann einfach bei Mailtrap anmelden.

