export const defaultWatches = [
    '**/resources/views/**/*.blade.php',
    '**/app/**/Livewire/**/*.php',
    '**/app/**/Filament/**/*.php',
    '**/app/View/Components/**/*.php',
];

export const defaultConfig = {
    watch: defaultWatches,
    refresh: [],
    bottomPosition: 10,
};

const VIRTUAL_MODULE_ID = 'virtual:laravel-hot-refresh';
const COMPAT_VIRTUAL_MODULE_IDS = [
    'virtual:livewire-hot-reload',
    'virtual:tailwind-hot-reload',
];
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

const toArray = (value) => {
    if (typeof value === 'undefined') {
        return [];
    }

    if (Array.isArray(value)) {
        return value;
    }

    return [value];
};

const normalizePath = (value) =>
    String(value)
        .replaceAll('\\', '/')
        .replace(/^[./]+/, '')
        .replace(/\/+/g, '/')
        .trim();

const normalizeWatchPattern = (pattern) => {
    const normalizedPattern = normalizePath(pattern);

    if (
        normalizedPattern.length === 0 ||
        normalizedPattern.startsWith('/') ||
        normalizedPattern.startsWith('**/') ||
        normalizedPattern.startsWith('*')
    ) {
        return normalizedPattern;
    }

    return `**/${normalizedPattern}`;
};

const segmentToRegExp = (segment) => {
    const escapedSegment = segment.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

    return new RegExp(`^${escapedSegment.replaceAll('*', '[^/]*')}$`);
};

const matchSegments = (patternSegments, fileSegments, patternIndex, fileIndex) => {
    if (patternIndex === patternSegments.length) {
        return fileIndex === fileSegments.length;
    }

    const patternSegment = patternSegments[patternIndex];

    if (patternSegment === '**') {
        if (patternIndex === patternSegments.length - 1) {
            return true;
        }

        for (let index = fileIndex; index <= fileSegments.length; index += 1) {
            if (matchSegments(patternSegments, fileSegments, patternIndex + 1, index)) {
                return true;
            }
        }

        return false;
    }

    if (fileIndex >= fileSegments.length) {
        return false;
    }

    if (!segmentToRegExp(patternSegment).test(fileSegments[fileIndex])) {
        return false;
    }

    return matchSegments(patternSegments, fileSegments, patternIndex + 1, fileIndex + 1);
};

const doesMatchPattern = (filePath, pattern) => {
    const normalizedPattern = normalizeWatchPattern(pattern);

    if (normalizedPattern.length === 0) {
        return false;
    }

    const patternSegments = normalizedPattern.split('/').filter(Boolean);
    const fileSegments = normalizePath(filePath).split('/').filter(Boolean);

    return matchSegments(patternSegments, fileSegments, 0, 0);
};

const resolvePluginConfig = (config) => {
    let resolvedConfig = config;

    if (typeof resolvedConfig === 'undefined') {
        resolvedConfig = { ...defaultConfig };
    }

    if (typeof resolvedConfig === 'string' || Array.isArray(resolvedConfig)) {
        resolvedConfig = {
            ...defaultConfig,
            watch: resolvedConfig,
        };
    }

    const watch =
        resolvedConfig.watch ?? resolvedConfig.defaultWatches ?? defaultConfig.watch;

    const refresh = resolvedConfig.refresh ?? defaultConfig.refresh;

    return {
        ...resolvedConfig,
        watch: toArray(watch)
            .map((pattern) => normalizeWatchPattern(pattern))
            .filter((pattern) => pattern.length > 0),
        refresh: toArray(refresh)
            .map((path) => normalizePath(path))
            .filter((path) => path.length > 0),
        bottomPosition:
            typeof resolvedConfig.bottomPosition === 'number'
                ? resolvedConfig.bottomPosition
                : defaultConfig.bottomPosition,
    };
};

const triggerAssetUpdates = (ctx, refreshList) => {
    const updates = [];

    for (const assetPath of refreshList) {
        const normalizedAssetPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;

        let type;

        if (assetPath.endsWith('.css')) {
            type = 'css-update';
        } else if (assetPath.endsWith('.js')) {
            type = 'js-update';
        } else {
            continue;
        }

        updates.push({
            type,
            path: normalizedAssetPath,
            acceptedPath: normalizedAssetPath,
            timestamp: Date.now(),
        });
    }

    if (updates.length > 0) {
        ctx.server.ws.send({
            type: 'update',
            updates,
        });
    }
};

const makeAssetUpdates = (refreshList) => {
    const updates = [];

    for (const assetPath of refreshList) {
        const normalizedAssetPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
        let type;

        if (assetPath.endsWith('.css')) {
            type = 'css-update';
        } else if (assetPath.endsWith('.js')) {
            type = 'js-update';
        } else {
            continue;
        }

        updates.push({
            type,
            path: normalizedAssetPath,
            acceptedPath: normalizedAssetPath,
            timestamp: Date.now(),
        });
    }

    return updates;
};

const triggerLivewireUpdate = (ctx, refreshList) => {
    const bladeUpdated = ctx.file.endsWith('.blade.php');
    const hasCssUpdate =
        bladeUpdated && refreshList.some((assetPath) => assetPath.endsWith('.css'));

    ctx.server.ws.send({
        type: 'custom',
        event: 'livewire-update',
        data: {
            blade_updated: bladeUpdated,
            file: normalizePath(ctx.file),
            has_css_update: hasCssUpdate,
        },
    });
};

const virtualModuleSource = (bottomPosition) => `
let lastLivewireUpdate = 0;
let suppressReloadUntil = 0;

const storageGet = (key, fallbackValue) => {
    try {
        return sessionStorage.getItem(key) ?? fallbackValue;
    } catch {
        return fallbackValue;
    }
};

const storageSet = (key, value) => {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        // ignore session storage errors in private browsers
    }
};

function initConflictingReloadCheck() {
    const setupConflictDetection = () => {
        if (storageGet('livewire_hot_reload_conflict', '0') === '1') {
            console.error('' +
                '[vite] Another Vite plugin reloaded page while ' +
                'livewire hot refresh was handling component update. ' +
                'Disable conflicting full page reload plugins for best results.');
        }

        storageSet('livewire_hot_reload_conflict', '0');

        window.addEventListener('beforeunload', () => {
            const now = Date.now();

            if (now - lastLivewireUpdate > 200) {
                return;
            }

            storageSet('livewire_hot_reload_conflict', '1');
        });
    };

    if (document.readyState === 'complete') {
        setupConflictDetection();
        return;
    }

    window.addEventListener('load', setupConflictDetection, { once: true });
}

function makeOptInCheckbox() {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cssText = 'width: 12px; height: 12px; cursor: pointer';
    checkbox.id = 'livewire_hot_reload';
    checkbox.checked = storageGet('livewire_hot_reload', '1') === '1';

    storageSet('livewire_hot_reload', checkbox.checked ? '1' : '0');
    console.log('[vite] livewire hot reload ' + (checkbox.checked ? 'enabled.' : 'disabled.'));

    checkbox.addEventListener('change', (event) => {
        const eventTarget = event.currentTarget;

        if (!(eventTarget instanceof HTMLInputElement)) {
            return;
        }

        storageSet('livewire_hot_reload', eventTarget.checked ? '1' : '0');
        console.log('[vite] livewire hot reload ' + (eventTarget.checked ? 'enabled.' : 'disabled.'));
    });

    return checkbox;
}

function makeOptInLabel() {
    const debugbarHeight = document.querySelector('.phpdebugbar, .clockwork-toolbar, .sf-toolbar')?.offsetHeight ?? 0;
    const calculatedBottomPosition = debugbarHeight + ${bottomPosition};
    const label = document.createElement('label');
    label.style.cssText = 'position: fixed; bottom: ' + calculatedBottomPosition + 'px; right: 10px; font-size: 12px; cursor: pointer';
    label.innerHTML += 'Livewire Hot Reload&nbsp;';

    return label;
}

function injectOptInCheckbox() {
    if (window.document.getElementById('livewire_hot_reload')) {
        return;
    }

    const label = makeOptInLabel();
    label.append(makeOptInCheckbox());
    window.document.body.insertBefore(label, window.document.body.lastChild);
}

function getLivewireComponents() {
    if (typeof Livewire === 'undefined') {
        return [];
    }

    if (typeof Livewire.all === 'function') {
        const allComponents = Livewire.all();

        if (Array.isArray(allComponents)) {
            return allComponents.filter(Boolean);
        }
    }

    if (Livewire.components?.componentsById && typeof Livewire.components.componentsById === 'object') {
        return Object.values(Livewire.components.componentsById).filter(Boolean);
    }

    return [];
}

function refreshComponent(component) {
    if (typeof component?.$wire?.$refresh === 'function') {
        component.$wire.$refresh();
        return true;
    }

    if (typeof component?.$wire?.call === 'function') {
        component.$wire.call('$refresh');
        return true;
    }

    if (typeof component?.call === 'function') {
        component.call('$refresh');
        return true;
    }

    return false;
}

function refreshLivewireComponents() {
    const components = getLivewireComponents();

    if (components.length === 0) {
        return false;
    }

    let refreshedCount = 0;

    components.forEach((component) => {
        if (refreshComponent(component)) {
            refreshedCount += 1;
        }
    });

    return refreshedCount > 0;
}

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function refreshLivewireComponentsWithRetry() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        if (refreshLivewireComponents()) {
            return true;
        }

        await wait(60);
    }

    return false;
}

export function livewire_hot_reload(hot, options = {}) {
    if (!hot) {
        return;
    }

    initConflictingReloadCheck();

    hot.on('vite:beforeFullReload', (payload) => {
        if (Date.now() > suppressReloadUntil) {
            return;
        }

        // Force Vite into the ".html path mismatch" branch so pageReload is skipped.
        payload.path = '/__goodm4ven_skip_reload__.html';
        console.log('[vite] skipped full reload (using hot refresh).');
    });

    if (Boolean(options.optIn)) {
        injectOptInCheckbox();
    } else {
        console.log('[vite] livewire hot reload enabled.');
    }

    hot.on('livewire-update', async (data) => {
        const checkbox = window.document.getElementById('livewire_hot_reload');
        const hasCssUpdate = Boolean(data?.has_css_update);
        const bladeUpdated = Boolean(data?.blade_updated);

        if (bladeUpdated && hasCssUpdate) {
            suppressReloadUntil = Date.now() + 3_000;
        }

        if (checkbox && !checkbox.checked) {
            if (hasCssUpdate) {
                console.log('[vite] css hot updated (livewire refresh disabled by checkbox).');
                return;
            }

            if (!bladeUpdated) {
                return;
            }

            console.log('[vite] blade updated (livewire refresh disabled by checkbox).');
            return;
        }

        if (!(await refreshLivewireComponentsWithRetry())) {
            if (hasCssUpdate) {
                console.log('[vite] css hot updated, no livewire instance found.');
                return;
            }

            console.log('[vite] blade updated, no livewire instance found.');
            return;
        }

        lastLivewireUpdate = Date.now();
        console.log('[vite] livewire hot updated.');
    });
}

export const laravel_hot_refresh = livewire_hot_reload;
`;

const shouldHandleFile = (filePath, patterns) =>
    patterns.some((pattern) => doesMatchPattern(filePath, pattern));

export default function laravelHotRefresh(config) {
    const pluginConfig = resolvePluginConfig(config);
    let suppressFullReloadUntil = 0;
    let websocketSendPatched = false;
    let pendingTailwindCssRefresh = false;
    let lastHotUpdateSignature = '';
    const patchedChannels = new WeakSet();

    const cssRefreshTargets = pluginConfig.refresh.filter((assetPath) =>
        assetPath.endsWith('.css'),
    );
    const jsRefreshTargets = pluginConfig.refresh.filter((assetPath) =>
        assetPath.endsWith('.js'),
    );

    const patchHmrChannel = (channel) => {
        if (!channel?.send || patchedChannels.has(channel)) {
            return;
        }

        const originalSend = channel.send.bind(channel);

        channel.send = (payload, ...args) => {
            if (
                payload?.type === 'full-reload' &&
                pendingTailwindCssRefresh &&
                Date.now() <= suppressFullReloadUntil
            ) {
                const cssUpdates = makeAssetUpdates(cssRefreshTargets);

                if (cssUpdates.length > 0) {
                    originalSend(
                        {
                            type: 'update',
                            updates: cssUpdates,
                        },
                        ...args,
                    );
                }

                pendingTailwindCssRefresh = false;
                return;
            }

            return originalSend(payload, ...args);
        };

        patchedChannels.add(channel);
    };

    const patchHmrSenders = (server) => {
        patchHmrChannel(server?.ws);
        patchHmrChannel(server?.hot);

        for (const environment of Object.values(server?.environments ?? {})) {
            patchHmrChannel(environment?.hot);
        }
    };

    return {
        name: 'goodm4ven-laravel-hot-refresh',
        enforce: 'pre',
        pluginConfig,
        configureServer(server) {
            if (websocketSendPatched) {
                return;
            }

            patchHmrSenders(server);

            websocketSendPatched = true;
        },
        resolveId(id) {
            if (id === VIRTUAL_MODULE_ID || COMPAT_VIRTUAL_MODULE_IDS.includes(id)) {
                return RESOLVED_VIRTUAL_MODULE_ID;
            }

            return undefined;
        },
        load(id) {
            if (id === RESOLVED_VIRTUAL_MODULE_ID) {
                return virtualModuleSource(pluginConfig.bottomPosition);
            }

            return undefined;
        },
        handleHotUpdate(ctx) {
            const normalizedHotFile = normalizePath(ctx.file);
            const currentSignature = `${normalizedHotFile}|${ctx.timestamp}`;

            // Vite may call this hook multiple times per file save (one per environment).
            if (currentSignature === lastHotUpdateSignature) {
                return undefined;
            }

            lastHotUpdateSignature = currentSignature;

            if (doesMatchPattern(ctx.file, '**/storage/framework/views/**/*.php')) {
                return undefined;
            }

            if (!shouldHandleFile(ctx.file, pluginConfig.watch)) {
                return undefined;
            }

            patchHmrSenders(ctx.server);

            const bladeUpdated = ctx.file.endsWith('.blade.php');
            const hasCssRefreshTarget = cssRefreshTargets.length > 0;

            if (bladeUpdated && hasCssRefreshTarget) {
                suppressFullReloadUntil = Date.now() + 45_000;
                pendingTailwindCssRefresh = true;
            }

            if (jsRefreshTargets.length > 0) {
                triggerAssetUpdates(ctx, jsRefreshTargets);
            }

            triggerLivewireUpdate(ctx, pluginConfig.refresh);

            return undefined;
        },
    };
}

const runtimeStorageGet = (key, fallbackValue) => {
    try {
        return sessionStorage.getItem(key) ?? fallbackValue;
    } catch {
        return fallbackValue;
    }
};

const runtimeStorageSet = (key, value) => {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        // ignore session storage errors in private browsers
    }
};

const runtimeNormalizeHotPath = (value) =>
    String(value ?? '')
        .replaceAll('\\', '/')
        .replace(/\/+/g, '/')
        .trim();

const RUNTIME_HOT_SCOPE = {
    LivewireOnly: 'livewire-only',
    ComponentOrPage: 'component-or-page',
    OtherBlade: 'other-blade',
    NonBlade: 'non-blade',
};

const runtimeResolveHotFileScope = (value) => {
    const normalizedPath = runtimeNormalizeHotPath(value);

    if (normalizedPath.length === 0) {
        return RUNTIME_HOT_SCOPE.NonBlade;
    }

    if (
        normalizedPath.includes('resources/views/livewire/') ||
        normalizedPath.includes('app/Livewire/') ||
        normalizedPath.includes('app/Filament/')
    ) {
        return RUNTIME_HOT_SCOPE.LivewireOnly;
    }

    if (
        normalizedPath.includes('resources/views/components/') ||
        normalizedPath.includes('app/View/Components/')
    ) {
        return RUNTIME_HOT_SCOPE.ComponentOrPage;
    }

    if (normalizedPath.endsWith('.blade.php')) {
        return RUNTIME_HOT_SCOPE.OtherBlade;
    }

    return RUNTIME_HOT_SCOPE.NonBlade;
};

const runtimeResolveWire = (componentLike) => {
    if (!componentLike) {
        return null;
    }

    if (componentLike.$wire && typeof componentLike.$wire === 'object') {
        return componentLike.$wire;
    }

    if (
        typeof componentLike.$refresh === 'function' ||
        typeof componentLike.$commit === 'function'
    ) {
        return componentLike;
    }

    return null;
};

const runtimeCollectLivewireWires = () => {
    if (typeof Livewire === 'undefined') {
        return [];
    }

    const wireMapById = new Map();
    const rememberWire = (candidate) => {
        const wire = runtimeResolveWire(candidate);

        if (!wire) {
            return;
        }

        const identifier =
            String(wire?.$id ?? wire?.id ?? wire?.__instance?.()?.id ?? '').trim() ||
            `wire-${wireMapById.size + 1}`;

        if (!wireMapById.has(identifier)) {
            wireMapById.set(identifier, wire);
        }
    };

    if (typeof Livewire.all === 'function') {
        const allComponents = Livewire.all();

        if (Array.isArray(allComponents)) {
            allComponents.forEach((component) => rememberWire(component));
        }
    }

    if (
        Livewire.components?.componentsById &&
        typeof Livewire.components.componentsById === 'object'
    ) {
        Object.values(Livewire.components.componentsById).forEach((component) =>
            rememberWire(component),
        );
    }

    return Array.from(wireMapById.values());
};

const runtimeIsTopLevelWire = (wire) => {
    const element = wire?.$el;

    if (!(element instanceof Element)) {
        return true;
    }

    const parentLivewireRoot = element.parentElement?.closest?.('[wire\\:id]');

    return !parentLivewireRoot;
};

const runtimeRefreshWire = async (wire) => {
    try {
        if (typeof wire?.$refresh === 'function') {
            await wire.$refresh();
            return true;
        }

        if (typeof wire?.$commit === 'function') {
            await wire.$commit();
            return true;
        }

        if (typeof wire?.$call === 'function') {
            await wire.$call('$refresh');
            return true;
        }
    } catch {
        return false;
    }

    return false;
};

const runtimeRefreshLivewireComponents = async () => {
    const wires = runtimeCollectLivewireWires();

    if (wires.length === 0) {
        return {
            refreshedCount: 0,
            hadRefresh: false,
        };
    }

    const topLevelWires = wires.filter((wire) => runtimeIsTopLevelWire(wire));
    const targetWires = topLevelWires.length > 0 ? topLevelWires : wires;
    const refreshResults = await Promise.allSettled(
        targetWires.map((wire) => runtimeRefreshWire(wire)),
    );
    const refreshedCount = refreshResults.reduce((count, result) => {
        if (result.status === 'fulfilled' && result.value === true) {
            return count + 1;
        }

        return count;
    }, 0);

    return {
        refreshedCount,
        hadRefresh: refreshedCount > 0,
    };
};

const runtimeWait = (milliseconds) =>
    new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });

const runtimeRefreshLivewireComponentsWithRetry = async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const refreshResult = await runtimeRefreshLivewireComponents();

        if (refreshResult.hadRefresh) {
            return refreshResult;
        }

        await runtimeWait(60);
    }

    return {
        refreshedCount: 0,
        hadRefresh: false,
    };
};

const RUNTIME_SINGLETON_KEY = '__goodm4venLaravelHotRefreshRuntime';

const runtimeDisableNavigateTrackedAssetsForCurrentDocument = () => {
    const trackedAssets = document.head.querySelectorAll('[data-navigate-track]');

    trackedAssets.forEach((assetElement) => {
        assetElement.removeAttribute('data-navigate-track');
    });

    return trackedAssets.length;
};

const runtimeMorphCurrentSceneWithoutNavigation = async () => {
    const requestUrl = `${window.location.pathname}${window.location.search}`;
    const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
        credentials: 'same-origin',
    });

    if (!response.ok) {
        return false;
    }

    const html = await response.text();
    const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
    const currentSceneRoot =
        document.querySelector('[x-hash-actions]') ??
        document.querySelector('[data-view-tree]') ??
        document.body?.firstElementChild;
    const nextSceneRoot =
        parsedDocument.querySelector('[x-hash-actions]') ??
        parsedDocument.querySelector('[data-view-tree]') ??
        parsedDocument.body?.firstElementChild;

    if (!currentSceneRoot || !nextSceneRoot) {
        return false;
    }

    nextSceneRoot.querySelectorAll('script').forEach((scriptElement) => {
        scriptElement.remove();
    });

    if (typeof window.Alpine?.morph === 'function') {
        window.Alpine.morph(currentSceneRoot, nextSceneRoot.outerHTML, {
            updating(element, nextElement, _childrenOnly, skip) {
                if (!(element instanceof Element) || !(nextElement instanceof Element)) {
                    return;
                }

                if (
                    element.hasAttribute('wire:id') ||
                    nextElement.hasAttribute('wire:id')
                ) {
                    skip();
                }
            },
        });
    } else {
        currentSceneRoot.innerHTML = nextSceneRoot.innerHTML;
    }

    return true;
};

const runtimeReloadCurrentScene = (reason, delay = 40) => {
    console.log(reason);

    window.setTimeout(async () => {
        try {
            const strippedTrackedAssetsCount =
                runtimeDisableNavigateTrackedAssetsForCurrentDocument();

            if (strippedTrackedAssetsCount > 0) {
                console.log(
                    `[vite] stripped ${strippedTrackedAssetsCount} navigate-track asset marker(s) before scene reload.`,
                );
            }

            if (await runtimeMorphCurrentSceneWithoutNavigation()) {
                console.log('[vite] used non-navigation scene morph reload.');
                return;
            }

            console.warn(
                '[vite] scene morph reload failed; keeping current scene unchanged.',
            );
            return;
        } catch {
            console.warn(
                '[vite] scene morph reload errored; keeping current scene unchanged.',
            );
        }
    }, delay);
};

const initBrowserLivewireHotReload = (hot) => {
    let runtimeLastLivewireUpdate = 0;
    let runtimeSuppressReloadUntil = 0;
    const listeners = [];
    const registerWindowListener = (eventName, handler, options) => {
        window.addEventListener(eventName, handler, options);
        listeners.push(() => {
            window.removeEventListener(eventName, handler, options);
        });
    };
    const registerHotListener = (eventName, handler) => {
        hot.on(eventName, handler);
        listeners.push(() => {
            if (typeof hot.off === 'function') {
                hot.off(eventName, handler);
            }
        });
    };

    const setupConflictDetection = () => {
        if (runtimeStorageGet('livewire_hot_reload_conflict', '0') === '1') {
            console.error(
                '[vite] Another Vite plugin reloaded page while livewire hot refresh was handling component update.',
            );
        }

        runtimeStorageSet('livewire_hot_reload_conflict', '0');

        registerWindowListener('beforeunload', () => {
            if (Date.now() - runtimeLastLivewireUpdate > 200) {
                return;
            }

            runtimeStorageSet('livewire_hot_reload_conflict', '1');
        });
    };

    if (document.readyState === 'complete') {
        setupConflictDetection();
    } else {
        registerWindowListener('load', setupConflictDetection, { once: true });
    }

    registerHotListener('vite:beforeFullReload', (payload) => {
        if (Date.now() > runtimeSuppressReloadUntil) {
            return;
        }

        payload.path = '/__goodm4ven_skip_reload__.html';
        console.log('[vite] skipped full reload (using hot refresh).');
    });

    registerHotListener('livewire-update', async (data) => {
        const hasCssUpdate = Boolean(data?.has_css_update);
        const bladeUpdated = Boolean(data?.blade_updated);
        const updatedFile = runtimeNormalizeHotPath(data?.file);
        const hotFileScope = runtimeResolveHotFileScope(updatedFile);

        if (bladeUpdated && hasCssUpdate) {
            runtimeSuppressReloadUntil = Date.now() + 45_000;
        }

        if (
            bladeUpdated &&
            (hotFileScope === RUNTIME_HOT_SCOPE.ComponentOrPage ||
                hotFileScope === RUNTIME_HOT_SCOPE.OtherBlade)
        ) {
            // We are handling this update ourselves (soft scene reload),
            // so suppress Vite's trailing full-reload event.
            runtimeSuppressReloadUntil = Date.now() + 8_000;
            runtimeReloadCurrentScene(
                '[vite] blade component/page updated, reloading scene.',
            );
            return;
        }

        const refreshResult = await runtimeRefreshLivewireComponentsWithRetry();

        if (!refreshResult.hadRefresh) {
            if (hasCssUpdate) {
                console.log('[vite] css hot updated, no livewire instance found.');
                return;
            }

            if (bladeUpdated) {
                runtimeSuppressReloadUntil = Date.now() + 8_000;
                runtimeReloadCurrentScene(
                    '[vite] blade updated, livewire refresh not applied. Reloading scene.',
                    80,
                );
                return;
            }

            console.log('[vite] blade updated, no livewire instance found.');
            return;
        }

        runtimeLastLivewireUpdate = Date.now();

        if (bladeUpdated && hasCssUpdate) {
            runtimeSuppressReloadUntil = Date.now() + 45_000;
        }

        console.log('[vite] livewire hot updated.');
    });

    console.log('[vite] livewire hot reload enabled.');

    return () => {
        while (listeners.length > 0) {
            const remove = listeners.pop();
            remove?.();
        }
    };
};

if (typeof window !== 'undefined' && import.meta.hot) {
    const existingRuntime = window[RUNTIME_SINGLETON_KEY];

    if (existingRuntime && typeof existingRuntime.dispose === 'function') {
        existingRuntime.dispose();
    }

    const dispose = initBrowserLivewireHotReload(import.meta.hot);
    window[RUNTIME_SINGLETON_KEY] = { dispose };

    import.meta.hot.dispose(() => {
        const activeRuntime = window[RUNTIME_SINGLETON_KEY];

        if (activeRuntime && typeof activeRuntime.dispose === 'function') {
            activeRuntime.dispose();
        }
    });
}
