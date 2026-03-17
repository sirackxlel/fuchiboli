# Fuchiboli

App en React para ver los proximos partidos de Real Betis y Boca Juniors con una API propia.

## Uso

1. Ejecuta `npm install`.
2. Ejecuta `npm run dev`.

## Como funciona

- `GET /api/matches/boca`: scrapea ESPN.
- `GET /api/matches/betis`: scrapea LALIGA.
- `GET /api/matches`: devuelve ambos equipos juntos.

El frontend consume esos endpoints por proxy desde Vite.
