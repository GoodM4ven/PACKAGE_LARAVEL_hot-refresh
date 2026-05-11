<div align="center">بسم الله الرحمن الرحيم</div>
<div align="left">

# Laravel Blade & Livewire Hot Refresh

Inspired by [the famous plugin](https://github.com/defstudio/vite-livewire-plugin), this new Vite hot refresh plugin/runtime for Laravel apps supports both **pure Blade AND Livewire** hot-refreshes!

It avoids unnecessary full page reloads by:

- preserving CSS/JS HMR behavior via targeted updates
- morph-reloading Blade scene fragments when needed
- refreshing Livewire components when possible


## Installation

```bash
npm install --save-dev laravel-hot-refresh
```


## Usage

1. Register the plugin in Vite's configuration:

```js
// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import laravelHotRefresh from 'laravel-hot-refresh';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            // ! Important: disable default full reload flow to avoid conflicts.
            refresh: false,
        }),
        laravelHotRefresh({
            // Optional: defaults already cover Blade + Livewire + Filament + components.
            watch: [
                '**/resources/views/**/*.blade.php',
                '**/app/**/Livewire/**/*.php',
                '**/app/**/Filament/**/*.php',
                '**/app/View/Components/**/*.php',
            ],
            // Optional: extra assets to push as Vite updates when matched files change.
            refresh: ['resources/css/app.css', 'resources/js/app.js'],
            // Optional: checkbox distance from bottom (px) if opt-in UI is used.
            bottomPosition: 10,
        }),
    ],
});
```

2. Import the runtime once in your JS entry file:

```js
// resources/js/app.js
import 'laravel-hot-refresh';
```


## Notes

- Having `@vite(...)` in your Blade layout is essential.
- If your app still performs full reloads on Blade edits, ensure no other Vite plugin is forcing full reload for the same files, such as Laravel's default.
- The package exposes a compatibility virtual module (`virtual:laravel-hot-refresh`) and still supports legacy IDs used by older setups.

### Browser Caveats

Some browser features/extensions may block websocket updates or script behavior.

- **Brave Browser**: disable Shields for your local dev host (`localhost` / custom local domain), or at least disable script-blocking features for that site.
- Disable aggressive privacy/script extensions for your local dev URL while testing HMR.
- Hard refresh once after changing extension/privacy settings.

### My Development Setup

I use [`lara-stacker`](https://github.com/GoodM4ven/CLI_LARAVEL_lara-stacker) shared Docker setup for development in order to achieve quick project creation and real-time access, to all projects at once, and it works superbly with this package.


## Development

```bash
npm install
npm run check
```

- `npm run check` already runs lint + format check + `npm pack --dry-run`.
- Use `npm run lint` or `npm run format:check` when you want focused checks.
- CI workflow: `.github/workflows/ci.yml` (lint + format check + pack dry-run)
- Publish workflow: `.github/workflows/publish.yml` (manual or on GitHub Release publish)
    - On GitHub Release publish, tag `vX.Y.Z` is used to set package version before publish.
    - For publishing workflow to work, configure either npm trusted publishing (recommended), or `NPM_TOKEN` repository secret.


## Support

Support ongoing package maintenance as well as the development of **other projects** through [sponsorship](https://github.com/sponsors/GoodM4ven) or one-time [donations](https://github.com/sponsors/GoodM4ven?frequency=one-time&sponsor=GoodM4ven) if you prefer.


## Credits

- [Fabio Ivona](https://github.com/fabio-ivona) (The original [package](https://github.com/defstudio/vite-livewire-plugin) creator)
- [ChatGPT & Codex](https://developers.openai.com/codex)
- [Vite](https://vite.dev)
- [Laravel](https://laravel.com)
- [Livewire](https://livewire.laravel.com)
- [AlpineJS](https://alpinejs.dev)

</div>
<br>
<div align="center">والحمد لله رب العالمين</div>
