# Brisk

A small web framework for Node.js: routing, JSON bodies and middleware in one file, no dependencies.

## Install

```bash
npm install brisk-web
```

Requires Node.js 20 or newer.

## Hello world

```js
import { brisk } from 'brisk-web';

const app = brisk();

app.get('/', (req, res) => res.send('Hello world'));

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
```

Run it with `node server.js` and open http://localhost:3000.

## Routing

```js
app.get('/users/:id', (req, res) => res.json({ id: req.params.id }));
app.post('/users', async (req, res) => res.status(201).json(await req.json()));
```

## Middleware

```js
app.use(async (req, res, next) => {
  const started = Date.now();
  await next();
  console.log(req.method, req.url, `${Date.now() - started} ms`);
});
```

## License

MIT
