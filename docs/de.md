# SABnzbd / NZBGet

Verfolge und steuere deine Usenet-Downloads aus Gladys: [SABnzbd](https://sabnzbd.org) und
[NZBGet](https://nzbget.com), die beiden Download-Clients, die auf den meisten Heimservern laufen
(Docker, Unraid, Synology, Proxmox…). Die Integration spricht mit der lokalen API des Clients:
Geschwindigkeit, Warteschlange und Restzeit erscheinen auf dem Dashboard, eine Szene kann die
Downloads während eines Videoanrufs pausieren und abends die Geschwindigkeit begrenzen, und Gladys
kann dir sagen, wenn ein Download fertig oder fehlgeschlagen ist.

Getestet mit echten SABnzbd- (4.2 und 5.1) und NZBGet-Installationen (21 und 26), noch nicht in
einem echten Gladys: Rückmeldungen sind willkommen auf
[GitHub](https://github.com/guim31/gladys-usenet/issues).

## Voraussetzungen

- Gladys 5.1.0 oder neuer.
- SABnzbd 3 oder neuer, oder NZBGet 21 oder neuer, vom Gladys-Server aus erreichbar (gleiches
  Netzwerk).
- Für SABnzbd: sein **API-Schlüssel** (Config → General → Security → API Key). Der NZB-Schlüssel
  direkt darunter reicht nicht: Er kann nur Aufträge hinzufügen.
- Für NZBGet: **Steuerungs-Benutzername und -Passwort** (Settings → Security → ControlUsername und
  ControlPassword, `nzbget` / `tegbzn6789`, solange du sie nicht änderst).

## Konfiguration

Bis zu zwei Clients, jeweils mit:

- **Software**: SABnzbd oder NZBGet.
- **Adresse**: IP-Adresse oder Name, mit Port: `192.168.1.10:8080` (SABnzbd) oder
  `192.168.1.10:6789` (NZBGet). Ohne Port wird der Standardport der Software ergänzt. Schreibe
  `https://` für HTTPS und den Pfad, wenn der Client hinter einem Reverse-Proxy liegt
  (`https://nas.example.org/sabnzbd`).
- **API-Schlüssel (SABnzbd)**, oder **Benutzername (NZBGet)** und **Passwort (NZBGet)**.
- **Name**: der Name des Geräts in Gladys (leer: die Software gefolgt von der Adresse).
- **Leitungsgeschwindigkeit (Mbit/s)**: deine Download-Geschwindigkeit, nötig, um mit NZBGet in
  Prozent zu begrenzen, und mit SABnzbd, wenn dort „Maximum line speed“ (Config → General) nicht
  gesetzt ist. 0: unbekannt.

Optionen:

- **Selbstsignierte Zertifikate akzeptieren**: für `https://`-Adressen mit dem Zertifikat, das
  SABnzbd erzeugt. Nur für deine eigenen Server aktivieren.
- **Aktualisierungsintervall**: wie oft die Clients gelesen werden, standardmäßig 30 Sekunden.
- **Sprache der Funktionsnamen**: die Namen der Funktionen beim Hinzufügen eines Geräts und die
  Statustexte (standardmäßig Französisch).

Die Schaltfläche **Verbindung testen** liest jeden Client und meldet, was sie gefunden hat:
Version, Status, Warteschlange, letzte Fehler.

## Geräte

Ein Gerät pro Client, im Tab Erkennung. Seine Funktionen:

| Funktion                      | Was sie zeigt                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Downloads pausiert            | Schalter: an pausiert die Downloads, bis du ihn ausschaltest, aus setzt sie fort.                               |
| Geschwindigkeitsbegrenzung    | Schieberegler, der Anteil der Leitung in %, 100 = ohne Begrenzung. Ihn zu bewegen begrenzt die Geschwindigkeit. |
| Download-Geschwindigkeit      | in MB/s.                                                                                                        |
| Aufträge in der Warteschlange | die wartenden oder laufenden Aufträge (ohne Nachbearbeitung).                                                   |
| Noch herunterzuladen          | in GB.                                                                                                          |
| Restzeit                      | in Minuten bei der aktuellen Geschwindigkeit, 0, wenn nichts heruntergeladen wird.                              |
| Freier Speicherplatz          | in GB, der Download-Ordner (der kleinere Wert aus temporärem und fertigem Ordner).                              |
| Status                        | Lädt herunter, Pausiert, Nachbearbeitung, Wartet, Leerlauf oder Nicht erreichbar.                               |
| Letzter Download              | der Name des zuletzt abgeschlossenen Downloads.                                                                 |
| Fehler (24 h)                 | die Fehler und Warnungen, die der Client in den letzten 24 Stunden gemeldet hat.                                |

Größen und Geschwindigkeiten sind binäre Einheiten, wie die Clients sie zeigen (1 MB = 1024 ×
1024 Bytes). Nur Änderungen werden an Gladys gesendet, und jeder Wert erneut nach 6 Stunden.

## Widget

Das Widget **Usenet-Downloads** zeigt Geschwindigkeit, Warteschlange und Restzeit aller Clients
(oder des in seinen Einstellungen gewählten), eine Zeile pro Client (Status, Ende einer zeitlich
begrenzten Pause, Begrenzung, freier Speicher, letzter Download, Fehler), und drei Tasten:

- **Pause**: pausiert die Downloads, bis du sie fortsetzt;
- **Pause 30 min**: pausiert sie für 30 Minuten;
- **Fortsetzen**: setzt sie fort.

Das Häkchen zeigt den aktuellen Zustand: auf **Pause**, wenn alles pausiert ist, auf
**Fortsetzen**, wenn alles herunterlädt.

## Szenen-Auslöser

- **Download abgeschlossen**: ein Auftrag wurde erfolgreich heruntergeladen und nachbearbeitet.
  Filter: der Client, die Kategorie (genau wie im Client geschrieben, `tv`, `Movies`…). Variablen:
  Name, Kategorie, Größe in MB, Name des Clients.
- **Download fehlgeschlagen**: ein Auftrag ist fehlgeschlagen (fehlende Artikel, Reparatur oder
  Entpacken unmöglich). Gleiche Filter; Variablen: Name, Kategorie, vom Client genannter Grund,
  Name des Clients.

Jeder Auftrag löst einmal aus. Aufträge, die fertig wurden, während die Integration gestoppt war
(ein Update, ein Neustart), lösen beim Neustart aus, wenn sie weniger als eine Stunde alt sind.

Es gibt keinen Auslöser „wenig Speicherplatz“: Die Funktion **Freier Speicherplatz** ist ein
Wert, und der Geräte-Auslöser von Gladys vergleicht ihn bereits mit einer Schwelle („Freier
Speicherplatz unter 20 GB“).

## Szenen-Aktionen

- **Downloads pausieren**: ein Client oder alle, für einige Minuten (0: bis zum Fortsetzen).
  Ausgaben: Anzahl der pausierten Clients, Dauer.
- **Downloads fortsetzen**: ein Client oder alle.
- **Download-Geschwindigkeit begrenzen**: ein Anteil der Leitung in %, 100 hebt die Begrenzung
  auf. Braucht die Leitungsgeschwindigkeit (siehe Konfiguration).

## Szenen-Beispiele

- Videoanruf: wenn der Kalendertermin „Meeting“ beginnt, **Downloads pausieren** für 60 Minuten.
- Abend: um 19 Uhr **Download-Geschwindigkeit begrenzen** auf 30 %; um 23 Uhr zurück auf 100 %.
- Benachrichtigung: bei **Download abgeschlossen** mit der Kategorie `tv` „{{triggerEvent.data.name}}
  ist bereit“ an die Familie senden.
- Problem: bei **Download fehlgeschlagen** Name und Grund an den Administrator senden.
- Speicher: wenn **Freier Speicherplatz** unter 20 GB fällt, pausieren und eine Nachricht senden.

## Fehlerbehebung

- „antwortet nicht“: Prüfe Adresse und Port, und ob der Gladys-Server den Client erreicht
  (Firewall, Docker-Netzwerk).
- „API-Schlüssel oder Passwort abgelehnt“: Korrigiere den Schlüssel oder das Passwort und
  speichere. Die Integration versucht es nicht von selbst erneut: Jeder abgelehnte Schlüssel
  erzeugt eine Warnung in SABnzbd.
- „Zertifikat abgelehnt“: Aktiviere „Selbstsignierte Zertifikate akzeptieren“, oder nutze
  `http://`.
- „kein SABnzbd oder NZBGet unter dieser Adresse“: falsche Software gewählt oder falscher Port.
- „die Adresse leitet um“: Gib die `https://`-Adresse ein.
- Eine Begrenzung in % abgelehnt: Gib die **Leitungsgeschwindigkeit (Mbit/s)** ein, oder setze
  „Maximum line speed“ in SABnzbd.
- Mehr Details: die Protokolle der Integration, mit `LOG_LEVEL=debug` für jede Abfrage.

## Grenzen

- Jede Aktualisierung liest die Warteschlange: standardmäßig alle 30 Sekunden, einige kleine
  Anfragen. NZBGet sendet seinen ganzen Verlauf auf einmal: Er wird nur neu gelesen, wenn sich
  etwas geändert hat, sonst höchstens alle 15 Minuten.
- NZBGet setzt eine zeitlich begrenzte Pause bis zu etwa 25 Sekunden zu spät fort (es prüft
  seinen Timer periodisch).
- Keine Auftragsverwaltung: Die Integration fügt keine Downloads hinzu, entfernt oder sortiert
  keine und löscht nichts.
- Die „Fehler (24 h)“ von NZBGet zählen die Meldungen, seit die Integration sein Protokoll liest
  (die letzten 100 beim Start).
- Nicht mit SABnzbd oder NZBGet verbunden.
