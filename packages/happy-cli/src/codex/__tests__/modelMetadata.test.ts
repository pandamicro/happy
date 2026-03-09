import { describe, expect, it } from 'vitest';
import {
    buildCodexMetadataModelOptions,
    extractCodexModelSignalsFromEvent,
    resolveCodexModelCodes,
} from '../modelMetadata';

describe('modelMetadata', () => {
    it('includes preferred and observed models before fallbacks', () => {
        const result = resolveCodexModelCodes({
            preferredModel: 'gpt-5.3-codex',
            observedModels: ['my-custom-model', 'gpt-5.3-codex'],
            environment: {},
        });

        expect(result[0]).toBe('gpt-5.3-codex');
        expect(result[1]).toBe('my-custom-model');
        expect(result).toContain('gpt-5.4');
        expect(result).toContain('gpt-5-codex-high');
        expect(result).toContain('gpt-5-high');
    });

    it('reads model candidates from environment variables', () => {
        const result = resolveCodexModelCodes({
            environment: {
                OPENAI_MODEL: 'model-main',
                OPENAI_SMALL_FAST_MODEL: 'model-fast',
            },
            includeFallbacks: false,
        });

        expect(result).toEqual(['model-main', 'model-fast']);
    });

    it('maps model codes to metadata option shape', () => {
        expect(buildCodexMetadataModelOptions(['m1', 'm2'])).toEqual([
            { code: 'm1', value: 'm1', description: null },
            { code: 'm2', value: 'm2', description: null },
        ]);
    });

    it('extracts model signals from direct event shape', () => {
        const signals = extractCodexModelSignalsFromEvent({
            currentModel: 'gpt-5.3-codex',
            availableModels: [
                { modelId: 'gpt-5.3-codex' },
                { modelId: 'gpt-5-codex-high' },
            ],
        });

        expect(signals.currentModel).toBe('gpt-5.3-codex');
        expect(signals.models).toEqual(['gpt-5.3-codex', 'gpt-5-codex-high']);
    });

    it('extracts model signals from ACP-like config options shape', () => {
        const signals = extractCodexModelSignalsFromEvent({
            payload: {
                configOptions: [
                    {
                        id: 'model',
                        type: 'select',
                        category: 'model',
                        currentValue: 'gpt-5.3-codex',
                        options: [
                            { value: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
                            { value: 'gpt-5-codex-high', name: 'GPT-5 Codex High' },
                        ],
                    },
                ],
            },
        });

        expect(signals.currentModel).toBe('gpt-5.3-codex');
        expect(signals.models).toEqual(['gpt-5.3-codex', 'gpt-5-codex-high']);
    });
});
