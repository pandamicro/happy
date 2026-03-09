import type { Metadata } from '@/api/types';

export const CODEX_MODEL_FALLBACK_CODES = [
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5-codex-high',
    'gpt-5-codex-medium',
    'gpt-5-codex-low',
    'gpt-5-minimal',
    'gpt-5-low',
    'gpt-5-medium',
    'gpt-5-high',
] as const;

const MODEL_ENV_VARS = [
    'OPENAI_MODEL',
    'OPENAI_SMALL_FAST_MODEL',
    'CODEX_MODEL',
    'CODEX_SMALL_FAST_MODEL',
    'AZURE_OPENAI_DEPLOYMENT_NAME',
] as const;

const MODEL_LIST_KEYS = [
    'models',
    'availableModels',
    'available_models',
    'modelOptions',
    'model_options',
    'modelIds',
    'model_ids',
] as const;

const CURRENT_MODEL_KEYS = [
    'model',
    'currentModel',
    'current_model',
    'modelId',
    'model_id',
    'currentModelId',
    'current_model_id',
] as const;

const MODEL_OBJECT_CODE_KEYS = [
    'model',
    'modelId',
    'model_id',
    'id',
    'code',
    'value',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function normalizeModelCode(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const code = value.trim();
    if (!code) {
        return null;
    }
    if (/\s/.test(code)) {
        return null;
    }
    return code;
}

function addModelCode(target: string[], seen: Set<string>, value: unknown): void {
    const code = normalizeModelCode(value);
    if (!code || seen.has(code)) {
        return;
    }
    seen.add(code);
    target.push(code);
}

function collectModelCodesFromListEntry(entry: unknown, target: string[], seen: Set<string>): void {
    if (Array.isArray(entry)) {
        for (const nested of entry) {
            collectModelCodesFromListEntry(nested, target, seen);
        }
        return;
    }

    if (isRecord(entry)) {
        for (const key of MODEL_OBJECT_CODE_KEYS) {
            if (key in entry) {
                addModelCode(target, seen, entry[key]);
            }
        }
        if ('options' in entry && Array.isArray(entry.options)) {
            for (const nested of entry.options) {
                collectModelCodesFromListEntry(nested, target, seen);
            }
        }
        return;
    }

    addModelCode(target, seen, entry);
}

export type ResolveCodexModelCodesOptions = {
    preferredModel?: string | null;
    observedModels?: Iterable<string | null | undefined>;
    environment?: NodeJS.ProcessEnv;
    includeFallbacks?: boolean;
};

export function resolveCodexModelCodes(options: ResolveCodexModelCodesOptions = {}): string[] {
    const resolved: string[] = [];
    const seen = new Set<string>();
    const environment = options.environment ?? process.env;

    addModelCode(resolved, seen, options.preferredModel);

    if (options.observedModels) {
        for (const model of options.observedModels) {
            addModelCode(resolved, seen, model);
        }
    }

    for (const name of MODEL_ENV_VARS) {
        addModelCode(resolved, seen, environment[name]);
    }

    if (options.includeFallbacks !== false) {
        for (const model of CODEX_MODEL_FALLBACK_CODES) {
            addModelCode(resolved, seen, model);
        }
    }

    return resolved;
}

export function buildCodexMetadataModelOptions(
    modelCodes: string[],
): NonNullable<Metadata['models']> {
    return modelCodes.map((code) => ({
        code,
        value: code,
        description: null,
    }));
}

export type CodexModelSignals = {
    models: string[];
    currentModel?: string;
};

function extractConfigOptionModels(
    value: unknown,
    target: string[],
    seen: Set<string>,
): { currentModel?: string } {
    if (!Array.isArray(value)) {
        return {};
    }

    let currentModel: string | undefined;

    for (const option of value) {
        if (!isRecord(option)) {
            continue;
        }
        if (option.type !== 'select' || option.category !== 'model') {
            continue;
        }

        if (currentModel === undefined) {
            const current = normalizeModelCode(option.currentValue);
            if (current) {
                currentModel = current;
                addModelCode(target, seen, current);
            }
        }

        if (Array.isArray(option.options)) {
            for (const entry of option.options) {
                collectModelCodesFromListEntry(entry, target, seen);
            }
        }
    }

    return currentModel ? { currentModel } : {};
}

export function extractCodexModelSignalsFromEvent(event: unknown): CodexModelSignals {
    if (!isRecord(event)) {
        return { models: [] };
    }

    const models: string[] = [];
    const seen = new Set<string>();
    let currentModel: string | undefined;

    const roots: Record<string, unknown>[] = [event];
    const directData = event.data;
    const directPayload = event.payload;
    if (isRecord(directData)) {
        roots.push(directData);
    }
    if (isRecord(directPayload)) {
        roots.push(directPayload);
    }

    for (const root of roots) {
        const fromConfigOptions = extractConfigOptionModels(root.configOptions, models, seen);
        if (!currentModel && fromConfigOptions.currentModel) {
            currentModel = fromConfigOptions.currentModel;
        }

        for (const key of MODEL_LIST_KEYS) {
            if (!(key in root)) {
                continue;
            }
            collectModelCodesFromListEntry(root[key], models, seen);
        }

        for (const key of CURRENT_MODEL_KEYS) {
            if (!(key in root)) {
                continue;
            }
            const code = normalizeModelCode(root[key]);
            if (!code) {
                continue;
            }
            addModelCode(models, seen, code);
            if (!currentModel) {
                currentModel = code;
            }
        }
    }

    return currentModel ? { models, currentModel } : { models };
}
